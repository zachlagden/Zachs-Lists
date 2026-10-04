import logging
import socket
import time
from functools import lru_cache
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network

from flask import current_app, request

IPAddress = IPv4Address | IPv6Address

logger = logging.getLogger(__name__)

CLOUDFLARE_NETWORKS = tuple(
    ip_network(cidr)
    for cidr in (
        "173.245.48.0/20",
        "103.21.244.0/22",
        "103.22.200.0/22",
        "103.31.4.0/22",
        "141.101.64.0/18",
        "108.162.192.0/18",
        "190.93.240.0/20",
        "188.114.96.0/20",
        "197.234.240.0/22",
        "198.41.128.0/17",
        "162.158.0.0/15",
        "104.16.0.0/13",
        "104.24.0.0/14",
        "172.64.0.0/13",
        "131.0.72.0/22",
        "2400:cb00::/32",
        "2606:4700::/32",
        "2803:f800::/32",
        "2405:b500::/32",
        "2405:8100::/32",
        "2a06:98c0::/29",
        "2c0f:f248::/32",
    )
)


def _parse_ip(value: str | None) -> IPAddress | None:
    if not value or "%" in value:
        return None
    try:
        address = ip_address(value.strip())
    except ValueError:
        return None
    if isinstance(address, IPv6Address) and address.ipv4_mapped:
        return address.ipv4_mapped
    return address


@lru_cache(maxsize=32)
def _proxy_addresses(host: str, interval: int) -> frozenset[IPAddress]:
    try:
        results = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        logger.warning("Could not resolve trusted proxy %s", host)
        return frozenset()
    return frozenset(
        address
        for result in results
        if (address := _parse_ip(str(result[4][0]))) is not None
    )


def get_client_ip() -> str:
    peer = _parse_ip(request.remote_addr)
    if peer is None:
        return "unknown"

    interval = int(time.monotonic() // 60)
    trusted_hosts = current_app.config.get("TRUSTED_PROXY_HOSTS", ())
    if not any(peer in _proxy_addresses(host, interval) for host in trusted_hosts):
        return str(peer)

    upstream = _parse_ip(request.headers.get("X-Forwarded-For", "").rsplit(",", 1)[-1])
    if upstream is None:
        return str(peer)

    if any(upstream in network for network in CLOUDFLARE_NETWORKS):
        visitor = _parse_ip(request.headers.get("CF-Connecting-IP"))
        if visitor is not None:
            return str(visitor)

    return str(upstream)
