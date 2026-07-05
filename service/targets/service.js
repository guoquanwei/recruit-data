const { listAllEmployees, listAllOrgTableFrontlineEmployees, listAllOrgTableRecruiters } = require('../employees/repository');
const { formatDate, getMonthLastDay, normalizeDate } = require('../shared/date');
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

async function getDefaultMonth(query = {}) {
  if (query.yearMonth) {
    return query.yearMonth;
  }

  return (await getAvailableMonths())[0] || '';
}

function getCutoffDate(yearMonth, query = {}) {
  if (query.cutoffDate) {
    return query.cutoffDate;
  }
  if (!yearMonth) {
    return '';
  }

  const today = normalizeDate(query.today) || formatDate(new Date());
  if (today.startsWith(yearMonth)) {
    return today;
  }

  return `${yearMonth}-${String(getMonthLastDay(yearMonth)).padStart(2, '0')}`;
}

async function getTargetList(query = {}) {
  const requestedPage = parsePage(query);
  const page = {
    ...requestedPage,
    pageSize: 3,
    limit: 3,
    offset: (requestedPage.page - 1) * 3
  };
  const filters = buildTargetFilters(query);
  const [frontlineEmployees, recruiters] = await Promise.all([
    listAllOrgTableFrontlineEmployees(),
    listAllOrgTableRecruiters()
  ]);
  const employees = [...frontlineEmployees, ...recruiters];
  const hasYearMonthQuery = Object.prototype.hasOwnProperty.call(query, 'yearMonth');
  const displayMonth = hasYearMonthQuery ? filters.yearMonth : await getDefaultMonth(query);
  filters.yearMonth = displayMonth;
  const cutoffDate = getCutoffDate(displayMonth, query);
  const result = await listTargets({ filters, page });
  const summaryTargets = await listTargetsForSummary(filters);
  const actualTrainingIndex = buildActualTrainingIndex(employees);

  return {
    ...result,
    rows: result.rows.map((target) => ({
      ...target,
      progress: calculateTargetProgress({ target, employees, cutoffDate, actualTrainingIndex })
    })),
    page,
    filters,
    options: await getDistinctTargetFilterOptions(filters),
    summary: summarizeTargetPlan(summaryTargets, displayMonth, page),
    emptyMessage: result.total === 0
      ? '没有符合筛选条件的目标数据，请调整筛选项后重试。'
      : ''
  };
}

