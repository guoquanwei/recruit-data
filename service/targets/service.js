const { listAllEmployees } = require('../employees/repository');
const { getMonthLastDay } = require('../shared/date');
const { formatPercent, parsePage, toText } = require('../shared/format');
const { buildActualTrainingIndex, calculateTargetProgress, CHANNEL_ORDER } = require('./progress');
const { getAvailableMonths, getDistinctTargetFilterOptions, listTargets, listTargetsByMonth, listTargetsForSummary } = require('./repository');

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
  const hasYearMonthQuery = Object.prototype.hasOwnProperty.call(query, 'yearMonth');
  const displayMonth = hasYearMonthQuery ? filters.yearMonth : getDefaultMonth(query);
  filters.yearMonth = displayMonth;
  const cutoffDate = getCutoffDate(displayMonth, query);
  const result = listTargets({ filters, page });
  const summaryTargets = listTargetsForSummary(filters);
  const actualTrainingIndex = buildActualTrainingIndex(employees);

  return {
    ...result,
    rows: result.rows.map((target) => ({
      ...target,
      progress: calculateTargetProgress({ target, employees, cutoffDate, actualTrainingIndex })
    })),
    page,
    filters,
    options: getDistinctTargetFilterOptions(),
    summary: summarizeTargetPlan(summaryTargets, displayMonth),
    emptyMessage: result.total === 0
      ? '没有符合筛选条件的目标数据，请调整筛选项后重试。'
      : ''
  };
}

function getTargetExportRows(query = {}) {
  const filters = buildTargetFilters(query);
  const hasYearMonthQuery = Object.prototype.hasOwnProperty.call(query, 'yearMonth');
  filters.yearMonth = hasYearMonthQuery ? filters.yearMonth : getDefaultMonth(query);
  const employees = listAllEmployees();
  const actualTrainingIndex = buildActualTrainingIndex(employees);
  const cutoffDate = getCutoffDate(filters.yearMonth, query);
  const result = listTargets({
    filters,
    page: {
      limit: 1_000_000,
      offset: 0
    }
  });

  return result.rows.map((target) => ({
    ...target,
    progress: calculateTargetProgress({ target, employees, cutoffDate, actualTrainingIndex })
  }));
}


function summarizeTargetPlan(targets, yearMonth) {
  const channelMap = new Map();
  const baseMap = new Map();
  let totalTarget = 0;

  targets.forEach((target) => {
    const targetValue = Number(target.monthlyTarget || 0);
    totalTarget += targetValue;

    const channel = channelMap.get(target.channel) || {
      channel: target.channel,
      target: 0
    };
    channel.target += targetValue;
    channelMap.set(target.channel, channel);

    const base = baseMap.get(target.base) || {
      base: target.base,
      totalTarget: 0,
      channels: new Map(),
      dateTargets: new Map(),
      monthTargets: new Map()
    };
    base.totalTarget += targetValue;
    base.monthTargets.set(target.yearMonth, (base.monthTargets.get(target.yearMonth) || 0) + targetValue);
    const baseChannel = base.channels.get(target.channel) || {
      channel: target.channel,
      label: getChannelSummaryLabel(target.channel),
      target: 0
    };
    baseChannel.target += targetValue;
    base.channels.set(target.channel, baseChannel);
    Object.entries(target.dailyTargets || {}).forEach(([day, value]) => {
      const dayTarget = Number(value || 0);
      if (dayTarget <= 0) {
        return;
      }
      base.dateTargets.set(day, (base.dateTargets.get(day) || 0) + dayTarget);
    });
    baseMap.set(target.base, base);
  });

  const channels = CHANNEL_ORDER
    .filter((channel) => channel !== '合计')
    .map((channel) => channelMap.get(channel) || { channel, target: 0 })
    .filter((item) => item.target > 0 || channelMap.has(item.channel))
    .map((item) => ({
      ...item,
      share: totalTarget > 0 ? item.target / totalTarget : 0,
      shareText: formatPercent(totalTarget > 0 ? item.target / totalTarget : 0)
    }));

  return {
    yearMonth,
    totalTarget,
    baseCount: baseMap.size,
    channelCount: channels.filter((item) => item.target > 0).length,
    channels,
    bases: Array.from(baseMap.values())
      .map((base) => ({
        base: base.base,
        totalTarget: base.totalTarget,
        dateTargets: formatDateTargets(base.dateTargets, yearMonth),
        monthTargets: formatMonthTargets(base.monthTargets),
        channels: CHANNEL_ORDER
          .filter((channel) => channel !== '合计')
          .map((channel) => base.channels.get(channel))
          .filter(Boolean)
      }))
      .sort((left, right) => right.totalTarget - left.totalTarget)
  };
}

