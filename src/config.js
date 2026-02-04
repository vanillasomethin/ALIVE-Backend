const required = (name, value) => {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL', process.env.DATABASE_URL),
};

module.exports = config;
