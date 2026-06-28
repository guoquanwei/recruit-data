function toText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function maskPhone(value) {
  const text = toText(value);
  const digits = text.replace(/\D/g, '');

  if (digits.length !== 11) {
    return text;
  }

  return `${digits.slice(0, 3)}****${digits.slice(7)}`;
}

function parsePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }

  return number;
}

function parsePage(query = {}) {
  const page = parsePositiveInteger(query.page, 1);
  const pageSize = parsePositiveInteger(query.pageSize, 10);

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize
  };
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '0.00%';
  }

  return `${(number * 100).toFixed(2)}%`;
}

function formatInteger(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(number);
}

module.exports = {
  toText,
  maskPhone,
  parsePage,
  formatPercent,
  formatInteger
};
