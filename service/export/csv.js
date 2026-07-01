function escapeCsvValue(value) {
  const text = value === undefined || value === null ? '' : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildCsv(columns, rows) {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(',');
  const body = rows.map((row) => (
    columns.map((column) => escapeCsvValue(column.value(row))).join(',')
  ));

  return `\uFEFF${[header, ...body].join('\n')}`;
}

function sendCsv(res, filename, columns, rows) {
  const encodedFilename = encodeURIComponent(filename);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
  res.send(buildCsv(columns, rows));
}

module.exports = {
  buildCsv,
  sendCsv
};
