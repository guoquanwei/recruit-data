const { getDatabase } = require('../../dao/db');

function replaceTargetsByMonth(database, yearMonth, targets) {
  database.prepare('DELETE FROM recruitment_targets WHERE year_month = ?').run(yearMonth);

  const statement = database.prepare(`
    INSERT INTO recruitment_targets (
      year_month,
      base,
      channel,
      order_type,
      retention_7_rate,
      retention_15_rate,
      retention_30_rate,
      monthly_target,
      day_targets_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  targets.forEach((target) => {
    statement.run(
      target.yearMonth,
      target.base,
      target.channel,
      target.orderType,
      target.retention7Rate,
      target.retention15Rate,
      target.retention30Rate,
      target.monthlyTarget,
      JSON.stringify(target.dailyTargets)
    );
  });

  return targets.length;
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
  const params = {};

  if (filters.yearMonth) {
    where.push('year_month = @yearMonth');
    params.yearMonth = filters.yearMonth;
  }
  if (filters.base) {
    where.push('base = @base');
    params.base = filters.base;
  }
  if (filters.channel) {
    where.push('channel = @channel');
    params.channel = filters.channel;
  }
  if (filters.keyword) {
    where.push('(base LIKE @keyword OR channel LIKE @keyword OR order_type LIKE @keyword)');
    params.keyword = `%${filters.keyword}%`;
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

function listTargets({ filters = {}, page }) {
  const database = getDatabase();
  const { whereSql, params } = buildTargetFilters(filters);
  const total = database.prepare(`SELECT COUNT(*) AS total FROM recruitment_targets ${whereSql}`).get(params).total;
  const rows = database.prepare(`
    SELECT *
    FROM recruitment_targets
    ${whereSql}
    ORDER BY year_month DESC, base ASC, channel ASC
    LIMIT @limit OFFSET @offset
  `).all({
    ...params,
    limit: page.limit,
    offset: page.offset
  });

  return {
    total,
    rows: rows.map(fromDatabaseRow)
  };
}

function listTargetsByMonth(yearMonth) {
  const database = getDatabase();
  return database.prepare(`
    SELECT *
    FROM recruitment_targets
    WHERE year_month = ?
    ORDER BY base ASC, channel ASC
  `).all(yearMonth).map(fromDatabaseRow);
}

function getAvailableMonths() {
  const database = getDatabase();
  return database.prepare(`
    SELECT DISTINCT year_month AS yearMonth
    FROM recruitment_targets
    ORDER BY year_month DESC
  `).all().map((row) => row.yearMonth);
}

function getDistinctTargetFilterOptions() {
  const database = getDatabase();
  const pluck = (sql, field) => database.prepare(sql).all().map((row) => row[field]).filter(Boolean);

  return {
    months: pluck('SELECT DISTINCT year_month FROM recruitment_targets ORDER BY year_month DESC', 'year_month'),
    bases: pluck('SELECT DISTINCT base FROM recruitment_targets ORDER BY base', 'base'),
    channels: pluck('SELECT DISTINCT channel FROM recruitment_targets ORDER BY channel', 'channel')
  };
}

module.exports = {
  replaceTargetsByMonth,
  listTargets,
  listTargetsByMonth,
  getAvailableMonths,
  getDistinctTargetFilterOptions,
  fromDatabaseRow
};
