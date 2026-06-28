const path = require('node:path');

const { readValidatedRecords } = require('../imports/excel');
const { runImportTransaction } = require('../imports/transactions');
const { normalizeTargetRecord } = require('./normalize');
const { replaceTargetsByMonth } = require('./repository');

const REQUIRED_COLUMNS = ['年月份', '基地', '渠道', '招聘订单类型', '7天留存率目标', '15天留存率目标', '30天留存率目标', '招聘目标'];

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
  }, (database) => ({
    yearMonth,
    successCount: replaceTargetsByMonth(database, yearMonth, records)
  }));
}

module.exports = {
  importMonthlyTargets
};
