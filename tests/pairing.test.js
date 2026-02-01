const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createClaim = async () => {
  const response = await request(app).post('/v1/device/pairing/create-claim');
  return response;
};

const claimDevice = async (claimCode) => {
  return request(app).post('/v1/device/pairing/claim').send({
    claim_code: claimCode,
    device_info: { model: 'test' },
  });
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for pairing tests.');
  }
});

beforeEach(async () => {
  await db.query('TRUNCATE device_claims, devices RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await db.end();
});

describe('pairing flow', () => {
  it('creates a claim, claims it once, and rejects reuse', async () => {
    const createResponse = await createClaim();

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.claim_code).toBeTruthy();

    const claimResponse = await claimDevice(createResponse.body.claim_code);
    expect(claimResponse.status).toBe(200);
    expect(uuidRegex.test(claimResponse.body.device_id)).toBe(true);
    expect(claimResponse.body.device_token).toBeTruthy();

    const secondClaim = await claimDevice(createResponse.body.claim_code);
    expect(secondClaim.status).toBe(400);
  });

  it('rejects expired claim codes', async () => {
    await db.query(
      'INSERT INTO device_claims (claim_code, status, expires_at) VALUES ($1, $2, $3)',
      ['EXPIRED1', 'PENDING', new Date(Date.now() - 60 * 1000)]
    );

    const response = await claimDevice('EXPIRED1');
    expect(response.status).toBe(400);
  });
});

describe('device auth + plan', () => {
  it('rejects missing auth', async () => {
    const response = await request(app).get('/v1/device/plan');
    expect(response.status).toBe(401);
  });

  it('returns a plan with ETag and honors If-None-Match', async () => {
    const createResponse = await createClaim();
    const claimResponse = await claimDevice(createResponse.body.claim_code);
    const token = claimResponse.body.device_token;

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
