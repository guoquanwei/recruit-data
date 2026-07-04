const { queryAll, queryOne } = require('../../dao/db');
const { bulkInsert } = require('../../dao/bulkInsert');
const { toText } = require('../shared/format');

const TARGET_COLUMNS = [
  'year_month',
  'base',
  'channel',
  'order_type',
  'retention_7_rate',
  'retention_15_rate',
  'retention_30_rate',
  'monthly_target',
  'day_targets_json'
];

async function replaceTargetsByMonth(database, yearMonth, targets) {
  await database.query('DELETE FROM recruitment_targets WHERE year_month = $1', [yearMonth]);

  return bulkInsert(database, {
    tableName: 'recruitment_targets',
    columns: TARGET_COLUMNS,
    rows: targets,
    mapRow: (target) => [
      target.yearMonth,
      target.base,
      target.channel,
      target.orderType,
      target.retention7Rate,
      target.retention15Rate,
      target.retention30Rate,
      target.monthlyTarget,
      JSON.stringify(target.dailyTargets)
    ]
  });
}

function fromDatabaseRow(row) {
  return {
    id: row.id,
    yearMonth: row.year_month,
    base: row.base,
    channel: row.channel,
    orderType: row.order_type,
    retention7Rate: row.retention_7_rate,
    retention15Rate: row.retention_15_rate,
    retention30Rate: row.retention_30_rate,
    monthlyTarget: row.monthly_target,
    dailyTargets: JSON.parse(row.day_targets_json || '{}')
  };
}

function buildTargetFilters(filters = {}) {
  const where = [];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.yearMonth) {
    where.push(`year_month = ${addParam(filters.yearMonth)}`);
  }
  if (filters.base) {
    where.push(`base = ${addParam(filters.base)}`);
  }
  if (filters.channel) {
    where.push(`channel = ${addParam(filters.channel)}`);
  }
  if (filters.keyword) {
    const keyword = addParam(`%${filters.keyword}%`);
    where.push(`(base LIKE ${keyword} OR channel LIKE ${keyword} OR order_type LIKE ${keyword})`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

async function listTargets({ filters = {}, page }) {
  const { whereSql, params } = buildTargetFilters(filters);
  const total = await queryOne(`SELECT COUNT(*)::int AS total FROM recruitment_targets ${whereSql}`, params);
  const rows = await queryAll(`
    SELECT *
    FROM recruitment_targets
    ${whereSql}
    ORDER BY year_month DESC, base ASC, channel ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, page.limit, page.offset]);

  return {
    total: total.total,
    rows: rows.map(fromDatabaseRow)
  };
}

async function listTargetsByMonth(yearMonth) {
  const rows = await queryAll(`
    SELECT *
    FROM recruitment_targets
    WHERE year_month = $1
    ORDER BY base ASC, channel ASC
  `, [yearMonth]);
  return rows.map(fromDatabaseRow);
}

async function listTargetsForSummary(filters = {}) {
  const { whereSql, params } = buildTargetFilters(filters);

  const rows = await queryAll(`
    SELECT *
    FROM recruitment_targets
    ${whereSql}
    ORDER BY year_month DESC, base ASC, channel ASC
  `, params);
  return rows.map(fromDatabaseRow);
}

async function getAvailableMonths() {
  const rows = await queryAll(`
    SELECT DISTINCT year_month AS yearMonth
    FROM recruitment_targets
    ORDER BY year_month DESC
  `);
  return rows.map((row) => row.yearmonth);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

function formatDistinctTargetFilterOptions(targets = [], filters = {}) {
  const yearMonth = toText(filters.yearMonth);
  const base = toText(filters.base);
  const monthRows = targets.filter((target) => !yearMonth || target.yearMonth === yearMonth);
  const scopedRows = monthRows.filter((target) => !base || target.base === base);

  return {
    months: uniqueSorted(targets.map((target) => target.yearMonth)).reverse(),
    bases: uniqueSorted(monthRows.map((target) => target.base)),
    channels: uniqueSorted(scopedRows.map((target) => target.channel))
  };
}

async function getDistinctTargetFilterOptions(filters = {}) {
  const targets = await queryAll(`
    SELECT year_month AS "yearMonth", base, channel
    FROM recruitment_targets
    ORDER BY year_month DESC, base ASC, channel ASC
  `);

  return formatDistinctTargetFilterOptions(targets, filters);
}

module.exports = {
  replaceTargetsByMonth,
  listTargets,
  listTargetsByMonth,
  listTargetsForSummary,
  getAvailableMonths,
  getDistinctTargetFilterOptions,
  formatDistinctTargetFilterOptions,
  fromDatabaseRow
};
