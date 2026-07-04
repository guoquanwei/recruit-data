const path = require('node:path');

require('dotenv').config({ quiet: true });

const appRoot = path.resolve(__dirname, '..');
const databaseUrl = process.env.DATABASE_URL || '';

function getDefaultDatabaseSchema(url) {
  if (!url) {
    return '';
  }

  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return '';
  }
}

module.exports = {
  appRoot,
  port: Number(process.env.PORT || 3000),
  databaseUrl,
  databaseSchema: process.env.DB_SCHEMA || getDefaultDatabaseSchema(databaseUrl),
  platformName: '人力招聘数据分析后台',
};