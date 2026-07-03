const path = require('node:path');

const { readValidatedRecords } = require('../imports/excel');
const { runImportTransaction } = require('../imports/transactions');
const { REQUIRED_COLUMNS } = require('./importTemplate');
const { normalizeTargetRecord } = require('./normalize');
const { replaceTargetsByMonth } = require('./repository');

async function importMonthlyTargets(filePath) {
  const records = (await readValidatedRecords({
    filePath,
    sheetName: '整体目标',
    requiredColumns: REQUIRED_COLUMNS,
    normalizeRow: normalizeTargetRecord
  })).filter((record) => record.yearMonth);

  if (records.length === 0) {
    throw new Error('目标表没有可导入的数据');
  }

  const yearMonth = records[0].yearMonth;
  const invalidMonth = records.find((record) => record.yearMonth !== yearMonth);

  if (invalidMonth) {
    throw new Error('同一个目标文件只能包含一个月份的数据');
  }

  return runImportTransaction({
    sourceType: 'recruitment_targets',
    importMode: 'month_overwrite',
    scope: yearMonth,
    fileName: path.basename(filePath)
  }, async (database) => ({
    yearMonth,
    successCount: await replaceTargetsByMonth(database, yearMonth, records)
  }));
}

module.exports = {
  importMonthlyTargets
};
