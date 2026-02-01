const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const CLAIM_TTL_MINUTES = 10;
const planCache = new Map();

const deviceRouter = express.Router();

const app = express();

app.use(express.json());

const generateClaimCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tokenHash = hashToken(token);

  try {
    const { rows } = await db.query('SELECT id, status FROM devices WHERE token_hash = $1', [tokenHash]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.device = rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
};

app.get('/v1/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/v1/device/pairing/create-claim', async (_req, res, next) => {
  const claimCode = generateClaimCode();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MINUTES * 60 * 1000);

  try {
    await db.query(
      'INSERT INTO device_claims (claim_code, status, expires_at) VALUES ($1, $2, $3)',
      [claimCode, 'PENDING', expiresAt]
    );

    res.status(201).json({ claim_code: claimCode, expires_at: expiresAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/device/pairing/claim', async (req, res, next) => {
  const { claim_code: claimCode } = req.body || {};

  if (!claimCode) {
    return res.status(400).json({ error: 'claim_code is required' });
  }

  const deviceToken = uuidv4();
  const deviceId = uuidv4();
  const tokenHash = hashToken(deviceToken);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const claimResult = await client.query(
      `UPDATE device_claims
       SET status = $2, approved_at = now()
       WHERE claim_code = $1 AND status = 'PENDING' AND expires_at > now()
       RETURNING id`,
      [claimCode, 'CLAIMED']
    );

    if (claimResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid or expired claim code' });
    }

    await client.query(
      `INSERT INTO devices (id, status, token_hash, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [deviceId, 'online', tokenHash]
    );

    await client.query(
      'UPDATE device_claims SET device_id = $1 WHERE claim_code = $2',
      [deviceId, claimCode]
    );

    await client.query('COMMIT');

    return res.status(200).json({ device_id: deviceId, device_token: deviceToken });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

deviceRouter.use(authMiddleware);

deviceRouter.get('/plan', async (req, res, next) => {
  try {
    const deviceId = req.device.id;
    const cached = planCache.get(deviceId);

    const plan = cached?.plan || {
      device_id: deviceId,
      plan_type: 'loop',
      playlist: 'default',
    };

    const etag = cached?.etag || hashToken(JSON.stringify(plan));
    planCache.set(deviceId, { plan, etag });

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.set('ETag', etag);
    return res.status(200).json(plan);
  } catch (error) {
    return next(error);
  }
});

app.use('/v1/device', deviceRouter);

module.exports = app;
