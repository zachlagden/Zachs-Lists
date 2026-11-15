# Client IP detection and rate limiting

## Limits

Flask-Limiter counts requests per route and per client. A route without its own limit gets the default, `RATELIMIT_DEFAULT`, which is 100 requests per hour. Default list downloads share one route across list names. The health endpoint is exempt. Account-based build quotas and cooldowns are separate and do not depend on these limits.

These routes are called repeatedly by one open browser session, so each has its own limit, set in `backend/app/config.py`:

| Route                                                                                                                                                                 | Config key               | Limit          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------- |
| `GET /api/auth/me`                                                                                                                                                    | `RATELIMIT_AUTH_ME`      | 60 per minute  |
| `GET /api/user/jobs`, `GET /api/user/jobs/<id>`, `POST /api/user/jobs/mark-read`, `GET /api/admin/jobs`, `GET /api/admin/jobs/<id>`, `GET /api/admin/users/<id>/jobs` | `RATELIMIT_JOBS`         | 120 per minute |
| `POST /api/user/config/url-metadata`                                                                                                                                  | `RATELIMIT_URL_METADATA` | 60 per minute  |
| `GET /api/admin/stats`                                                                                                                                                | `RATELIMIT_ADMIN_STATS`  | 60 per minute  |

`POST /api/admin/default/sync` is limited to 6 per hour by `RATELIMIT_DEFAULT_SYNC`, because each run calls the GitHub API.

A route's own limit replaces the default for that route. Routes that share a config key still count separately.

## Who a limit applies to

`app.utils.rate_limits.rate_limit_key` chooses the client a request counts against:

- A request to a path under `/api/` that carries a session with a user id counts against that user, whatever address it comes from. Two people behind one address do not use up each other's allowance, and one person on two networks has one allowance.
- Every other request counts against the client IP. This covers requests without a session and list downloads under `/lists/` and `/u/`, which ignore the session.

The session cookie is signed, so a client cannot choose another user's id. The key is read before the route checks that the account still exists and is allowed in.

## Refused requests

A request over its limit gets status 429 with a JSON body and a `Retry-After` header holding the seconds until the limit resets:

```json
{ "error": "Too many requests. Try again shortly.", "code": "rate_limited", "retry_after": 42 }
```

## Storage

Counters are kept in process memory by default. Restarting Gunicorn resets them, and each Gunicorn worker or application replica counts on its own. Production runs one web worker and has no Redis, so it uses memory.

To share counters, set `RATELIMIT_STORAGE_URL`, or `REDIS_URL` when the first is unset, to a Redis URL such as `redis://localhost:6379/0`. If Redis becomes unreachable the limiter falls back to counting in memory until it returns.

## Client IP

Rate limiting, download analytics and the user IP access log all use `app.utils.client_ip.get_client_ip`. Analytics and the user access log store a keyed hash of the address, never the address. The user access log records calls to `/api/auth/me`, not every request, and keeps the 50 most recently added addresses for each user.

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

The tests cover independent visitor limits on default downloads, user downloads and an API endpoint. They also cover forged headers, IPv6, missing headers, proxy DNS failure and address changes, analytics and the user IP access log. `backend/tests/test_rate_limits.py` covers the configured storage and default, each route's own limit, counting by user and by address, and the 429 response. The tests do not need MongoDB, Redis or a running web server, and they do not exercise Redis storage.
