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
  "device_token": "mock-device-token",
  "refresh_token": null
}
```
