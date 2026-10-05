import ipaddress
import socket
from collections.abc import Mapping
from typing import Any
from urllib.parse import SplitResult, urljoin, urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3 import HTTPConnectionPool, HTTPSConnectionPool

DENIED_NETWORKS = tuple(
    ipaddress.ip_network(value)
    for value in (
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
    )
)
IPV6_PUBLIC_NETWORK = ipaddress.ip_network("2000::/3")


class UnsafeSource(requests.exceptions.InvalidURL):
    pass


def is_public_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if (
        isinstance(address, ipaddress.IPv6Address)
        and address not in IPV6_PUBLIC_NETWORK
    ):
        return False
    return not any(address in network for network in DENIED_NETWORKS)


def parse_source_url(value: str) -> SplitResult:
    if not isinstance(value, str) or len(value) > 8192:
        raise UnsafeSource("Invalid source URL")
    if any(character.isspace() or ord(character) < 32 for character in value):
        raise UnsafeSource("Invalid source URL")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        raise UnsafeSource("Invalid source URL") from None
    if parsed.scheme not in ("http", "https") or not host:
        raise UnsafeSource("Sources require an HTTP or HTTPS URL")
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise UnsafeSource("Source URLs cannot contain credentials or fragments")
    if port is not None and not 1 <= port <= 65535:
        raise UnsafeSource("Invalid source port")
    if any(character in host for character in ("%", "\\")):
        raise UnsafeSource("Invalid source host")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        host = host.rstrip(".").lower()
        try:
            ascii_host = host.encode("idna").decode("ascii")
        except UnicodeError:
            raise UnsafeSource("Invalid source host") from None
        labels = ascii_host.split(".")
        if (
            len(labels) < 2
            or len(ascii_host) > 253
            or host.endswith((".local", ".localhost", ".internal"))
        ):
            raise UnsafeSource("Source host must be publicly addressable")
        if any(
            not label
            or len(label) > 63
            or label.startswith("-")
            or label.endswith("-")
            or not all(c.isalnum() or c == "-" for c in label)
            for label in labels
        ):
            raise UnsafeSource("Invalid source host")
    else:
        if not is_public_address(host):
            raise UnsafeSource("Source host must be publicly addressable")
    return parsed


def resolve_source(value: str) -> tuple[SplitResult, str]:
    parsed = parse_source_url(value)
    host = parsed.hostname
    if host is None:
        raise UnsafeSource("Invalid source host")
    try:
        addresses = socket.getaddrinfo(
            host,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except OSError:
        raise requests.exceptions.ConnectionError(
            "Could not resolve source host"
        ) from None
    if not addresses or any(
        not is_public_address(str(item[4][0])) for item in addresses
    ):
        raise UnsafeSource("Source host resolves to a disallowed address")
    return parsed, str(addresses[0][4][0])


class SafeSourceAdapter(HTTPAdapter):
    def get_connection_with_tls_context(
        self,
        request: requests.PreparedRequest,
        verify: bool | str | None,
        proxies: Mapping[str, str] | None = None,
        cert: Any = None,
    ) -> HTTPConnectionPool | HTTPSConnectionPool:
        if not verify or proxies or cert:
            raise UnsafeSource(
                "Custom proxy or TLS settings are not supported for sources"
            )
        parsed, address = resolve_source(request.url or "")
        host_params, tls_options = self.build_connection_pool_key_attributes(
            request, verify, cert
        )
        options: dict[str, Any] = dict(tls_options)
        host_params["host"] = address
        if parsed.scheme == "https":
            options["server_hostname"] = parsed.hostname
            options["assert_hostname"] = parsed.hostname
        return self.poolmanager.connection_from_host(**host_params, pool_kwargs=options)

    def add_headers(self, request: requests.PreparedRequest, **kwargs: Any) -> None:
        parsed = parse_source_url(request.url or "")
        request.headers["Host"] = parsed.netloc


def source_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    session.max_redirects = 5
    session.mount("http://", SafeSourceAdapter(max_retries=0))
    session.mount("https://", SafeSourceAdapter(max_retries=0))
    session.headers["User-Agent"] = "BlocklistValidator/1.0"
    return session


def source_response(
    session: requests.Session,
    method: str,
    value: str,
    timeout: int = 15,
    headers: dict[str, str] | None = None,
) -> requests.Response:
    current = value
    for attempt in range(6):
        parse_source_url(current)
        response = session.request(
            method,
            current,
            timeout=timeout,
            allow_redirects=False,
            stream=True,
            headers=headers,
        )
        if response.status_code not in (301, 302, 303, 307, 308):
            return response
        location = response.headers.get("Location")
        response.close()
        session.cookies.clear()
        if not location or attempt == 5:
            raise UnsafeSource("Source redirect is missing or exceeds the limit")
        redirected = urljoin(current, location)
        if (
            urlsplit(current).scheme == "https"
            and urlsplit(redirected).scheme != "https"
        ):
            raise UnsafeSource("Source redirect cannot downgrade HTTPS")
        current = redirected
    raise UnsafeSource("Source redirect exceeds the limit")


def source_headers(value: str, timeout: int = 15) -> tuple[int, dict[str, str]]:
    with source_session() as session:
        with source_response(session, "HEAD", value, timeout) as response:
            if response.status_code not in (405, 501):
                return response.status_code, dict(response.headers)
        with source_response(
            session, "GET", value, timeout, {"Range": "bytes=0-1023"}
        ) as response:
            return response.status_code, dict(response.headers)
