const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const CLAIM_TTL_MINUTES = 15;
const POLL_AFTER_SECONDS = 5;
const PLAN_WINDOW_HOURS = 72;

const app = express();
const deviceRouter = express.Router();
const adminRouter = express.Router();

app.use(express.json());

const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex');
const generatePairingCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tokenHash = hashValue(token);

  try {
    const { rows } = await db.query('SELECT id, status, store_id FROM devices WHERE token_hash = $1', [tokenHash]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.device = rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
};

const adminAuthMiddleware = (req, res, next) => {
  const adminToken = process.env.ADMIN_TOKEN || 'dev-admin-token';
  const provided = req.headers['x-admin-token'];

  if (!provided || provided !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
};

app.get('/v1/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/v1/device/pairing/register', async (req, res, next) => {
  const deviceInfo = req.body?.device_info || {};
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MINUTES * 60 * 1000);
  const codeHash = hashValue(code);

  try {
    await db.query(
      `INSERT INTO pairing_sessions
        (code_hash, status, expires_at, poll_after_seconds, device_info_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [codeHash, 'PENDING', expiresAt, POLL_AFTER_SECONDS, deviceInfo]
    );

    return res.status(201).json({
      code,
      expires_at: expiresAt.toISOString(),
      poll_after_seconds: POLL_AFTER_SECONDS,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/v1/device/pairing/status', async (req, res, next) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'code is required' });
  }

  const codeHash = hashValue(String(code));

  try {
    const { rows } = await db.query(
      `SELECT id, status, expires_at, device_id, token_plain, poll_after_seconds, last_polled_at
       FROM pairing_sessions
       WHERE code_hash = $1`,
      [codeHash]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const session = rows[0];
    const now = new Date();

    if (session.expires_at <= now && session.status === 'PENDING') {
      await db.query('UPDATE pairing_sessions SET status = $1 WHERE id = $2', ['EXPIRED', session.id]);
      return res.status(200).json({ status: 'EXPIRED' });
    }

    if (session.last_polled_at) {
      const nextAllowed = new Date(session.last_polled_at.getTime() + session.poll_after_seconds * 1000);
      if (now < nextAllowed) {
        const retryAfter = Math.ceil((nextAllowed.getTime() - now.getTime()) / 1000);
        return res.status(429).json({ error: 'Too Many Requests', retry_after_seconds: retryAfter });
      }
    }

    await db.query('UPDATE pairing_sessions SET last_polled_at = now() WHERE id = $1', [session.id]);

    if (session.status === 'CLAIMED') {
      return res.status(200).json({
        status: 'CLAIMED',
        device_id: session.device_id,
        device_token: session.token_plain || undefined,
      });
    }

    if (session.status === 'COMPLETED') {
      return res.status(200).json({ status: 'CLAIMED', device_id: session.device_id });
    }

    return res.status(200).json({ status: session.status });
  } catch (error) {
    return next(error);
  }
});

app.post('/v1/device/pairing/ack', async (req, res, next) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({ error: 'code is required' });
  }

  const codeHash = hashValue(code);

  try {
    const result = await db.query(
      `UPDATE pairing_sessions
       SET status = $2, completed_at = now(), token_plain = NULL
       WHERE code_hash = $1 AND status = 'CLAIMED'
       RETURNING id`,
      [codeHash, 'COMPLETED']
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid or already completed' });
    }

    return res.status(200).json({ status: 'COMPLETED' });
  } catch (error) {
    return next(error);
  }
});

adminRouter.use(adminAuthMiddleware);

adminRouter.post('/device/pairing/claim', async (req, res, next) => {
  const { code, store_id: storeId, group_id: groupId } = req.body || {};

  if (!code) {
    return res.status(400).json({ error: 'code is required' });
  }

  const codeHash = hashValue(code);
  const deviceToken = uuidv4();
  const deviceId = uuidv4();
  const tokenHash = hashValue(deviceToken);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `SELECT id, status, expires_at
       FROM pairing_sessions
       WHERE code_hash = $1 FOR UPDATE`,
      [codeHash]
    );

    if (sessionResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const session = sessionResult.rows[0];

    if (session.expires_at <= new Date()) {
      await client.query('UPDATE pairing_sessions SET status = $1 WHERE id = $2', ['EXPIRED', session.id]);
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Expired code' });
    }

    if (session.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already claimed' });
    }

    await client.query(
      `INSERT INTO devices (id, status, token_hash, store_id, group_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [deviceId, 'online', tokenHash, storeId || null, groupId || null]
    );

    await client.query(
      `UPDATE pairing_sessions
       SET status = $2, claimed_at = now(), device_id = $3, token_plain = $4
       WHERE id = $1`,
      [session.id, 'CLAIMED', deviceId, deviceToken]
    );

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, details_json)
       VALUES ($1, $2, $3, $4, $5)`,
      ['admin', 'PAIRING_CLAIM', 'device', deviceId, { store_id: storeId, group_id: groupId }]
    );

    await client.query('COMMIT');

    return res.status(200).json({ status: 'CLAIMED' });
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
    const plan = {
      device_id: deviceId,
      plan_type: 'loop',
      playlist: 'default',
    };

    const planJson = JSON.stringify(plan);
    const planHash = hashValue(planJson);
    const now = new Date();
    const validTo = new Date(now.getTime() + PLAN_WINDOW_HOURS * 60 * 60 * 1000);

    const { rows } = await db.query(
      `SELECT etag, plan_json, valid_to
       FROM playout_plans
       WHERE device_id = $1
       ORDER BY generated_at DESC
       LIMIT 1`,
      [deviceId]
    );

    let etag = planHash;

    if (rows.length > 0) {
      const latest = rows[0];
      if (new Date(latest.valid_to) > now && JSON.stringify(latest.plan_json) === planJson) {
        etag = latest.etag;
      }
    }

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    await db.query(
      `INSERT INTO playout_plans (device_id, etag, plan_json, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5)`,
      [deviceId, etag, plan, now, validTo]
    );

    res.set('ETag', etag);
    return res.status(200).json(plan);
  } catch (error) {
    return next(error);
  }
});

const sanitizeDuration = (durationMs) => {
  if (durationMs === null || durationMs === undefined) {
    return null;
  }
  if (durationMs < 0) {
    return null;
  }
  const max = 24 * 60 * 60 * 1000;
  return Math.min(durationMs, max);
};

deviceRouter.post('/events', async (req, res, next) => {
  const events = req.body?.events;

  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events must be an array' });
  }

  let accepted = 0;
  let rejected = 0;

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    for (const event of events) {
      const durationMs = sanitizeDuration(event.duration_ms);

      if (!event.event_id || !event.content_id || !event.campaign_id) {
        rejected += 1;
        continue;
      }

      if (event.duration_ms !== undefined && durationMs === null) {
        rejected += 1;
        continue;
      }

      const storeId = event.store_id || req.device.store_id;
      if (!storeId) {
        rejected += 1;
        continue;
      }

      const insertResult = await client.query(
        `INSERT INTO proof_of_play_events
          (event_id, device_id, store_id, campaign_id, playlist_id, content_id, content_version,
           event_type, device_time_ts, duration_ms, result, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.event_id,
          req.device.id,
          storeId,
          event.campaign_id,
          event.playlist_id || null,
          event.content_id,
          event.content_version || 'unknown',
          event.event_type || 'PLAY',
          event.device_time_ts || new Date().toISOString(),
          durationMs,
          event.result || null,
          event.payload_json || {},
        ]
      );

      if (insertResult.rowCount === 0) {
        rejected += 1;
        continue;
      }

      accepted += 1;

      await client.query(
        `INSERT INTO proof_of_play_aggregate_daily
          (day, campaign_id, store_id, content_id, plays_count, total_duration_ms)
         VALUES (date(now()), $1, $2, $3, 1, $4)
         ON CONFLICT (day, campaign_id, store_id, content_id)
         DO UPDATE SET plays_count = proof_of_play_aggregate_daily.plays_count + 1,
                       total_duration_ms = proof_of_play_aggregate_daily.total_duration_ms + EXCLUDED.total_duration_ms`,
        [event.campaign_id, storeId, event.content_id, durationMs || 0]
      );
    }

    await client.query('COMMIT');
    return res.status(200).json({ accepted, rejected });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

app.use('/v1/device', deviceRouter);
app.use('/v1/admin', adminRouter);

module.exports = app;
