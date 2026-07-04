const DEFAULT_CHUNK_SIZE = 500;

function buildBulkInsertSql(tableName, columns, rowCount) {
  const valuesSql = Array.from({ length: rowCount }, (_, rowIndex) => {
    const placeholders = columns.map((_, columnIndex) => {
      const parameterIndex = rowIndex * columns.length + columnIndex + 1;
      return `$${parameterIndex}`;
    });
    return `(${placeholders.join(', ')})`;
  }).join(', ');

  return `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES ${valuesSql}
  `;
}

async function bulkInsert(database, { tableName, columns, rows, mapRow, chunkSize = DEFAULT_CHUNK_SIZE }) {
  if (rows.length === 0) {
    return 0;
  }

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const sql = buildBulkInsertSql(tableName, columns, chunk.length);
    const params = chunk.flatMap((row) => mapRow(row));
    await database.query(sql, params);
  }

  return rows.length;
}

module.exports = {
  bulkInsert,
  buildBulkInsertSql
};
