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

## Device pairing

### POST /v1/device/pairing/create-claim

**Response 201**

```json
{
  "claim_code": "AB12CD34",
  "expires_at": "2025-01-01T00:00:00.000Z"
}
```

### POST /v1/device/pairing/claim

**Request body**

```json
{
  "claim_code": "ABC123",
  "device_info": {
    "model": "player"
  }
}
```

**Response 200**

```json
{
  "device_id": "uuid",
  "device_token": "device-token"
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
