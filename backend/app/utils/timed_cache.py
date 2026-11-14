import time
from collections.abc import Callable, Hashable
from threading import Lock
from typing import Generic, TypeVar

Value = TypeVar("Value")


class TimedCache(Generic[Value]):
    def __init__(self, ttl_seconds: float) -> None:
        self._ttl_seconds = ttl_seconds
        self._lock = Lock()
        self._entries: dict[Hashable, tuple[float, Value]] = {}

    def get(self, key: Hashable, load: Callable[[], Value]) -> Value:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
        if entry is not None and now < entry[0]:
            return entry[1]
        value = load()
        with self._lock:
            self._entries = {
                name: kept for name, kept in self._entries.items() if now < kept[0]
            }
            self._entries[key] = (now + self._ttl_seconds, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
