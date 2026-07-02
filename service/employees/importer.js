const path = require('node:path');

const { readValidatedRecords } = require('../imports/excel');
const { runImportTransaction } = require('../imports/transactions');
const { ACTIVE_REQUIRED_COLUMNS, RESIGNED_REQUIRED_COLUMNS } = require('./importTemplate');
const { normalizeActiveEmployee, normalizeResignedEmployee } = require('./normalize');
const { replaceEmployeesBySource } = require('./repository');

async function importActiveEmployees(filePath) {
  const records = await readValidatedRecords({
    filePath,
    sheetName: '在职员工信息',
    requiredColumns: ACTIVE_REQUIRED_COLUMNS,
    normalizeRow: normalizeActiveEmployee
  });

  return runImportTransaction({
    sourceType: 'employees.active',
    importMode: 'full_overwrite',
    scope: 'active',
    fileName: path.basename(filePath)
  }, (database) => ({
    successCount: replaceEmployeesBySource(database, 'active', records)
  }));
}

async function importResignedEmployees(filePath) {
  const records = await readValidatedRecords({
    filePath,
    sheetName: '离职员工信息',
    requiredColumns: RESIGNED_REQUIRED_COLUMNS,
    normalizeRow: normalizeResignedEmployee
  });

  return runImportTransaction({
    sourceType: 'employees.resigned',
    importMode: 'full_overwrite',
    scope: 'resigned',
    fileName: path.basename(filePath)
  }, (database) => ({
    successCount: replaceEmployeesBySource(database, 'resigned', records)
  }));
}

module.exports = {
  importActiveEmployees,
  importResignedEmployees
};
