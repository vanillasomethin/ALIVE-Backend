const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config();

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

const getMigrationFiles = () => {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
};

const run = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await client.query('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.id));

  const files = getMigrationFiles();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`Applied migration: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  await client.end();
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