async function getTargetExportRows(query = {}) {
  const filters = buildTargetFilters(query);
  const hasYearMonthQuery = Object.prototype.hasOwnProperty.call(query, 'yearMonth');
  filters.yearMonth = hasYearMonthQuery ? filters.yearMonth : await getDefaultMonth(query);
  const [frontlineEmployees, recruiters] = await Promise.all([
    listAllOrgTableFrontlineEmployees(),
    listAllOrgTableRecruiters()
  ]);
  const employees = [...frontlineEmployees, ...recruiters];
  const actualTrainingIndex = buildActualTrainingIndex(employees);
  const cutoffDate = getCutoffDate(filters.yearMonth, query);
  const result = await listTargets({
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


function summarizeTargetPlan(targets, yearMonth, page) {
  const channelMap = new Map();
  const baseMap = new Map();
  const batchColumnMap = new Map();
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
      target: 0,
      dateTargets: new Map()
    };
    baseChannel.target += targetValue;
    base.channels.set(target.channel, baseChannel);
    Object.entries(target.dailyTargets || {}).forEach(([day, value]) => {
      const dayTarget = Number(value || 0);
      if (dayTarget <= 0) {
        return;
      }
      const batchKey = yearMonth ? String(day).padStart(2, '0') : `${target.yearMonth}-${String(day).padStart(2, '0')}`;
      const batchLabel = yearMonth
        ? formatDayLabel(yearMonth, day)
        : formatDayLabel(target.yearMonth, day);
      base.dateTargets.set(day, (base.dateTargets.get(day) || 0) + dayTarget);
      baseChannel.dateTargets.set(batchKey, (baseChannel.dateTargets.get(batchKey) || 0) + dayTarget);
      batchColumnMap.set(batchKey, {
        key: batchKey,
        day: Number(day),
        label: batchLabel
      });
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
  const cards = buildTargetSummaryCards(channelMap, totalTarget);
  const batchColumns = Array.from(batchColumnMap.values())
    .sort((left, right) => left.key.localeCompare(right.key));
  const baseSummaries = Array.from(baseMap.values())
    .map((base) => ({
      base: base.base,
      totalTarget: base.totalTarget,
      dateTargets: formatDateTargets(base.dateTargets, yearMonth),
      monthTargets: formatMonthTargets(base.monthTargets),
      channels: CHANNEL_ORDER
        .filter((channel) => channel !== '合计')
        .map((channel) => base.channels.get(channel))
        .filter(Boolean)
        .map((channel) => ({
          ...channel,
          dateTargets: Array.from(channel.dateTargets.entries()).map(([columnKey, target]) => ({
            columnKey,
            target
          }))
        }))
    }))
    .filter((base) => base.totalTarget > 0)
    .sort((left, right) => right.totalTarget - left.totalTarget);
  const summaryPage = page ? normalizeSummaryPage(page, baseSummaries.length) : undefined;
  const pagedBaseSummaries = summaryPage
    ? baseSummaries.slice(summaryPage.offset, summaryPage.offset + summaryPage.limit)
    : baseSummaries;
  const visibleBatchColumns = filterVisibleBatchColumns(batchColumns, pagedBaseSummaries);

  return {
    yearMonth,
    totalTarget,
    baseCount: baseSummaries.length,
    channelCount: channels.filter((item) => item.target > 0).length,
    cards,
    channels,
    batchColumns: visibleBatchColumns,
    batchRows: buildTargetBatchRows(pagedBaseSummaries, visibleBatchColumns),
    bases: pagedBaseSummaries,
    totalBases: baseSummaries.length,
    page: summaryPage
  };
}

function filterVisibleBatchColumns(batchColumns, bases) {
  return batchColumns.filter((column) => (
    bases.some((base) => (
      base.dateTargets.some((target) => target.columnKey === column.key && target.target > 0)
    ))
  ));
}

function normalizeSummaryPage(page, total) {
  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Number(page.page) || 1));

  return {
    page: currentPage,
    pageSize,
    limit: pageSize,
    offset: (currentPage - 1) * pageSize
  };
}

function buildTargetSummaryCards(channelMap, totalTarget) {
  const cards = [
    { key: 'total', label: '需求总数', target: totalTarget },
    { key: 'self', label: '自主社招目标', target: channelMap.get('自主社招')?.target || 0 },
    { key: 'referral', label: '内部推荐目标', target: channelMap.get('内推')?.target || 0 },
    { key: 'social', label: '渠道社招目标', target: channelMap.get('渠道社招')?.target || 0 },
    { key: 'campus', label: '渠道校招目标', target: channelMap.get('渠道校招')?.target || 0 }
  ];

  return cards.map((card) => ({
    ...card,
    shareText: formatPercent(totalTarget > 0 ? card.target / totalTarget : 0)
  }));
}

function buildTargetBatchRows(bases, batchColumns) {
  return bases.flatMap((base) => {
    const rowSpan = base.channels.length + 1;
    const totalRow = {
      base: base.base,
      channelLabel: '基地汇总',
      monthlyTarget: base.totalTarget,
      isBaseSummary: true,
      showBase: true,
      baseRowSpan: rowSpan,
      batchTargets: batchColumns.map((column) => (
        base.dateTargets.find((target) => target.columnKey === column.key)?.target || 0
      ))
    };
    const channelRows = base.channels.map((channel) => ({
      base: base.base,
      channelLabel: channel.channel,
      monthlyTarget: channel.target,
      isBaseSummary: false,
      showBase: false,
      baseRowSpan: 0,
      batchTargets: batchColumns.map((column) => (
        channel.dateTargets?.find((target) => target.columnKey === column.key)?.target || 0
      ))
    }));

    return [totalRow, ...channelRows];
  });
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
  return Array.from(dateTargets.entries())
    .map(([day, target]) => ({
      columnKey: yearMonth ? String(day).padStart(2, '0') : String(day),
      day: Number(day),
      target,
      label: formatDayLabel(yearMonth, day)
    }))
    .sort((left, right) => left.day - right.day);
}

function formatDayLabel(yearMonth, day) {
  const month = Number(String(yearMonth || '').slice(5, 7));
  return month ? `${month}月${Number(day)}日` : `${Number(day)}日`;
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

function matchesProgressFilters(item = {}, filters = {}) {
  const baseFilter = toText(filters.base);
  const channelFilter = toText(filters.channel);
  const itemBase = toText(item.base);
  const itemChannel = toText(item.channel || item.channelType);

  return (!baseFilter || itemBase === baseFilter)
    && (!channelFilter || itemChannel === channelFilter);
}

function buildBaseBatchDetails(base, employees, yearMonth) {
  const detailMap = new Map();
  const baseEmployees = employees.filter((employee) => toText(employee.base) === toText(base.base));

  base.channels.forEach(({ target }) => {
    Object.entries(target.dailyTargets || {}).forEach(([day, value]) => {
      const batchTarget = Number(value || 0);
      if (batchTarget <= 0) {
        return;
      }
      const batchDate = `${target.yearMonth || yearMonth}-${String(day).padStart(2, '0')}`;
      const key = `${batchDate}::${target.channel}`;
      const current = detailMap.get(key) || {
        batchDate,
        batchLabel: formatDayLabel(target.yearMonth || yearMonth, day),
        channel: target.channel,
        batchTarget: 0
      };
      current.batchTarget += batchTarget;
      detailMap.set(key, current);
    });
  });

  baseEmployees.forEach((employee) => {
    const trainingDate = normalizeDate(employee.trainingDate);
    const channel = toText(employee.channelType);
    const key = `${trainingDate}::${channel}`;
    const current = detailMap.get(key);
    if (!current) {
      return;
    }
    current.actualTraining = (current.actualTraining || 0) + 1;
  });

  const channelRows = Array.from(detailMap.values())
    .map((row) => {
      const actualTraining = row.actualTraining || 0;
      const gap = actualTraining - row.batchTarget;
      const achievementRate = row.batchTarget > 0 ? actualTraining / row.batchTarget : 0;
      return {
        ...row,
        actualTraining,
        gap,
        achievementRate,
        achievementRateText: formatPercent(achievementRate)
      };
    })
    .sort((left, right) => (
      left.batchDate.localeCompare(right.batchDate)
      || CHANNEL_ORDER.indexOf(left.channel) - CHANNEL_ORDER.indexOf(right.channel)
    ));
  const rowsByBatch = new Map();
  channelRows.forEach((row) => {
    const rows = rowsByBatch.get(row.batchDate) || [];
    rows.push(row);
    rowsByBatch.set(row.batchDate, rows);
  });

  return Array.from(rowsByBatch.entries()).flatMap(([batchDate, rows]) => {
    const summaryTarget = rows.reduce((sum, row) => sum + row.batchTarget, 0);
    const summaryActual = rows.reduce((sum, row) => sum + row.actualTraining, 0);
    const summaryGap = summaryActual - summaryTarget;
    const summaryRate = summaryTarget > 0 ? summaryActual / summaryTarget : 0;
    const batchRows = rows.map((row, index) => ({
      ...row,
      showBatch: index === 0,
      batchRowSpan: index === 0 ? rows.length + 1 : 0,
      isBatchSummary: false
    }));
    const summaryRow = {
      batchDate,
      batchLabel: rows[0]?.batchLabel || batchDate,
      channel: '批次汇总',
      batchTarget: summaryTarget,
      actualTraining: summaryActual,
      gap: summaryGap,
      achievementRate: summaryRate,
      achievementRateText: formatPercent(summaryRate),
      showBatch: false,
      batchRowSpan: 0,
      isBatchSummary: true
    };

    return [...batchRows, summaryRow];
  });
}

function getRiskStatus(achievementRate, monthlyTarget = 0) {
  if (monthlyTarget <= 0) {
    return { status: 'none', text: '' };
  }
  if (achievementRate >= 0.9) {
    return { status: 'green', text: '绿灯' };
  }
  if (achievementRate >= 0.7) {
    return { status: 'yellow', text: '黄灯关注' };
  }
  return { status: 'red', text: '红灯风险基地' };
}

function summarizeTargets(targets, employees, cutoffDate, filters = {}) {
  const filteredTargets = targets.filter((target) => matchesProgressFilters(target, filters));
  const filteredEmployees = employees.filter((employee) => matchesProgressFilters(employee, filters));
  const channelMap = new Map();
  const baseMap = new Map();
  let overallMonthlyTarget = 0;
  let overallCutoffTarget = 0;
  let overallActual = 0;
  const targetYearMonth = filteredTargets[0]?.yearMonth || String(cutoffDate || '').slice(0, 7);
  const targetsForSummary = includeActualOnlyTargets({
    targets: filteredTargets,
    employees: filteredEmployees,
    yearMonth: targetYearMonth
  });
  const actualTrainingIndex = buildActualTrainingIndex(filteredEmployees);

  targetsForSummary.forEach((target) => {
    const progress = calculateTargetProgress({
      target,
      employees: filteredEmployees,
      cutoffDate,
      actualTrainingIndex
    });
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
      batchDetails: buildBaseBatchDetails(base, filteredEmployees, targetYearMonth),
      channelRows: [...channelRows, totalRow],
      shortageChannels: base.channels
        .map(({ target, progress }) => ({ channel: target.channel, gap: progress.gap }))
        .filter((item) => item.gap < 0)
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 3)
    };
  }).map((base) => ({
    ...base,
    riskStatus: getRiskStatus(base.achievementRate, base.monthlyTarget).status,
    riskText: getRiskStatus(base.achievementRate, base.monthlyTarget).text
  })).sort((left, right) => {
    const leftNoTarget = left.monthlyTarget <= 0;
    const rightNoTarget = right.monthlyTarget <= 0;
    if (leftNoTarget !== rightNoTarget) {
      return leftNoTarget ? 1 : -1;
    }

    return left.achievementRate - right.achievementRate;
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
      achievementRate: overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0,
      achievementRateText: formatPercent(overallMonthlyTarget > 0 ? overallActual / overallMonthlyTarget : 0),
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
  const targetBases = new Set(targets.map((target) => toText(target.base)).filter(Boolean));
  const additions = new Map();

  employees.forEach((employee) => {
    if (!employee.employeeNo || !normalizeDate(employee.trainingDate).startsWith(yearMonth)) {
      return;
    }

    const base = toText(employee.base);
    const channel = toText(employee.channelType);
    if (!base || !channel || !targetBases.has(base)) {
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

async function getTargetProgress(query = {}, preloadedEmployees) {
  const yearMonth = await getDefaultMonth(query);
  const cutoffDate = getCutoffDate(yearMonth, query);
  const targets = yearMonth ? await listTargetsByMonth(yearMonth) : [];
  const normalizedQuery = { ...query, yearMonth };
  const targetBases = new Set(targets.map((target) => toText(target.base)).filter(Boolean));
  if (normalizedQuery.base && !targetBases.has(toText(normalizedQuery.base))) {
    normalizedQuery.base = '';
  }
  const targetChannels = new Set(targets
    .filter((target) => !normalizedQuery.base || toText(target.base) === toText(normalizedQuery.base))
    .map((target) => toText(target.channel))
    .filter(Boolean));
  if (normalizedQuery.channel && !targetChannels.has(toText(normalizedQuery.channel))) {
    normalizedQuery.channel = '';
  }
  const filters = buildTargetFilters(normalizedQuery);
  let employees;

  if (preloadedEmployees) {
    employees = preloadedEmployees;
  } else {
    const [frontlineEmployees, recruiters] = await Promise.all([
      listAllOrgTableFrontlineEmployees(),
      listAllOrgTableRecruiters()
    ]);
    employees = [...frontlineEmployees, ...recruiters];
  }

  return {
    yearMonth,
    cutoffDate,
    months: await getAvailableMonths(),
    filters,
    options: await getDistinctTargetFilterOptions(filters),
    ...summarizeTargets(targets, employees, cutoffDate, normalizedQuery)
  };
}

module.exports = {
  getCutoffDate,
  getTargetList,
  getTargetExportRows,
  getTargetProgress,
  includeActualOnlyTargets,
  summarizeTargetPlan,
  summarizeTargets
};