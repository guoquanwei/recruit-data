const { Pool } = require('pg');

const { initializeAiModelConfig } = require('./ai');
const { initializeBusinessSchema } = require('../dao/schema');
const runtime = require('./runtime');

let pool;

function quoteConnectionValue(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function createPool() {
  if (!runtime.databaseUrl) {
    throw new Error('DATABASE_URL is required for PostgreSQL connection');
  }

  return new Pool({
    connectionString: runtime.databaseUrl,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
    options: runtime.databaseSchema
      ? `-c search_path=${quoteConnectionValue(runtime.databaseSchema)},public`
      : undefined
  });
}

async function connectDatabase() {
  if (pool) {
    return pool;
  }

  pool = createPool();
  await pool.query('SELECT 1');
  await initializeBusinessSchema(pool, runtime.databaseSchema);
  await initializeAiModelConfig(pool);

  return pool;
}

async function closeDatabase() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = undefined;
}

module.exports = {
  connectDatabase,
  closeDatabase
};
