import logging
from threading import Lock

import geoip2.database
import maxminddb
from geoip2.errors import AddressNotFoundError

logger = logging.getLogger(__name__)

_readers: dict[str, geoip2.database.Reader | None] = {}
_lock = Lock()


def _open(path: str) -> geoip2.database.Reader | None:
    if not path:
        logger.info("GEOIP_DATABASE_PATH is empty; downloads are recorded without geo")
        return None
    try:
        return geoip2.database.Reader(path)
    except (OSError, maxminddb.InvalidDatabaseError) as error:
        logger.warning(
            "GeoIP database %s could not be opened (%s); downloads are recorded "
            "without geo until the process restarts",
            path,
            error,
        )
        return None


def _reader(path: str) -> geoip2.database.Reader | None:
    with _lock:
        if path not in _readers:
            _readers[path] = _open(path)
        return _readers[path]


def locate(path: str, ip: str) -> tuple[str | None, str | None]:
    reader = _reader(path)
    if reader is None:
        return None, None
    try:
        match = reader.city(ip)
    except (AddressNotFoundError, ValueError):
        return None, None
    return match.country.iso_code, match.city.name


def close_readers() -> None:
    with _lock:
        for reader in _readers.values():
            if reader is not None:
                reader.close()
        _readers.clear()
