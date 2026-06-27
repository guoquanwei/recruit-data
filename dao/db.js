const { connectDatabase } = require('../config/database');

function runStatement(statement, method, params) {
  if (Array.isArray(params)) {
    return statement[method](...params);
  }

  if (params && typeof params === 'object') {
    return statement[method](params);
  }

  return statement[method]();
}

function getDatabase() {
  return connectDatabase();
}

function queryAll(sql, params) {
  return runStatement(getDatabase().prepare(sql), 'all', params);
}

function queryOne(sql, params) {
  return runStatement(getDatabase().prepare(sql), 'get', params);
}

function execute(sql, params) {
  return runStatement(getDatabase().prepare(sql), 'run', params);
}

module.exports = {
  getDatabase,
  queryAll,
  queryOne,
  execute
};
