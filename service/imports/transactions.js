const { queryOne, withTransaction } = require('../../dao/db');

async function createImportBatch(database, batch) {
  const result = await database.query(`
    INSERT INTO import_batches (
      source_type,
      import_mode,
      scope,
      file_name,
      status,
      success_count,
      failure_count,
      error_summary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [
    batch.sourceType,
    batch.importMode,
    batch.scope || '',
    batch.fileName || '',
    batch.status,
    batch.successCount || 0,
    batch.failureCount || 0,
    batch.errorSummary || ''
  ]);

  return result.rows[0].id;
}

async function runImportTransaction(batch, operation) {
  try {
    return await withTransaction(async (database) => {
      const result = await operation(database);
      const successCount = result.successCount ?? result.count ?? 0;
      const batchId = await createImportBatch(database, {
        ...batch,
        status: 'success',
        successCount,
        failureCount: 0
      });

      return {
        ...result,
        batchId,
        successCount,
        failureCount: 0,
        status: 'success'
      };
    });
  } catch (error) {
    const row = await queryOne(`
      INSERT INTO import_batches (
        source_type,
        import_mode,
        scope,
        file_name,
        status,
        success_count,
        failure_count,
        error_summary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      batch.sourceType,
      batch.importMode,
      batch.scope || '',
      batch.fileName || '',
      'failed',
      0,
      1,
      error.message
    ]);
    const batchId = row.id;

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
