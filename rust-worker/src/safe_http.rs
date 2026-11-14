use anyhow::{anyhow, bail, Result};
use ipnet::IpNet;
use reqwest::{
    header::{HeaderMap, HeaderValue, IF_MODIFIED_SINCE, IF_NONE_MATCH},
    redirect::Policy,
    Client, Response,
};
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::LazyLock;
use std::time::Duration;
use tokio::net::lookup_host;
use url::Url;

static DENIED_NETWORKS: LazyLock<Vec<IpNet>> = LazyLock::new(|| {
    let parsed = [
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.88.99.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "2001::/23",
        "2001:db8::/32",
        "2002::/16",
        "3fff::/20",
    ]
    .iter()
    .map(|value| value.parse())
    .collect::<Result<Vec<_>, _>>();
    match parsed {
        Ok(networks) => networks,
        Err(error) => {
            tracing::error!("Invalid source address policy: {}", error);
            Vec::new()
        }
    }
});

pub fn is_public_address(address: IpAddr) -> bool {
    if DENIED_NETWORKS.len() != 19 {
        return false;
    }
    let address = match address {
        IpAddr::V6(value) => value.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(address),
        _ => address,
    };
    if let IpAddr::V6(value) = address {
        if value.segments()[0] & 0xe000 != 0x2000 {
            return false;
        }
    }
    !DENIED_NETWORKS
        .iter()
        .any(|network| network.contains(&address))
}

pub fn parse_source_url(value: &str) -> Result<Url> {
    if value.len() > 8192 || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        bail!("Invalid source URL");
    }
    let parsed = Url::parse(value).map_err(|_| anyhow!("Invalid source URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        bail!("Sources require an HTTP or HTTPS URL");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        bail!("Source URLs cannot contain credentials or fragments");
    }
    match parsed
        .host()
        .ok_or_else(|| anyhow!("Invalid source host"))?
    {
        url::Host::Ipv4(value) if !is_public_address(IpAddr::V4(value)) => {
            bail!("Source host must be publicly addressable")
        }
        url::Host::Ipv6(value) if !is_public_address(IpAddr::V6(value)) => {
            bail!("Source host must be publicly addressable")
        }
        url::Host::Domain(value) => {
            let host = value.trim_end_matches('.');
            if host.len() > 253
                || !host.contains('.')
                || host.ends_with(".local")
                || host.ends_with(".localhost")
                || host.ends_with(".internal")
            {
                bail!("Source host must be publicly addressable");
            }
            if host.split('.').any(|label| {
                label.is_empty()
                    || label.len() > 63
                    || label.starts_with('-')
                    || label.ends_with('-')
                    || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            }) {
                bail!("Invalid source host");
            }
        }
        _ => {}
    }
    Ok(parsed)
}

async fn resolved_client(url: &Url, timeout: Duration) -> Result<Client> {
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("Invalid source host"))?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let port = url
        .port_or_known_default()
        .ok_or_else(|| anyhow!("Invalid source port"))?;
    let addresses: Vec<SocketAddr> = lookup_host((host, port))
        .await
        .map_err(|_| anyhow!("Could not resolve source host"))?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|value| !is_public_address(value.ip())) {
        bail!("Source host resolves to a disallowed address");
    }
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .timeout(timeout)
        .gzip(true)
        .user_agent("BlocklistWorker/1.0")
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| anyhow!("Could not create source HTTP client"))
}

#[derive(Debug, Clone)]
pub struct SourceValidators {
    pub final_url: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

impl SourceValidators {
    pub fn validate(&self) -> Result<()> {
        self.headers_for(&parse_source_url(&self.final_url)?)
            .map(|_| ())
    }

    fn headers_for(&self, url: &Url) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        if parse_source_url(&self.final_url)? != *url {
            return Ok(headers);
        }
        for (name, value) in [
            (IF_NONE_MATCH, &self.etag),
            (IF_MODIFIED_SINCE, &self.last_modified),
        ] {
            if let Some(value) = value {
                if value.is_empty() || value.len() > 8192 {
                    bail!("Invalid cached source validator");
                }
                headers.insert(
                    name,
                    HeaderValue::from_str(value)
                        .map_err(|_| anyhow!("Invalid cached source validator"))?,
                );
            }
        }
        Ok(headers)
    }
}

pub async fn get_source_conditional(
    value: &str,
    timeout: Duration,
    validators: Option<&SourceValidators>,
) -> Result<Response> {
    get_source_with_client(value, timeout, validators, |url, timeout| async move {
        resolved_client(&url, timeout).await
    })
    .await
}

async fn get_source_with_client<F, Fut>(
    value: &str,
    timeout: Duration,
    validators: Option<&SourceValidators>,
    mut client_for: F,
) -> Result<Response>
where
    F: FnMut(Url, Duration) -> Fut,
    Fut: Future<Output = Result<Client>>,
{
    tokio::time::timeout(timeout, async {
        if let Some(validators) = validators {
            validators.validate()?;
        }
        let mut current = parse_source_url(value)?;
        for attempt in 0..=5 {
            let client = client_for(current.clone(), timeout).await?;
            let headers = match validators {
                Some(validators) => validators.headers_for(&current)?,
                None => HeaderMap::new(),
            };
            let response = client
                .get(current.clone())
                .headers(headers)
                .send()
                .await
                .map_err(|_| anyhow!("Could not fetch source"))?;
            if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                return Ok(response);
            }
            if attempt == 5 {
                bail!("Source redirect exceeds the limit");
            }
            let location = response
                .headers()
                .get("location")
                .and_then(|header| header.to_str().ok())
                .ok_or_else(|| anyhow!("Invalid source redirect"))?;
            current = redirect_target(&current, location)?;
        }
        bail!("Source redirect exceeds the limit")
    })
    .await
    .map_err(|_| anyhow!("Source request timed out"))?
}

fn redirect_target(current: &Url, location: &str) -> Result<Url> {
    let joined = current
        .join(location)
        .map_err(|_| anyhow!("Invalid source redirect"))?;
    if current.scheme() == "https" && joined.scheme() != "https" {
        bail!("Source redirect cannot downgrade HTTPS");
    }
    parse_source_url(joined.as_str())
}

#[cfg(test)]
pub(crate) async fn get_source_for_test(
    value: &str,
    timeout: Duration,
    validators: Option<&SourceValidators>,
    address: SocketAddr,
) -> Result<Response> {
    get_source_with_client(value, timeout, validators, |url, timeout| async move {
        let host = url
            .host_str()
            .ok_or_else(|| anyhow!("Invalid source host"))?;
        Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .timeout(timeout)
            .gzip(true)
            .resolve_to_addrs(host, &[address])
            .build()
            .map_err(Into::into)
    })
    .await
}

#[cfg(test)]
#[path = "source_transport_tests.rs"]
mod source_transport_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_destinations() {
        for value in [
            "http://127.0.0.1",
            "http://[::1]",
            "http://user@127.0.0.1",
            "http://169.254.169.254",
            "http://mongo:27017",
            "http://2130706433",
            "http://127.1",
            "http://0x7f000001",
            "file:///etc/passwd",
            "https://example.com/#fragment",
        ] {
            assert!(parse_source_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn only_allows_public_address_space() {
        for value in [
            "10.0.0.1",
            "100.64.0.1",
            "198.18.0.1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "ff02::1",
            "64:ff9b::7f00:1",
            "2002:7f00:1::",
            "2001:db8::1",
        ] {
            assert!(!is_public_address(value.parse().expect("fixture IP")));
        }
        for value in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public_address(value.parse().expect("fixture IP")));
        }
    }
}
