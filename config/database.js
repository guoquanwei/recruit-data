const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const runtime = require('./runtime');

let database;

function ensureDatabaseDirectory() {
  if (runtime.sqlite.mode === 'memory') {
    return;
  }

  fs.mkdirSync(path.dirname(runtime.sqlite.path), { recursive: true });
}

function connectDatabase() {
  if (database) {
    return database;
  }

  ensureDatabaseDirectory();
  database = new DatabaseSync(runtime.sqlite.path);
  database.exec('PRAGMA foreign_keys = ON;');

  return database;
}

function closeDatabase() {
  if (!database) {
    return;
  }

  database.close();
  database = undefined;
}

module.exports = {
  connectDatabase,
  closeDatabase
};
