const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex');

const createSession = async () => {
  return request(app).post('/v1/device/pairing/register').send({
    device_info: { model: 'test' },
  });
};

const claimSession = async (code) => {
  return request(app)
    .post('/v1/admin/device/pairing/claim')
    .set('x-admin-token', 'test-admin')
    .send({
      code,
      store_id: '00000000-0000-0000-0000-000000000001',
      group_id: '00000000-0000-0000-0000-000000000002',
    });
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for pairing tests.');
  }
  process.env.ADMIN_TOKEN = 'test-admin';
});

beforeEach(async () => {
  await db.query(
    'TRUNCATE pairing_sessions, device_claims, devices, proof_of_play_events, proof_of_play_aggregate_daily, campaigns, content, stores, device_groups RESTART IDENTITY CASCADE'
  );

  await db.query(
    `INSERT INTO stores (id, name) VALUES ($1, $2)`,
    ['00000000-0000-0000-0000-000000000001', 'Test Store']
  );

  await db.query(
    `INSERT INTO device_groups (id, name) VALUES ($1, $2)`,
    ['00000000-0000-0000-0000-000000000002', 'Test Group']
  );

  await db.query(
    `INSERT INTO campaigns (id, brand_name, name, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      '22222222-2222-2222-2222-222222222222',
      'Brand',
      'Campaign',
      '2025-01-01',
      '2025-12-31',
    ]
  );

  await db.query(
    `INSERT INTO content (id, name, type) VALUES ($1, $2, $3)`,
    ['33333333-3333-3333-3333-333333333333', 'Content', 'video']
  );
});

afterAll(async () => {
  await db.end();
});

describe('pairing sessions', () => {
  it('creates a pairing code and reports pending status', async () => {
    const createResponse = await createSession();

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.code).toBeTruthy();
    expect(createResponse.body.poll_after_seconds).toBe(5);

    const statusResponse = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: createResponse.body.code });

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.status).toBe('PENDING');
  });

  it('rejects invalid code lookups', async () => {
    const statusResponse = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: 'INVALID' });

    expect(statusResponse.status).toBe(404);
  });

  it('enforces polling rate limits', async () => {
    const createResponse = await createSession();

    await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: createResponse.body.code });

    const rapidResponse = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: createResponse.body.code });

    expect(rapidResponse.status).toBe(429);
  });

  it('expires codes after TTL', async () => {
    const code = 'EXPIRED';
    const codeHash = hashValue(code);
    await db.query(
      `INSERT INTO pairing_sessions (code_hash, status, expires_at, poll_after_seconds)
       VALUES ($1, $2, $3, $4)`,
      [codeHash, 'PENDING', new Date(Date.now() - 60 * 1000), 5]
    );

    const response = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('EXPIRED');
  });

  it('claims and returns token until ack', async () => {
    const createResponse = await createSession();
    const claimResponse = await claimSession(createResponse.body.code);
    expect(claimResponse.status).toBe(200);

    const statusResponse = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: createResponse.body.code });

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.status).toBe('CLAIMED');
    expect(uuidRegex.test(statusResponse.body.device_id)).toBe(true);
    expect(statusResponse.body.device_token).toBeTruthy();

    const ackResponse = await request(app)
      .post('/v1/device/pairing/ack')
      .send({ code: createResponse.body.code });

    expect(ackResponse.status).toBe(200);

    await db.query(
      'UPDATE pairing_sessions SET last_polled_at = now() - interval \'10 seconds\' WHERE code_hash = $1',
      [hashValue(createResponse.body.code)]
    );

    const finalStatus = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: createResponse.body.code });

    expect(finalStatus.status).toBe(200);
    expect(finalStatus.body.status).toBe('CLAIMED');
    expect(finalStatus.body.device_token).toBeUndefined();
  });
});

describe('device auth + plan', () => {
  it('rejects missing auth', async () => {
    const response = await request(app).get('/v1/device/plan');
    expect(response.status).toBe(401);
  });

  it('returns a plan with ETag and honors If-None-Match', async () => {
    const createResponse = await createSession();
    await claimSession(createResponse.body.code);

    const statusResponse = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: createResponse.body.code });

    const token = statusResponse.body.device_token;

    const planResponse = await request(app)
      .get('/v1/device/plan')
      .set('Authorization', `Bearer ${token}`);

    expect(planResponse.status).toBe(200);
    expect(planResponse.headers.etag).toBeTruthy();

    const cachedResponse = await request(app)
      .get('/v1/device/plan')
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', planResponse.headers.etag);

    expect(cachedResponse.status).toBe(304);
  });
});

describe('proof-of-play events', () => {
  it('ingests events with idempotency', async () => {
    const createResponse = await createSession();
    await claimSession(createResponse.body.code);
    const statusResponse = await request(app)
      .get('/v1/device/pairing/status')
      .query({ code: createResponse.body.code });

    const token = statusResponse.body.device_token;
    const eventPayload = {
      events: [
        {
          event_id: '11111111-1111-1111-1111-111111111111',
          campaign_id: '22222222-2222-2222-2222-222222222222',
          content_id: '33333333-3333-3333-3333-333333333333',
          store_id: '00000000-0000-0000-0000-000000000001',
          duration_ms: 1000,
        },
      ],
    };

    const firstResponse = await request(app)
      .post('/v1/device/events')
      .set('Authorization', `Bearer ${token}`)
      .send(eventPayload);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.accepted).toBe(1);

    const secondResponse = await request(app)
      .post('/v1/device/events')
      .set('Authorization', `Bearer ${token}`)
      .send(eventPayload);

    expect(secondResponse.body.accepted).toBe(0);
    expect(secondResponse.body.rejected).toBe(1);
  });
});
