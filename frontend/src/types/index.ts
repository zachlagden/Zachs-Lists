// User types
export interface User {
  id: string;
  username: string;
  name?: string;  // GitHub display name
  email?: string;
  avatar_url?: string;
  is_admin: boolean;
  is_enabled: boolean;
  limits: UserLimits;
  stats: UserStats;
  lists: UserList[];
  notifications: Notification[];
  remaining_updates: number;
  created_at: string;
}

export interface UserLimits {
  max_source_lists: number;
  max_domains: number;
  max_config_size_mb: number;
  manual_updates_per_week: number;
}

export interface UserStats {
  total_domains: number;
  total_output_size_bytes: number;
  last_build_at: string | null;
  manual_updates_this_week: number;
  week_reset_at: string;
}

export interface UserList {
  name: string;
  is_public: boolean;
  formats: string[];
  domain_count: number;
  last_updated: string;
}

// Job types
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';
export type JobStage = 'queue' | 'downloading' | 'whitelist' | 'generation' | 'completed';
export type SourceStatus = 'pending' | 'downloading' | 'processing' | 'completed' | 'failed';

// Queue info for queued jobs (sent via WebSocket)
export interface QueueInfo {
  position: number;
  total_queued: number;
  active_workers: number;
  jobs_processing: number;
}

export interface Job {
  id: string;
  job_id: string;
  user_id: string | null;
  username: string;
  type: 'manual' | 'scheduled' | 'admin';
  status: JobStatus;
  progress: EnhancedJobProgress;
  queue_info?: QueueInfo;  // Present for queued jobs
  result?: JobResult;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  read?: boolean;
}

// Legacy progress interface for backward compatibility
export interface JobProgress {
  current_step: string;
  total_sources: number;
  processed_sources: number;
  current_source?: string;
}

// Source progress for downloading stage
export interface SourceProgress {
  id: string;
  name: string;
  url: string;
  status: SourceStatus;
  cache_hit: boolean | null;
  bytes_downloaded: number;
  bytes_total: number | null;
  download_percent: number | null;
  download_time_ms: number | null;
  domain_count: number | null;
  domain_change: number | null;
  error: string | null;
  warnings?: string[];
  started_at: string | null;
  completed_at: string | null;
}

// Whitelist pattern progress
export interface WhitelistPatternProgress {
  pattern: string;
  pattern_type: 'exact' | 'wildcard' | 'regex' | 'subdomain';
  match_count: number;
  samples: string[];
}

// Whitelist stage progress
export interface WhitelistProgress {
  domains_before: number;
  domains_after: number;
  total_removed: number;
  patterns: WhitelistPatternProgress[];
  processing: boolean;
}

// Output format generation progress
export interface FormatProgress {
  format: 'hosts' | 'plain' | 'adblock';
  status: 'pending' | 'generating' | 'compressing' | 'completed';
  domains_written: number;
  total_domains: number;
  percent: number;
  file_size: number | null;
  gz_size: number | null;
}

// Generation stage progress
export interface GenerationProgress {
  formats: FormatProgress[];
  current_format: string | null;
}

// Enhanced job progress with all stages
export interface EnhancedJobProgress {
  stage: JobStage;

  // Queue stage
  queue_position: number | null;
  queue_delay_remaining_ms: number | null;

  // Downloading stage
  total_sources: number;
  processed_sources: number;
  sources: SourceProgress[];

  // Whitelist stage
  whitelist: WhitelistProgress | null;

  // Generation stage
  generation: GenerationProgress | null;

  // Timing
  stage_started_at: string | null;

  // Legacy compatibility
  current_step: string;
  current_source: string | null;
}

export interface JobResult {
  sources_processed: number;
  sources_failed: number;
  total_domains: number;
  unique_domains: number;
  whitelisted_removed: number;
  output_files: OutputFile[];
  categories?: Record<string, number>;
  errors: string[];
  skip_reason?: string;
}

export interface OutputFile {
  name: string;
  format: string;
  size_bytes: number;
  domain_count: number;
}

// Analytics types
export interface AnalyticsStats {
  total_requests: number;
  total_unique_ips: number;
  total_bandwidth: number;
  formats: {
    hosts: number;
    plain: number;
    adblock: number;
  };
}

export interface DailyStats {
  date: string;
  requests: number;
  unique_ips: number;
  bandwidth: number;
}

export interface GeoStats {
  countries: Record<string, number>;
}

export interface PublicStats {
  total_domains: number;
  total_requests: number;
  total_bandwidth_bytes: number;
  user_count: number;
}

// Default list types
export interface DefaultList {
  name: string;
  formats: string[];
  size_bytes: number;
  domain_count?: number;
}

// Featured list types
export interface FeaturedList {
  id: string;
  username: string;
  list_name: string;
  description: string;
  order: number;
}

// Admin types
export interface AdminUser extends User {
  github_id: number;
}

export interface AdminStats {
  users: {
    total: number;
    active: number;
  };
  jobs: {
    today: number;
    processing: number;
    queued: number;
  };
  storage: {
    cache_bytes: number;
    total_bytes: number;
    cache_mb: number;
    total_mb: number;
  };
  analytics: {
    total_requests: number;
    total_bandwidth: number;
  };
}

// Notification types
export interface Notification {
  id: string;
  type: 'limit_request_approved' | 'limit_request_denied' | string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

// Limit Request types
export interface LimitRequest {
  id: string;
  user_id: string;
  username: string;
  avatar_url?: string;
  current_limit: number;
  requested_tier: number;
  reason: string;
  intended_use: 'personal' | 'family' | 'organization' | 'other';
  current_usage: number;
  status: 'pending' | 'approved' | 'denied';
  approved_limit?: number;
  admin_response?: string;
  reviewed_by?: string;
  created_at: string;
  reviewed_at?: string;
}

export type IntendedUse = 'personal' | 'family' | 'organization' | 'other';

export const INTENDED_USE_LABELS: Record<IntendedUse, string> = {
  personal: 'Personal Use',
  family: 'Family Network',
  organization: 'Organization/Business',
  other: 'Other',
};
