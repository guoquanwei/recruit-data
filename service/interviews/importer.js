const path = require('node:path');

const { readValidatedRecords } = require('../imports/excel');
const { runImportTransaction } = require('../imports/transactions');
const { REQUIRED_COLUMNS } = require('./importTemplate');
const { normalizeInterviewRecord, resolveInterviewOverwriteDates } = require('./normalize');
const { replaceAllInterviewRecords, replaceInterviewRecordsByDates } = require('./repository');

async function readInterviewRecords(filePath) {
  return readValidatedRecords({
    filePath,
    sheetName: undefined,
    requiredColumns: REQUIRED_COLUMNS,
    normalizeRow: normalizeInterviewRecord
  });
}

async function importInterviewRecords(filePath, mode = 'daily_overwrite') {
  if (!['daily_overwrite', 'full_overwrite'].includes(mode)) {
    throw new Error(`不支持的面试记录导入模式：${mode}`);
  }

  const records = await readInterviewRecords(filePath);
  const fileName = path.basename(filePath);

  if (mode === 'full_overwrite') {
    return runImportTransaction({
      sourceType: 'interview_records',
      importMode: mode,
      scope: 'all',
      fileName
    }, async (database) => ({
      successCount: await replaceAllInterviewRecords(database, records)
    }));
  }

  if (mode === 'daily_overwrite') {
    const dates = resolveInterviewOverwriteDates(records);
    return runImportTransaction({
      sourceType: 'interview_records',
      importMode: mode,
      scope: dates.join(','),
      fileName
    }, async (database) => ({
      successCount: await replaceInterviewRecordsByDates(database, dates, records)
    }));
  }

  const dates = resolveInterviewOverwriteDates(records);
  return runImportTransaction({
    sourceType: 'interview_records',
    importMode: 'daily_overwrite',
    scope: dates.join(','),
    fileName
  }, async (database) => ({
    successCount: await replaceInterviewRecordsByDates(database, dates, records)
  }));
}

module.exports = {
  importInterviewRecords
};
