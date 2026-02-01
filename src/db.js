const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl });

const query = (...args) => pool.query(...args);
const connect = () => pool.connect();
const end = () => pool.end();

module.exports = {
  query,
  connect,
  end,
};
