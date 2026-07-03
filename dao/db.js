const { connectDatabase } = require('../config/database');

async function getDatabase() {
  return connectDatabase();
}

async function query(sql, params = []) {
  const database = await getDatabase();
  return database.query(sql, params);
}

async function queryAll(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

async function queryOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0];
}

async function execute(sql, params = []) {
  const result = await query(sql, params);
  return {
    rowCount: result.rowCount,
    rows: result.rows
  };
}

async function withTransaction(operation) {
  const database = await getDatabase();
  const client = await database.connect();

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getDatabase,
  query,
  queryAll,
  queryOne,
  execute,
  withTransaction
};
