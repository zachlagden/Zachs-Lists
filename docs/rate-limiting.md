# Client IP detection and rate limiting

Flask-Limiter applies the existing limit of 100 requests per hour per client IP to each non-exempt endpoint. Default list downloads share one endpoint across list names. The health endpoint remains exempt. Account-based build quotas and cooldowns are separate and do not change with the client IP.

Rate limiting, download analytics and the user IP access log all use `app.utils.client_ip.get_client_ip`. Analytics and user access logs retain their existing hashed-IP storage. The user access log records calls to `/api/auth/me`, not every request.

## Production configuration

Set this runtime environment variable on the Coolify application:

```text
TRUSTED_PROXY_HOSTS=coolify-proxy
```

The value is a comma-separated list of proxy hostnames or IP literals. The application resolves these names through Docker DNS and caches the results for up to 60 seconds. This avoids hardcoding a container IP that can change when Traefik restarts. Leave the setting empty when serving Flask without a reverse proxy.

Only configure proxies that you control. The application trusts addresses that resolve from these names, not an entire Docker subnet. A failed DNS lookup logs a warning and leaves the socket peer as the client address until the next lookup.

## Forwarding rules

The supported production path is Cloudflare, then Traefik, then Flask.

1. Flask checks whether its socket peer matches a configured proxy.
2. For a trusted proxy, it reads the rightmost address in `X-Forwarded-For`. Traefik must append the actual upstream peer and must not enable insecure forwarded-header trust.
3. If that upstream address belongs to Cloudflare, Flask accepts a valid `CF-Connecting-IP` as the visitor address.
4. Otherwise, Flask uses the upstream address and ignores `CF-Connecting-IP`.

Requests from an untrusted peer cannot choose their address through headers. Missing or malformed forwarding data falls back to the socket peer. Missing or malformed `CF-Connecting-IP` falls back to the verified Cloudflare upstream address. IPv4-mapped IPv6 addresses use the same key as their IPv4 equivalents.

Cloudflare's published IPv4 and IPv6 ranges are defined in `backend/app/utils/client_ip.py`. Check them against [the IPv4 list](https://www.cloudflare.com/ips-v4) and [the IPv6 list](https://www.cloudflare.com/ips-v6) when Cloudflare changes its ranges.

Do not add `ProxyFix` or another middleware that replaces `REMOTE_ADDR` without updating and testing this trust model. The resolver needs the original socket peer. Adding another proxy also requires checking the forwarding chain.

## Tests

From the repository root, with the backend dependencies installed through uv:

```sh
PYTHONPATH=backend uv run --no-project --with-requirements backend/requirements.txt pytest backend/tests
```

The tests cover independent visitor limits on default downloads, user downloads and an API endpoint. They also cover forged headers, IPv6, missing headers, proxy DNS failure and address changes, analytics and the user IP access log. They do not need MongoDB or a running web server.

The limiter still uses in-process memory. Restarting Gunicorn resets its counters. Running multiple Gunicorn workers or application replicas requires shared rate-limit storage as a separate change.
