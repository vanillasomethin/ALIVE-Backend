const request = require('supertest');
const app = require('../src/app');

describe('GET /v1/health', () => {
  it('returns ok status', async () => {
    const response = await request(app).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
