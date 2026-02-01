# Backend blueprint (Postgres + API)

## Purpose

Backend control plane for device registry & pairing, content library, scheduling to resolved playout plans, proof-of-play ingestion and reporting, monitoring, and audit logging.

## Schema + migrations

The initial migration (`db/migrations/001_init.sql`) includes the core tables, foreign keys, and indexes for devices, stores, device groups, content, playlists, schedules, playout plans, proof-of-play events, daily POP aggregates, incidents, and audit logging.

## API endpoints (v1)

### Pairing & device auth

- `POST /v1/device/pairing/create-claim`
  - Creates a claim code for installer/console flows.
- `POST /v1/device/pairing/claim`
  - Input: `{ claim_code, device_info }`
  - Output: `{ device_id, device_token, refresh_token? }`
  - Claim codes are single-use and expire based on `device_claims.expires_at`.

Device auth uses `Authorization: Bearer <device_token>` with token hashes stored in `devices.token_hash`.

### Device operations

- `POST /v1/device/heartbeat`
  - Input: `{ now_playing, disk_used_bytes, plan_etag, last_error?, counters }`
  - Updates `devices.last_seen_at`, `devices.device_info_json`, and `devices.player_version`.
- `GET /v1/device/plan`
  - Returns resolved playout plan for the next 72 hours.
  - Supports `ETag` + `If-None-Match` for `304 Not Modified`.

### Proof-of-play ingestion

- `POST /v1/device/events`
  - Input: `{ events: ProofEvent[] }`
  - Idempotent by `event_id` (`ON CONFLICT DO NOTHING`).
  - Returns accepted/rejected counts after validation.

### Admin endpoints (examples)

- `GET /v1/admin/devices`
- `PATCH /v1/admin/devices/{id}` (assign store/group)
- `POST /v1/admin/playlists`
- `POST /v1/admin/schedules`
- `GET /v1/admin/reports/proof-of-play`
- `GET /v1/admin/reports/proof-of-play.csv`

## Plan generation (72h)

Algorithm outline:

1. Determine effective playlist assignments in priority order: device overrides → group overrides.
2. Expand schedules into concrete windows for the next 72 hours in the schedule timezone.
3. Resolve conflicts by schedule priority rules in the API layer.
4. Emit compact plan JSON with windows, playlist items, and content version references (`url`, `sha256`, `bytes`, `mime`, `duration_ms`).

Cache results in `playout_plans.plan_json` and hash as the `etag` for conditional requests.

## Proof-of-play validation

- Reject negative `duration_ms`.
- Cap `duration_ms` to a maximum (e.g., 24h).
- Validate `event_type` and `result` against the allowed list in API code.

## Reporting & exports

- Aggregate POP by day using `proof_of_play_aggregate_daily` and the POP aggregate index.
- CSV exports mirror API totals for campaign/day/store breakdowns.
