const path = require('node:path');

const { readValidatedRecords } = require('../imports/excel');
const { runImportTransaction } = require('../imports/transactions');
const { REQUIRED_COLUMNS } = require('./importTemplate');
const { normalizeInterviewRecord, resolveInterviewOverwriteDates } = require('./normalize');
const { insertInterviewRecords, replaceAllInterviewRecords, replaceInterviewRecordsByDates } = require('./repository');

async function readInterviewRecords(filePath) {
  return readValidatedRecords({
    filePath,
    sheetName: undefined,
    requiredColumns: REQUIRED_COLUMNS,
    normalizeRow: normalizeInterviewRecord
  });
}

async function importInterviewRecords(filePath, mode = 'daily_append') {
  const records = await readInterviewRecords(filePath);
  const fileName = path.basename(filePath);

  if (mode === 'full_overwrite') {
    return runImportTransaction({
      sourceType: 'interview_records',
      importMode: mode,
      scope: 'all',
      fileName
    }, (database) => ({
      successCount: replaceAllInterviewRecords(database, records)
    }));
  }

  if (mode === 'daily_overwrite') {
    const dates = resolveInterviewOverwriteDates(records);
    return runImportTransaction({
      sourceType: 'interview_records',
      importMode: mode,
      scope: dates.join(','),
      fileName
    }, (database) => ({
      successCount: replaceInterviewRecordsByDates(database, dates, records)
    }));
  }

  return runImportTransaction({
    sourceType: 'interview_records',
    importMode: 'daily_append',
    scope: 'append',
    fileName
  }, (database) => ({
    successCount: insertInterviewRecords(database, records)
  }));
}

module.exports = {
  importInterviewRecords
};
