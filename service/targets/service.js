const { listAllEmployees } = require('../employees/repository');
const { getMonthLastDay } = require('../shared/date');
const { formatPercent, parsePage, toText } = require('../shared/format');
const { calculateTargetProgress, CHANNEL_ORDER } = require('./progress');
const { getAvailableMonths, getDistinctTargetFilterOptions, listTargets, listTargetsByMonth } = require('./repository');

function buildTargetFilters(query = {}) {
  return {
    yearMonth: toText(query.yearMonth),
    base: toText(query.base),
    channel: toText(query.channel),
    keyword: toText(query.keyword)
  };
}

function getDefaultMonth(query = {}) {
  if (query.yearMonth) {
    return query.yearMonth;
  }

  return getAvailableMonths()[0] || '';
}

function getCutoffDate(yearMonth, query = {}) {
  if (query.cutoffDate) {
    return query.cutoffDate;
  }
  if (!yearMonth) {
    return '';
  }

  return `${yearMonth}-${String(getMonthLastDay(yearMonth)).padStart(2, '0')}`;
}

function getTargetList(query = {}) {
  const page = parsePage(query);
  const filters = buildTargetFilters(query);
  const employees = listAllEmployees();
  const cutoffDate = getCutoffDate(filters.yearMonth || getDefaultMonth(query), query);
  const result = listTargets({ filters, page });

  return {
    ...result,
    rows: result.rows.map((target) => ({
      ...target,
      progress: calculateTargetProgress({ target, employees, cutoffDate })
    })),
    page,
    filters,
    options: getDistinctTargetFilterOptions(),
    emptyMessage: result.total === 0
      ? '没有符合筛选条件的目标数据，请调整筛选项后重试。'
      : ''
  };
}

function summarizeTargets(targets, employees, cutoffDate) {
  const channelMap = new Map();
  const baseMap = new Map();
  let overallMonthlyTarget = 0;
  let overallCutoffTarget = 0;
  let overallActual = 0;

  targets.forEach((target) => {
    const progress = calculateTargetProgress({ target, employees, cutoffDate });
    overallMonthlyTarget += progress.monthlyTarget;
    overallCutoffTarget += progress.cutoffTarget;
    overallActual += progress.actualTraining;

    const channel = channelMap.get(target.channel) || { channel: target.channel, monthlyTarget: 0, cutoffTarget: 0, actualTraining: 0 };
    channel.monthlyTarget += progress.monthlyTarget;
    channel.cutoffTarget += progress.cutoffTarget;
    channel.actualTraining += progress.actualTraining;
    channelMap.set(target.channel, channel);

    const base = baseMap.get(target.base) || { base: target.base, monthlyTarget: 0, cutoffTarget: 0, actualTraining: 0, channels: [] };
    base.monthlyTarget += progress.monthlyTarget;
    base.cutoffTarget += progress.cutoffTarget;
    base.actualTraining += progress.actualTraining;
    base.channels.push({ target, progress });
    baseMap.set(target.base, base);
  });

  const overallGap = overallActual - overallMonthlyTarget;
  const baseSummaries = Array.from(baseMap.values()).map((base) => {
    const gap = base.actualTraining - base.monthlyTarget;
    return {
      ...base,
      gap,
      achievementRate: base.monthlyTarget > 0 ? base.actualTraining / base.monthlyTarget : 0,
      achievementRateText: formatPercent(base.monthlyTarget > 0 ? base.actualTraining / base.monthlyTarget : 0),
      shortageChannels: base.channels
        .map(({ target, progress }) => ({ channel: target.channel, gap: progress.gap }))
        .filter((item) => item.gap < 0)
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 3)
    };
  });

  const channels = CHANNEL_ORDER
    .filter((channel) => channel !== '合计')
    .map((channel) => {
      const item = channelMap.get(channel) || { channel, monthlyTarget: 0, cutoffTarget: 0, actualTraining: 0 };
      const targetShare = overallMonthlyTarget > 0 ? item.monthlyTarget / overallMonthlyTarget : 0;
      const actualShare = overallActual > 0 ? item.actualTraining / overallActual : 0;
      return {
        ...item,
        gap: item.actualTraining - item.monthlyTarget,
        targetShare,
        actualShare,
        targetShareText: formatPercent(targetShare),
        actualShareText: formatPercent(actualShare),
        shareGapText: formatPercent(actualShare - targetShare)
      };
    });

  return {
    overall: {
      monthlyTarget: overallMonthlyTarget,
      cutoffTarget: overallCutoffTarget,
      actualTraining: overallActual,
      gap: overallGap,
      achievementRate: overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0,
      achievementRateText: formatPercent(overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0),
      unmetBaseCount: baseSummaries.filter((base) => base.gap < 0).length
    },
    channels,
    bases: baseSummaries
  };
}

function getTargetProgress(query = {}) {
  const yearMonth = getDefaultMonth(query);
  const cutoffDate = getCutoffDate(yearMonth, query);
  const targets = yearMonth ? listTargetsByMonth(yearMonth) : [];
  const employees = listAllEmployees();

  return {
    yearMonth,
    cutoffDate,
    months: getAvailableMonths(),
    ...summarizeTargets(targets, employees, cutoffDate)
  };
}

module.exports = {
  getTargetList,
  getTargetProgress,
  summarizeTargets
};
