# alive-signage-backend

## Purpose

Backend control plane: device registry & pairing, content library, scheduling → resolved playout plans, proof-of-play ingestion + reporting, monitoring, audit log.

## Target scale

- 5,000 devices
- 60s heartbeat (~83/min)
- Proof-of-play: potentially millions of events/month → design for batch ingestion + aggregation.

## Tech stack (recommended)

- API: Node.js (NestJS) or Go
- DB: PostgreSQL
- Queue/cache: Redis
- Object storage: S3-compatible
- Auth: JWT device tokens (short-lived refresh optional)
- Optional realtime: MQTT (phase 2)

## Folder structure (spec)

```
alive-signage-backend/
  src/
    modules/
      auth/
      devices/
      groups/
      stores/
      content/
      playlists/
      schedules/
      plans/
      events/
      reports/
      monitoring/
      audit/
    db/
      migrations/
      schema.sql (optional)
    common/
      config/
      middleware/
      utils/
  scripts/
  docs/
  docker/
  docker-compose.yml
```

## API endpoints (v1)

### Pairing & device auth

- `POST /v1/device/pairing/create-claim`
  - Creates claim code (for installer flow or console flow)
- `POST /v1/device/pairing/claim`
  - Input: `{ claim_code, device_info }`
  - Output: `{ device_id, device_token, refresh_token? }`

### Device operations

- `POST /v1/device/heartbeat`
  - Input: `{ now_playing, disk_used_bytes, plan_etag, last_error?, counters }`
- `GET /v1/device/plan`
  - Returns resolved playout plan for next 72 hours
  - Supports ETag + If-None-Match

### Proof-of-play ingestion

- `POST /v1/device/events`
  - Input: `{ events: ProofEvent[] }`
  - Must be idempotent by `event_id`
  - Returns: accepted/rejected counts

### Console (admin) endpoints (examples)

- `GET /v1/admin/devices`
- `PATCH /v1/admin/devices/{id}` (assign store/group)
- `POST /v1/admin/playlists`
- `POST /v1/admin/schedules`
- `GET /v1/admin/reports/proof-of-play`
- `GET /v1/admin/reports/proof-of-play.csv`

## Database tables (fields)

### devices

- `id` (uuid PK)
- `external_name` (text, optional)
- `store_id` (uuid FK)
- `group_id` (uuid FK)
- `status` (online/offline)
- `last_seen_at` (timestamptz)
- `device_info_json` (jsonb)
- `player_version` (text)
- `created_at`, `updated_at`

### stores

- `id` (uuid PK)
- `name`, `city`, `area`, `address` (text)
- `operating_hours_json` (jsonb) (used for “offline during business hours” alerts)

### device_groups

- `id`
- `name`
- `policy_json` (jsonb) (storage cap, heartbeat interval, etc.)

### content

- `id`
- `name`
- `type` (video/image/web)
- `tags` (text[])
- `created_at`

### content_versions

- `id`
- `content_id` (FK)
- `version_hash` (text) (immutable)
- `url` (text) (CDN/S3)
- `sha256` (text)
- `bytes` (bigint)
- `duration_ms` (int, nullable)
- `created_at`

### campaigns

- `id`
- `brand_name`
- `name`
- `start_date`, `end_date`
- `created_at`

### playlists

- `id`
- `name`
- `campaign_id` (FK optional)
- `created_at`

### playlist_items

- `id`
- `playlist_id`
- `content_version_id`
- `order_index`
- `weight` (int default 1)

### schedules

- `id`
- `target_type` (DEVICE or GROUP)
- `target_id` (uuid)
- `playlist_id`
- `timezone` (text)
- `rules_json` (jsonb) (dayparting, frequency caps, exclusions)

### playout_plans

- `id`
- `device_id`
- `etag` (text)
- `plan_json` (jsonb)
- `valid_from`, `valid_to` (timestamptz)
- `generated_at`

### proof_of_play_events (immutable log)

- `event_id` (uuid PK) (idempotency key)
- `device_id`
- `store_id`
- `campaign_id` (nullable)
- `playlist_id`
- `content_id`
- `content_version`
- `type` (PLAY_START/PLAY_END)
- `device_time_ts` (timestamptz)
- `server_received_ts` (timestamptz default now())
- `duration_ms` (int nullable)
- `result` (COMPLETED/SKIPPED/ERROR/INTERRUPTED nullable)
- `payload_json` (jsonb)

### proof_of_play_aggregate_daily (derived)

- `day` (date)
- `campaign_id`
- `store_id`
- `content_id`
- `plays_count`
- `total_duration_ms`

### incidents

- `id`
- `device_id`
- `type` (PLAYBACK_STUCK, DOWNLOAD_FAIL, LOW_STORAGE, CRASH_LOOP, OFFLINE_DURING_HOURS)
- `severity`
- `details_json`
- `created_at`
- `resolved_at` (nullable)

### audit_log

- `id`
- `actor_user_id`
- `action`
- `target_type`, `target_id`
- `created_at`
- `details_json`

## Acceptance tests (must pass)

### Pairing

- Claim code exchanges for a valid device token
- Same claim code cannot be used twice
- Tokens authenticate to device endpoints

### Plan generation

- Plan generated for next 72h
- ETag stable if inputs unchanged
- If-None-Match returns 304 when unchanged

### Proof-of-play ingestion

- Ingest batch of events
- Idempotency: duplicate event_id is ignored (no double count)
- Validation: rejects negative durations and insane durations
- Aggregates update correctly per day

### Reporting

- Returns totals by campaign/date range
- CSV export matches API totals

### Monitoring

- Marks device offline after threshold
- Triggers incident when offline during store hours
