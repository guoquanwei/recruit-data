const path = require('node:path');

require('dotenv').config({ quiet: true });

const appRoot = path.resolve(__dirname, '..');
const sqliteMode = process.env.SQLITE_MODE === 'memory' ? 'memory' : 'file';
const sqliteFile = process.env.SQLITE_FILE || 'data/recruitment.db';

module.exports = {
  appRoot,
  port: Number(process.env.PORT || 3000),
  platformName: '人力招聘数据分析后台',
  sqlite: {
    mode: sqliteMode,
    file: sqliteFile,
    path: sqliteMode === 'memory' ? ':memory:' : path.resolve(appRoot, sqliteFile)
  }
};
