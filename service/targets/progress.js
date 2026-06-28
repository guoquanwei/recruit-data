const { getDayOfMonth, getMonthLastDay, normalizeDate } = require('../shared/date');
const { formatPercent, formatInteger, toText } = require('../shared/format');

const CHANNEL_ORDER = ['回流', '内推', '渠道社招', '渠道校招', '自主社招', '合计'];

function getDailyTargets(target) {
  if (target.dailyTargets) {
    return target.dailyTargets;
  }

  const dailyTargets = {};
  for (let day = 1; day <= 31; day += 1) {
    dailyTargets[day] = Number(target[`day${day}`] || 0);
  }
  return dailyTargets;
}

function sumDailyTargets(target, endDay) {
  const dailyTargets = getDailyTargets(target);
  let total = 0;

  for (let day = 1; day <= endDay; day += 1) {
    total += Number(dailyTargets[day] || 0);
  }

  return formatInteger(total);
}

function sameMonth(date, yearMonth) {
  return normalizeDate(date).startsWith(yearMonth);
}

function matchesTarget(employee, target) {
  return toText(employee.base) === toText(target.base)
    && toText(employee.channelType) === toText(target.channel);
}

function countActualTraining({ target, employees }) {
  const seen = new Set();
  const yearMonth = target.yearMonth;

  employees.forEach((employee) => {
    if (!employee.employeeNo || !sameMonth(employee.trainingDate, yearMonth) || !matchesTarget(employee, target)) {
      return;
    }
    seen.add(employee.employeeNo);
  });

  return seen.size;
}

function calculateTargetProgress({ target, employees = [], cutoffDate }) {
  const lastDay = getMonthLastDay(target.yearMonth);
  const cutoffDay = cutoffDate && normalizeDate(cutoffDate).startsWith(target.yearMonth)
    ? getDayOfMonth(cutoffDate)
    : lastDay;
  const monthlyTarget = sumDailyTargets(target, lastDay);
  const cutoffTarget = sumDailyTargets(target, cutoffDay);
  const actualTraining = countActualTraining({ target, employees });
  const gap = actualTraining - monthlyTarget;
  const achievementRate = monthlyTarget > 0 ? actualTraining / monthlyTarget : 0;

  return {
    monthlyTarget,
    cutoffTarget,
    actualTraining,
    gap,
    achievementRate,
    achievementRateText: formatPercent(achievementRate)
  };
}

module.exports = {
  CHANNEL_ORDER,
  sumDailyTargets,
  calculateTargetProgress,
  countActualTraining
};
