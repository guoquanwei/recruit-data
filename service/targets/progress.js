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

function matchesTarget(employee, target) {
  return toText(employee.base) === toText(target.base)
    && toText(employee.channelType) === toText(target.channel);
}

function countActualTraining({ target, employees, cutoffDate }) {
  const seen = new Set();
  const yearMonth = target.yearMonth;
  const normalizedCutoffDate = normalizeDate(cutoffDate);

  employees.forEach((employee) => {
    const trainingDate = normalizeDate(employee.trainingDate);
    if (!employee.employeeNo || !trainingDate.startsWith(yearMonth) || !matchesTarget(employee, target)) {
      return;
    }
    if (normalizedCutoffDate && normalizedCutoffDate.startsWith(yearMonth) && trainingDate > normalizedCutoffDate) {
      return;
    }
    seen.add(employee.employeeNo);
  });

  return seen.size;
}

function getActualTrainingKey({ yearMonth, base, channel }) {
  return `${yearMonth}::${toText(base)}::${toText(channel)}`;
}

function buildActualTrainingIndex(employees = []) {
  const index = new Map();

  employees.forEach((employee) => {
    const trainingDate = normalizeDate(employee.trainingDate);
    const yearMonth = trainingDate.slice(0, 7);
    const base = toText(employee.base);
    const channel = toText(employee.channelType);
    const employeeKey = employee.employeeNo || employee.phone || employee.name;
    if (!yearMonth || !base || !channel || !employeeKey) {
      return;
    }

    const key = getActualTrainingKey({ yearMonth, base, channel });
    if (!index.has(key)) {
      index.set(key, new Set());
    }
    index.get(key).add(employeeKey);
  });

  return index;
}

function getIndexedActualTraining(target, actualTrainingIndex) {
  if (!actualTrainingIndex) {
    return undefined;
  }
  const key = getActualTrainingKey({
    yearMonth: target.yearMonth,
    base: target.base,
    channel: target.channel
  });
  return actualTrainingIndex.get(key)?.size || 0;
}

function calculateTargetProgress({ target, employees = [], cutoffDate, actualTrainingIndex }) {
  const lastDay = getMonthLastDay(target.yearMonth);
  const cutoffDay = cutoffDate && normalizeDate(cutoffDate).startsWith(target.yearMonth)
    ? getDayOfMonth(cutoffDate)
    : lastDay;
  const monthlyTarget = sumDailyTargets(target, lastDay);
  const cutoffTarget = sumDailyTargets(target, cutoffDay);
  const indexedActualTraining = cutoffDay === lastDay
    ? getIndexedActualTraining(target, actualTrainingIndex)
    : undefined;
  const actualTraining = indexedActualTraining === undefined
    ? countActualTraining({ target, employees, cutoffDate })
    : indexedActualTraining;
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
  buildActualTrainingIndex,
  calculateTargetProgress,
  countActualTraining
};
