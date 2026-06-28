const path = require('node:path');

const { readValidatedRecords } = require('../imports/excel');
const { runImportTransaction } = require('../imports/transactions');
const { normalizeActiveEmployee, normalizeResignedEmployee } = require('./normalize');
const { replaceEmployeesBySource } = require('./repository');

const ACTIVE_REQUIRED_COLUMNS = ['工号', '姓名', '入培时间', '手机号码', '招聘渠道', '渠道名称', '办公地点', '部门', '职位', '员工状态'];
const RESIGNED_REQUIRED_COLUMNS = ['工号', '姓名', '入培时间', '手机号码', '招聘渠道', '渠道名称', '办公地点', '离职前部门', '离职前职位', '离职日期'];

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
