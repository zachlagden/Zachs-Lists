"""
Progress tracking data classes for job processing.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional, List, Dict, Any


@dataclass
class SourceProgress:
    """Progress tracking for a single source."""

    id: str  # URL hash
    name: str
    url: str
    status: str = "pending"  # pending, downloading, processing, completed, failed
    cache_hit: Optional[bool] = None
    bytes_downloaded: int = 0
    bytes_total: Optional[int] = None
    download_time_ms: Optional[int] = None
    domain_count: Optional[int] = None
    domain_change: Optional[int] = None  # vs previous run
    error: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary with calculated fields."""
        d = asdict(self)
        # Calculate download percent
        if self.bytes_total and self.bytes_total > 0:
            d["download_percent"] = round(
                self.bytes_downloaded / self.bytes_total * 100, 1
            )
        else:
            d["download_percent"] = None
        return d


@dataclass
class WhitelistPatternProgress:
    """Progress tracking for a whitelist pattern."""

    pattern: str
    pattern_type: str  # exact, wildcard, regex, subdomain
    match_count: int = 0
    samples: List[str] = field(default_factory=list)  # First 5 matched domains

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


@dataclass
class WhitelistProgress:
    """Progress tracking for whitelist filtering stage."""

    domains_before: int = 0
    domains_after: int = 0
    total_removed: int = 0
    patterns: List[WhitelistPatternProgress] = field(default_factory=list)
    processing: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "domains_before": self.domains_before,
            "domains_after": self.domains_after,
            "total_removed": self.total_removed,
            "patterns": [p.to_dict() for p in self.patterns],
            "processing": self.processing,
        }


@dataclass
class FormatProgress:
    """Progress tracking for output format generation."""

    format: str  # hosts, plain, adblock
    status: str = "pending"  # pending, generating, compressing, completed
    domains_written: int = 0
    total_domains: int = 0
    file_size: Optional[int] = None
    gz_size: Optional[int] = None

    @property
    def percent(self) -> int:
        """Calculate completion percentage."""
        if self.total_domains == 0:
            return 0
        return int(self.domains_written / self.total_domains * 100)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary with calculated fields."""
        return {
            "format": self.format,
            "status": self.status,
            "domains_written": self.domains_written,
            "total_domains": self.total_domains,
            "percent": self.percent,
            "file_size": self.file_size,
            "gz_size": self.gz_size,
        }


@dataclass
class GenerationProgress:
    """Progress tracking for output generation stage."""

    formats: List[FormatProgress] = field(default_factory=list)
    current_format: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "formats": [f.to_dict() for f in self.formats],
            "current_format": self.current_format,
        }


@dataclass
class EnhancedProgress:
    """Complete enhanced job progress tracking."""

    stage: str = "queue"  # queue, downloading, whitelist, generation, completed

    # Queue stage
    queue_position: Optional[int] = None
    queue_delay_remaining_ms: Optional[int] = None

    # Downloading stage
    total_sources: int = 0
    processed_sources: int = 0
    sources: List[SourceProgress] = field(default_factory=list)

    # Whitelist stage
    whitelist: Optional[WhitelistProgress] = None

    # Generation stage
    generation: Optional[GenerationProgress] = None

    # Timing
    stage_started_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for Socket.IO emission."""
        return {
            "stage": self.stage,
            "queue_position": self.queue_position,
            "queue_delay_remaining_ms": self.queue_delay_remaining_ms,
            "total_sources": self.total_sources,
            "processed_sources": self.processed_sources,
            "sources": [s.to_dict() for s in self.sources],
            "whitelist": self.whitelist.to_dict() if self.whitelist else None,
            "generation": self.generation.to_dict() if self.generation else None,
            "stage_started_at": self.stage_started_at,
            # Legacy compatibility fields
            "current_step": self.stage,
            "current_source": self._get_current_source(),
        }

    def _get_current_source(self) -> Optional[str]:
        """Get the name of the currently processing source for legacy compatibility."""
        for source in self.sources:
            if source.status in ("downloading", "processing"):
                return source.name
        return None

    def get_source_by_id(self, source_id: str) -> Optional[SourceProgress]:
        """Get source progress by ID."""
        for source in self.sources:
            if source.id == source_id:
                return source
        return None

    def update_source(self, source: SourceProgress) -> None:
        """Update a source's progress."""
        for i, s in enumerate(self.sources):
            if s.id == source.id:
                self.sources[i] = source
                return
        # Source not found, add it
        self.sources.append(source)

    def count_completed_sources(self) -> int:
        """Count sources with completed or failed status."""
        return sum(1 for s in self.sources if s.status in ("completed", "failed"))

    def set_stage(self, stage: str) -> None:
        """Update the current stage with timestamp."""
        self.stage = stage
        self.stage_started_at = datetime.utcnow().isoformat()
