const { getDatabase } = require('../../dao/db');

function createImportBatch(database, batch) {
  const result = database.prepare(`
    INSERT INTO import_batches (
      source_type,
      import_mode,
      scope,
      file_name,
      status,
      success_count,
      failure_count,
      error_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    batch.sourceType,
    batch.importMode,
    batch.scope || '',
    batch.fileName || '',
    batch.status,
    batch.successCount || 0,
    batch.failureCount || 0,
    batch.errorSummary || ''
  );

  return result.lastInsertRowid;
}

function runImportTransaction(batch, operation) {
  const database = getDatabase();

  try {
    database.exec('BEGIN');
    const result = operation(database);
    const successCount = result.successCount ?? result.count ?? 0;
    const batchId = createImportBatch(database, {
      ...batch,
      status: 'success',
      successCount,
      failureCount: 0
    });
    database.exec('COMMIT');

    return {
      ...result,
      batchId,
      successCount,
      failureCount: 0,
      status: 'success'
    };
  } catch (error) {
    database.exec('ROLLBACK');
    const batchId = createImportBatch(database, {
      ...batch,
      status: 'failed',
      successCount: 0,
      failureCount: 1,
      errorSummary: error.message
    });

    return {
      batchId,
      status: 'failed',
      successCount: 0,
      failureCount: 1,
      errorSummary: error.message
    };
  }
}

module.exports = {
  runImportTransaction
};
