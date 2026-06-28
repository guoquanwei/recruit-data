const EXCEL_EPOCH_OFFSET = 25569;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseExcelSerialDate(value) {
  const serial = Number(value);

  if (!Number.isFinite(serial)) {
    return '';
  }

  const timestamp = Math.round((serial - EXCEL_EPOCH_OFFSET) * MILLISECONDS_PER_DAY);
  return formatDate(new Date(timestamp));
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (value instanceof Date) {
    return formatDate(value);
  }

  if (typeof value === 'number') {
    return parseExcelSerialDate(value);
  }

  const text = String(value).trim();

  if (!text) {
    return '';
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return parseExcelSerialDate(Number(text));
  }

  const normalized = text.replace(/\//g, '-').replace(/\./g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (match) {
    return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
  }

  const date = new Date(text);
  return formatDate(date);
}

function getYearMonth(value) {
  return normalizeDate(value).slice(0, 7);
}

function getDayOfMonth(value) {
  const date = normalizeDate(value);
  const day = Number.parseInt(date.slice(8, 10), 10);

  return Number.isFinite(day) ? day : 0;
}

function getMonthLastDay(yearMonth) {
  const [year, month] = String(yearMonth).split('-').map(Number);

  if (!year || !month) {
    return 31;
  }

  return new Date(year, month, 0).getDate();
}

module.exports = {
  formatDate,
  normalizeDate,
  getYearMonth,
  getDayOfMonth,
  getMonthLastDay
};
