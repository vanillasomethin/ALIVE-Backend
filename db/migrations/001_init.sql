CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_target_type') THEN
    CREATE TYPE schedule_target_type AS ENUM ('DEVICE', 'GROUP');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS device_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  policy_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text,
  area text,
  address text,
  operating_hours_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name text,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  version_hash text NOT NULL,
  url text NOT NULL,
  sha256 text NOT NULL,
  bytes bigint NOT NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, version_hash)
);

CREATE TABLE IF NOT EXISTS playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  content_version_id uuid NOT NULL REFERENCES content_versions(id) ON DELETE RESTRICT,
  order_index integer NOT NULL,
  weight integer NOT NULL DEFAULT 1,
  UNIQUE (playlist_id, order_index)
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_name text,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  group_id uuid REFERENCES device_groups(id) ON DELETE SET NULL,
  status text NOT NULL,
  last_seen_at timestamptz,
  device_info_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  player_version text,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_code text NOT NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  UNIQUE (claim_code)
);

CREATE TABLE IF NOT EXISTS pairing_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  poll_after_seconds integer NOT NULL DEFAULT 5,
  device_info_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  token_plain text,
  last_polled_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_hash)
);

CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type schedule_target_type NOT NULL,
  target_id uuid NOT NULL,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  timezone text NOT NULL,
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS playout_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  etag text NOT NULL,
  plan_json jsonb NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, valid_from, valid_to)
);

CREATE TABLE IF NOT EXISTS proof_of_play_events (
  event_id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  playlist_id uuid REFERENCES playlists(id) ON DELETE SET NULL,
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE RESTRICT,
  content_version text NOT NULL,
  event_type text NOT NULL,
  device_time_ts timestamptz NOT NULL,
  server_received_ts timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  result text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS proof_of_play_aggregate_daily (
  day date NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  plays_count bigint NOT NULL DEFAULT 0,
  total_duration_ms bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, campaign_id, store_id, content_id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type text NOT NULL,
  severity text NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_devices_group_store_last_seen
  ON devices (group_id, store_id, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_pop_campaign_store_day
  ON proof_of_play_events (campaign_id, store_id, date(server_received_ts));
