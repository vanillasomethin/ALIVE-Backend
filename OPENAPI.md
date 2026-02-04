# OpenAPI (current endpoints)

Base URL: `/v1`

## Health

### GET /v1/health

**Response 200**

```json
{
  "status": "ok"
}
```

## Device pairing (TV-generated code)

### POST /v1/device/pairing/register

**Request body**

```json
{
  "device_info": {
    "model": "player"
  }
}
```

**Response 201**

```json
{
  "code": "AB12CD",
  "expires_at": "2025-01-01T00:00:00.000Z",
  "poll_after_seconds": 5
}
```

### GET /v1/device/pairing/status?code=

**Response 200**

```json
{
  "status": "PENDING"
}
```

When claimed:

```json
{
  "status": "CLAIMED",
  "device_id": "uuid",
  "device_token": "device-token"
}
```

### POST /v1/device/pairing/ack

**Request body**

```json
{
  "code": "AB12CD"
}
```

**Response 200**

```json
{
  "status": "COMPLETED"
}
```

## Admin pairing claim

### POST /v1/admin/device/pairing/claim

Requires `x-admin-token` header.

**Request body**

```json
{
  "code": "AB12CD",
  "store_id": "uuid",
  "group_id": "uuid"
}
```

**Response 200**

```json
{
  "status": "CLAIMED"
}
```

## Device plan

### GET /v1/device/plan

Requires `Authorization: Bearer <device_token>`.

**Response 200**

```json
{
  "device_id": "uuid",
  "plan_type": "loop",
  "playlist": "default"
}
```

## Proof-of-play ingestion

### POST /v1/device/events

Requires `Authorization: Bearer <device_token>`.

**Request body**

```json
{
  "events": [
    {
      "event_id": "uuid",
      "campaign_id": "uuid",
      "content_id": "uuid",
      "store_id": "uuid",
      "duration_ms": 1000
    }
  ]
}
```

**Response 200**

```json
{
  "accepted": 1,
  "rejected": 0
}
```
