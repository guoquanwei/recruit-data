const ExcelJS = require('exceljs');

function cellToValue(cell) {
  const value = cell.value;

  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object') {
    if (value.text) {
      return value.text;
    }
    if (value.result !== undefined) {
      return value.result;
    }
    if (value.richText) {
      return value.richText.map((item) => item.text).join('');
    }
  }

  return value;
}

async function readSheetRows(filePath, sheetName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];

  if (!sheet) {
    throw new Error(`缺少工作表：${sheetName || '第一个工作表'}`);
  }

  const headerRow = sheet.getRow(1);
  const rawHeaders = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    rawHeaders[columnNumber] = String(cellToValue(cell)).trim();
  });
  const headers = makeUniqueHeaders(rawHeaders);

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const record = {};
    headers.forEach((header, columnNumber) => {
      if (!header) {
        return;
      }
      record[header] = cellToValue(row.getCell(columnNumber));
    });
    rows.push(record);
  });

  return rows;
}

function makeUniqueHeaders(rawHeaders) {
  const seen = new Map();

  return rawHeaders.map((header) => {
    if (!header) {
      return '';
    }

    const count = seen.get(header) || 0;
    seen.set(header, count + 1);

    if (count === 0) {
      return header;
    }

    return `${header}.${count}`;
  });
}

function validateRequiredColumns(rows, requiredColumns) {
  const firstRow = rows[0] || {};
  const columns = new Set(Object.keys(firstRow));
  const missingColumns = requiredColumns.filter((column) => !columns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(`缺少必填列：${missingColumns.join('、')}`);
  }
}

function normalizeRows(rows, normalizeRow) {
  const records = [];
  const errors = [];

  rows.forEach((row, index) => {
    try {
      records.push(normalizeRow(row));
    } catch (error) {
      errors.push(`第 ${index + 2} 行：${error.message}`);
    }
  });

  if (errors.length > 0) {
    throw new Error(errors.slice(0, 10).join('；'));
  }

  return records;
}

async function readValidatedRecords({ filePath, sheetName, requiredColumns, normalizeRow }) {
  const rows = await readSheetRows(filePath, sheetName);
  validateRequiredColumns(rows, requiredColumns);

  return normalizeRows(rows, normalizeRow);
}

module.exports = {
  makeUniqueHeaders,
  readSheetRows,
  validateRequiredColumns,
  normalizeRows,
  readValidatedRecords
};
