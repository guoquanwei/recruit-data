const { getYearMonth } = require('../shared/date');
const { formatInteger, toText } = require('../shared/format');

function normalizeTargetRecord(row) {
  const dailyTargets = {};
  let monthlyTarget = 0;

  for (let day = 1; day <= 31; day += 1) {
    const value = formatInteger(row[`${day}日`]);
    dailyTargets[day] = value;
    monthlyTarget += value;
  }

  return {
    yearMonth: getYearMonth(row.年月份),
    base: toText(row.基地),
    channel: toText(row.渠道),
    orderType: toText(row.招聘订单类型),
    retention7Rate: Number(row['7天留存率目标'] || 0),
    retention15Rate: Number(row['15天留存率目标'] || 0),
    retention30Rate: Number(row['30天留存率目标'] || 0),
    monthlyTarget,
    dailyTargets
  };
}

module.exports = {
  normalizeTargetRecord
};
