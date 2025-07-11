const request = require('supertest');
const app = require('../server'); // pastikan ini export `app`

describe('Health check', () => {
  it('should return 200 for /metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.statusCode).toEqual(200);
  });
});