function formatMonthTargets(monthTargets) {
  return Array.from(monthTargets.entries())
    .map(([monthValue, target]) => ({
      month: monthValue,
      target,
      label: `${Number(String(monthValue).slice(5, 7))}月`
    }))
    .sort((left, right) => left.month.localeCompare(right.month));
}

function formatDateTargets(dateTargets, yearMonth) {
  const month = Number(String(yearMonth || '').slice(5, 7));

  return Array.from(dateTargets.entries())
    .map(([day, target]) => ({
      day: Number(day),
      target,
      label: month ? `${month}月${Number(day)}日` : `${Number(day)}日`
    }))
    .sort((left, right) => left.day - right.day);
}

function getChannelSummaryLabel(channel) {
  const labelMap = {
    自主社招: '自招',
    渠道社招: '渠道',
    渠道校招: '校招',
    内推: '内推',
    回流: '回流'
  };

  return labelMap[channel] || channel;
}

function summarizeTargets(targets, employees, cutoffDate) {
  const channelMap = new Map();
  const baseMap = new Map();
  let overallMonthlyTarget = 0;
  let overallCutoffTarget = 0;
  let overallActual = 0;
  const targetYearMonth = targets[0]?.yearMonth || String(cutoffDate || '').slice(0, 7);
  const targetsForSummary = includeActualOnlyTargets({ targets, employees, yearMonth: targetYearMonth });
  const actualTrainingIndex = buildActualTrainingIndex(employees);

  targetsForSummary.forEach((target) => {
    const progress = calculateTargetProgress({ target, employees, cutoffDate, actualTrainingIndex });
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
    const channelRows = CHANNEL_ORDER
      .filter((channel) => channel !== '合计')
      .map((channel) => {
        const item = base.channels.find(({ target }) => target.channel === channel);
        const progress = item ? item.progress : {
          monthlyTarget: 0,
          cutoffTarget: 0,
          actualTraining: 0,
          gap: 0,
          achievementRate: 0,
          achievementRateText: '0.00%'
        };
        const targetShare = base.monthlyTarget > 0 ? progress.monthlyTarget / base.monthlyTarget : 0;
        const actualShare = base.actualTraining > 0 ? progress.actualTraining / base.actualTraining : 0;

        return {
          channel,
          ...progress,
          targetShare,
          actualShare,
          targetShareText: formatPercent(targetShare),
          actualShareText: formatPercent(actualShare),
          shareGapText: formatPercent(actualShare - targetShare)
        };
      })
      .filter((row) => row.monthlyTarget > 0 || row.actualTraining > 0);
    const totalRow = {
      channel: '合计',
      monthlyTarget: base.monthlyTarget,
      cutoffTarget: base.cutoffTarget,
      actualTraining: base.actualTraining,
      gap,
      achievementRate: base.monthlyTarget > 0 ? base.actualTraining / base.monthlyTarget : 0,
      achievementRateText: formatPercent(base.monthlyTarget > 0 ? base.actualTraining / base.monthlyTarget : 0),
      targetShare: 1,
      actualShare: 1,
      targetShareText: formatPercent(base.monthlyTarget > 0 ? 1 : 0),
      actualShareText: formatPercent(base.actualTraining > 0 ? 1 : 0),
      shareGapText: '0.00%'
    };

    return {
      ...base,
      gap,
      achievementRate: base.monthlyTarget > 0 ? base.actualTraining / base.monthlyTarget : 0,
      achievementRateText: formatPercent(base.monthlyTarget > 0 ? base.actualTraining / base.monthlyTarget : 0),
      channelRows: [...channelRows, totalRow],
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
      const achievementRate = item.monthlyTarget > 0 ? item.actualTraining / item.monthlyTarget : 0;
      const targetShare = overallMonthlyTarget > 0 ? item.monthlyTarget / overallMonthlyTarget : 0;
      const actualShare = overallActual > 0 ? item.actualTraining / overallActual : 0;
      return {
        ...item,
        gap: item.actualTraining - item.monthlyTarget,
        achievementRate,
        achievementRateText: formatPercent(achievementRate),
        targetShare,
        actualShare,
        targetShareText: formatPercent(targetShare),
        actualShareText: formatPercent(actualShare),
        shareGapText: formatPercent(actualShare - targetShare)
      };
    });
  const selfSourcingChannel = channels.find((channel) => channel.channel === '自主社招');
  const overallTotalRow = {
    channel: '合计',
    monthlyTarget: overallMonthlyTarget,
    cutoffTarget: overallCutoffTarget,
    actualTraining: overallActual,
    gap: overallGap,
    achievementRate: overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0,
    achievementRateText: formatPercent(overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0),
    targetShareText: formatPercent(overallMonthlyTarget > 0 ? 1 : 0),
    actualShareText: formatPercent(overallActual > 0 ? 1 : 0),
    shareGapText: '0.00%'
  };
  const detailGroups = [
    {
      base: '整体达成',
      isOverall: true,
      channelRows: [...channels.filter((row) => row.monthlyTarget > 0 || row.actualTraining > 0), overallTotalRow]
    },
    ...baseSummaries.filter((base) => base.monthlyTarget > 0 || base.actualTraining > 0)
  ];

  return {
    overall: {
      monthlyTarget: overallMonthlyTarget,
      cutoffTarget: overallCutoffTarget,
      actualTraining: overallActual,
      gap: overallGap,
      achievementRate: overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0,
      achievementRateText: formatPercent(overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0),
      unmetBaseCount: baseSummaries.filter((base) => base.gap < 0).length,
      selfSourcingShare: selfSourcingChannel ? selfSourcingChannel.actualShare : 0,
      selfSourcingShareText: selfSourcingChannel ? selfSourcingChannel.actualShareText : '0.00%'
    },
    channels,
    bases: baseSummaries,
    detailGroups
  };
}

function includeActualOnlyTargets({ targets, employees, yearMonth }) {
  if (!yearMonth) {
    return targets;
  }

  const existingKeys = new Set(targets.map((target) => `${target.base}::${target.channel}`));
  const additions = new Map();

  employees.forEach((employee) => {
    if (!employee.employeeNo || !String(employee.trainingDate || '').startsWith(yearMonth)) {
      return;
    }

    const base = toText(employee.base);
    const channel = toText(employee.channelType);
    if (!base || !channel) {
      return;
    }

    const key = `${base}::${channel}`;
    if (existingKeys.has(key) || additions.has(key)) {
      return;
    }

    additions.set(key, {
      yearMonth,
      base,
      channel,
      orderType: '',
      monthlyTarget: 0,
      dailyTargets: {}
    });
  });

  return [...targets, ...additions.values()];
}

function getTargetProgress(query = {}, preloadedEmployees) {
  const yearMonth = getDefaultMonth(query);
  const cutoffDate = getCutoffDate(yearMonth, query);
  const targets = yearMonth ? listTargetsByMonth(yearMonth) : [];
  const employees = preloadedEmployees || listAllEmployees();

  return {
    yearMonth,
    cutoffDate,
    months: getAvailableMonths(),
    ...summarizeTargets(targets, employees, cutoffDate)
  };
}

module.exports = {
  getTargetList,
  getTargetExportRows,
  getTargetProgress,
  includeActualOnlyTargets,
  summarizeTargetPlan,
  summarizeTargets
};
