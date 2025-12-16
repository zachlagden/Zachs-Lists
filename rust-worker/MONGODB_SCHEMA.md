# MongoDB Job Schema for Rust Worker

This document defines the exact MongoDB schema that the Rust worker must follow to integrate with the Flask web server.

## Collection: `jobs`

### Job Document Schema

```json
{
  "_id": ObjectId,
  "job_id": "uuid-string",
  "user_id": ObjectId | null,
  "username": "string",
  "type": "manual" | "scheduled" | "admin",
  "status": "queued" | "processing" | "completed" | "failed" | "skipped",
  "priority": 1 | 2,
  "progress": ProgressSchema,
  "result": ResultSchema | null,
  "started_at": ISODate | null,
  "completed_at": ISODate | null,
  "created_at": ISODate,
  "worker_id": "uuid-string" | null,
  "claimed_at": ISODate | null,
  "heartbeat_at": ISODate | null,
  "read": boolean
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB auto-generated ID |
| `job_id` | string | UUID v4 for external reference |
| `user_id` | ObjectId \| null | User who created the job (null for default lists) |
| `username` | string | Username or "__default__" for default lists |
| `type` | string | "manual", "scheduled", or "admin" |
| `status` | string | Current job status |
| `priority` | int | 1 = high (default/admin), 2 = normal (user) |
| `progress` | object | Current progress (see below) |
| `result` | object \| null | Final result (see below) |
| `started_at` | ISODate \| null | When processing started |
| `completed_at` | ISODate \| null | When job finished |
| `created_at` | ISODate | When job was created |
| `worker_id` | string \| null | UUID of worker processing this job |
| `claimed_at` | ISODate \| null | When worker claimed the job |
| `heartbeat_at` | ISODate \| null | Last heartbeat from worker |
| `read` | boolean | Whether user has seen failed job |

---

## Progress Schema

The `progress` field must follow this structure:

```json
{
  "current_step": "queued|downloading|whitelist|generation|completed",
  "stage": "queue|downloading|whitelist|generation|completed",
  "total_sources": 150,
  "processed_sources": 45,
  "current_source": null,

  "queue_position": 2,
  "queue_delay_remaining_ms": null,

  "sources": [SourceProgressSchema],
  "whitelist": WhitelistProgressSchema | null,
  "generation": GenerationProgressSchema | null,
  "stage_started_at": "2025-12-15T12:00:00.000000"
}
```

### Source Progress Schema

```json
{
  "id": "sha256-of-url",
  "name": "EasyList",
  "url": "https://easylist.to/easylist/easylist.txt",
  "status": "pending|downloading|processing|completed|failed",
  "cache_hit": true | false | null,
  "bytes_downloaded": 1234567,
  "bytes_total": 2000000 | null,
  "download_percent": 61.7 | null,
  "download_time_ms": 1500 | null,
  "domain_count": 50000 | null,
  "domain_change": 500 | null,
  "error": "error message" | null,
  "warnings": ["warning1", "warning2"],
  "started_at": "2025-12-15T12:00:00.000000" | null,
  "completed_at": "2025-12-15T12:00:05.000000" | null
}
```

### Whitelist Progress Schema

```json
{
  "domains_before": 2000000,
  "domains_after": 1950000,
  "total_removed": 50000,
  "processing": false,
  "patterns": [
    {
      "pattern": "*.google.com",
      "pattern_type": "exact|wildcard|regex|subdomain",
      "match_count": 150,
      "samples": ["ads.google.com", "tracking.google.com"]
    }
  ]
}
```

### Generation Progress Schema

```json
{
  "current_format": "hosts" | null,
  "formats": [
    {
      "format": "hosts|plain|adblock",
      "status": "pending|generating|compressing|completed",
      "domains_written": 1950000,
      "total_domains": 1950000,
      "percent": 100.0,
      "file_size": 34000000 | null,
      "gz_size": 5000000 | null
    }
  ]
}
```

---

## Result Schema

On completion, the `result` field should contain:

### Success Result

```json
{
  "sources_processed": 150,
  "sources_failed": 2,
  "total_domains": 2500000,
  "unique_domains": 1950000,
  "whitelisted_removed": 50000,
  "output_files": [
    {
      "name": "all_domains_hosts.txt.gz",
      "format": "hosts",
      "size_bytes": 34000000,
      "domain_count": 1950000
    }
  ],
  "categories": {
    "ads": 1000000,
    "tracking": 500000,
    "malware": 450000
  },
  "errors": []
}
```

### Failure Result

```json
{
  "errors": ["Error message 1", "Error message 2"]
}
```

### Skip Result

```json
{
  "skip_reason": "A build is already running for this user"
}
```

---

## Worker Operations

### 1. Claim Next Job

```javascript
// Atomic operation to claim highest priority unclaimed job
db.jobs.findOneAndUpdate(
  {
    status: "queued",
    worker_id: null
  },
  {
    $set: {
      status: "processing",
      worker_id: "worker-uuid",
      claimed_at: new Date(),
      heartbeat_at: new Date(),
      started_at: new Date()
    }
  },
  {
    sort: { priority: 1, created_at: 1 },
    returnDocument: "after"
  }
)
```

### 2. Update Progress

```javascript
// Update progress (do this every 500ms, NOT per-domain)
db.jobs.updateOne(
  { _id: jobId },
  { $set: { progress: progressObject } }
)
```

### 3. Heartbeat

```javascript
// Update heartbeat every 10 seconds
db.jobs.updateOne(
  { job_id: jobId, worker_id: workerId, status: "processing" },
  { $set: { heartbeat_at: new Date() } }
)
```

### 4. Complete Job

```javascript
db.jobs.updateOne(
  { _id: jobId },
  {
    $set: {
      status: "completed",
      completed_at: new Date(),
      result: resultObject
    }
  }
)
```

### 5. Fail Job

```javascript
db.jobs.updateOne(
  { _id: jobId },
  {
    $set: {
      status: "failed",
      completed_at: new Date(),
      result: { errors: ["Error message"] }
    }
  }
)
```

### 6. Release Job (on shutdown)

```javascript
db.jobs.updateOne(
  { job_id: jobId, worker_id: workerId, status: "processing" },
  {
    $set: {
      status: "queued",
      worker_id: null,
      claimed_at: null,
      heartbeat_at: null,
      started_at: null
    }
  }
)
```

---

## Important Notes for Rust Implementation

1. **Progress Update Frequency**: Update MongoDB every 500ms maximum, NOT per-domain
2. **Heartbeat**: Update `heartbeat_at` every 10 seconds
3. **Stale Job Recovery**: Jobs with `heartbeat_at` older than 10 minutes will be reset by the Flask server
4. **Source ID**: Use SHA256 hash of URL for source `id` field
5. **Timestamps**: Use ISO 8601 format with microseconds: `2025-12-15T12:00:00.000000`
6. **ObjectId**: The `_id` field is auto-generated by MongoDB
7. **Socket.IO**: Do NOT emit WebSocket events - the Flask `JobStatusPoller` handles this

---

## File Paths

### Default Lists
- Config: `/data/default/blocklists.conf`
- Whitelist: `/data/default/whitelist.txt`
- Output: `/data/default/output/all_domains_{format}.txt.gz`

### User Lists
- Config: `/data/users/{username}/blocklists.conf`
- Whitelist: `/data/users/{username}/whitelist.txt`
- Output: `/data/users/{username}/output/all_domains_{format}.txt.gz`

### Cache (Shared)
- `/data/cache/{sha256(url)}/content.txt`
- `/data/cache/{sha256(url)}/metadata.json`

---

## Output File Format

**IMPORTANT**: Only generate `.gz` files. The Flask server will decompress on-the-fly for non-gzip clients.

### Hosts Format (`_hosts.txt.gz`)
```
# Blocklist generated by lists.zachlagden.uk
# Total domains: 1950000
# Generated: 2025-12-15T12:00:00Z

0.0.0.0 ad.example.com
0.0.0.0 tracker.example.com
...
```

### Plain Format (`_plain.txt.gz`)
```
# Blocklist generated by lists.zachlagden.uk
# Total domains: 1950000
# Generated: 2025-12-15T12:00:00Z

ad.example.com
tracker.example.com
...
```

### Adblock Format (`_adblock.txt.gz`)
```
! Blocklist generated by lists.zachlagden.uk
! Total domains: 1950000
! Generated: 2025-12-15T12:00:00Z

||ad.example.com^
||tracker.example.com^
...
```
