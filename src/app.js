const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(express.json());

app.get('/v1/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/v1/device/pairing/claim', (_req, res) => {
  res.status(200).json({
    device_id: uuidv4(),
    device_token: 'mock-device-token',
    refresh_token: null,
  });
});

module.exports = app;
