const request = require('supertest');
const app = require('../src/app');

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('POST /v1/device/pairing/claim', () => {
  it('returns a mocked device token payload', async () => {
    const response = await request(app).post('/v1/device/pairing/claim').send({
      claim_code: 'ABC123',
      device_info: { model: 'test' },
    });

    expect(response.status).toBe(200);
    expect(response.body.device_token).toBe('mock-device-token');
    expect(response.body.refresh_token).toBeNull();
    expect(uuidRegex.test(response.body.device_id)).toBe(true);
  });
});
