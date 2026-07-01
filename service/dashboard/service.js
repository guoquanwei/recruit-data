const { listAllEmployees } = require('../employees/repository');
const { listAllInterviewRecords } = require('../interviews/repository');
const { formatDate, getMonthLastDay, normalizeDate } = require('../shared/date');
const { formatPercent, maskPhone, toText } = require('../shared/format');
const { getTargetProgress } = require('../targets/service');
const { getDistinctTargetFilterOptions, listTargetsByMonth } = require('../targets/repository');

const PASSED_INTERVIEW_RESULTS = new Set(['推荐', '强烈推荐']);
const EXPECTED_INTERVIEW_PASS_RATE = 0.6;
const EXPECTED_ENTRY_RATE = 2 / 3;
const CHANNEL_DISPLAY_ORDER = ['回流', '内推', '渠道社招', '渠道校招', '自主社招'];

function calculateWorkDaysInMonth(employee, yearMonth) {
  if (!employee.entryDate || !employee.entryDate.startsWith(yearMonth)) {
    return 0;
  }

  return 1;
}

function getTrainingDetails(query = {}) {
  const yearMonth = toText(query.yearMonth);
  return listAllEmployees()
    .filter((employee) => !yearMonth || employee.trainingDate.startsWith(yearMonth))
    .map((employee) => ({
      base: employee.base,
      employeeNo: employee.employeeNo,
      name: employee.name,
      maskedPhone: maskPhone(employee.phone),
      channelType: employee.channelType,
      channelName: employee.channelName,
      trainingDate: employee.trainingDate,
      employeeStatus: employee.employeeStatus,
      resignedDate: employee.resignedDate,
      workDaysInMonth: calculateWorkDaysInMonth(employee, yearMonth)
    }));
}

function getSelfSourcingEfficiency(query = {}) {
  const yearMonth = toText(query.yearMonth);
  const employees = listAllEmployees();
  const recruiters = employees.filter((employee) => employee.position === '招聘专员');
  const selfSourcingEmployees = employees.filter((employee) => (
    employee.channelType === '自主社招'
      && (!yearMonth || employee.trainingDate.startsWith(yearMonth))
  ));
  const summary = {
    probation: { stage: '试用期', recruiterCount: 0, trainingCount: 0, sevenDayCount: 0 },
    formal: { stage: '正式期', recruiterCount: 0, trainingCount: 0, sevenDayCount: 0 },
    overall: { stage: '整体', recruiterCount: recruiters.length, trainingCount: selfSourcingEmployees.length, sevenDayCount: 0 }
  };

  recruiters.forEach((recruiter) => {
    const entryYearMonth = recruiter.entryDate ? recruiter.entryDate.slice(0, 7) : '';
    const stage = entryYearMonth && yearMonth && entryYearMonth <= yearMonth ? 'formal' : 'probation';
    summary[stage].recruiterCount += 1;
  });

  selfSourcingEmployees.forEach((employee) => {
    const recruiterName = toText(employee.channelName).split('+')[0];
    const recruiter = recruiters.find((item) => item.name === recruiterName);
    const stage = recruiter && recruiter.entryDate && yearMonth && recruiter.entryDate.slice(0, 7) <= yearMonth ? 'formal' : 'probation';
    summary[stage].trainingCount += 1;
    summary.overall.sevenDayCount += 1;
    summary[stage].sevenDayCount += 1;
  });

  return Object.values(summary).map((item) => ({
    ...item,
    efficiency: item.recruiterCount > 0 ? (item.trainingCount / item.recruiterCount).toFixed(1) : '0.0'
  }));
}

function getCellStatus(achievementRate, hasData = true) {
  if (!hasData) {
    return 'empty';
  }
  if (achievementRate >= 1) {
    return 'achieved';
  }
  if (achievementRate >= 0.7) {
    return 'warning';
  }
  return 'risk';
}

function getStatusText(status) {
  const textMap = {
    achieved: '达成',
    warning: '预警',
    risk: '风险',
    empty: '无数据',
    notStarted: '未开始',
    inProgress: '进行中',
    missed: '未达标'
  };

  return textMap[status] || status;
}

function getCutoffTargetStatus({ cutoffTarget = 0, actualTraining = 0, monthlyTarget = 0 }) {
  const hasData = Number(cutoffTarget) > 0 || Number(monthlyTarget) > 0 || Number(actualTraining) > 0;
  if (!hasData) {
    return 'empty';
  }
  return Number(actualTraining) < Number(cutoffTarget) ? 'risk' : 'achieved';
}

function formatDashboardRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0.0%';
  }
  return `${(number * 100).toFixed(1)}%`;
}

function buildDashboardMatrix(progress, filters = {}) {
  const baseFilter = toText(filters.base);
  const channelFilter = toText(filters.channel);
  const bases = progress.bases
    .filter((base) => !baseFilter || base.base === baseFilter)
    .filter((base) => base.channelRows.some((row) => row.channel !== '合计' && (!channelFilter || row.channel === channelFilter)));
  const channels = progress.channels
    .filter((channel) => channel.monthlyTarget > 0 || channel.actualTraining > 0)
    .map((channel) => channel.channel)
    .filter((channel) => !channelFilter || channel === channelFilter);
  const rows = bases.map((base) => {
    const cells = {};

    channels.forEach((channel) => {
      const row = base.channelRows.find((item) => item.channel === channel) || {
        channel,
        monthlyTarget: 0,
        cutoffTarget: 0,
        actualTraining: 0,
        gap: 0,
        achievementRate: 0,
        achievementRateText: '0.00%',
        targetShareText: '0.00%',
        actualShareText: '0.00%',
        shareGapText: '0.00%'
      };
      const hasData = row.monthlyTarget > 0 || row.actualTraining > 0;

      cells[channel] = {
        ...row,
        status: getCellStatus(row.achievementRate, hasData),
        statusText: getStatusText(getCellStatus(row.achievementRate, hasData))
      };
    });

    return {
      base: base.base,
      cells
    };
  });

  return {
    channels,
    rows
  };
}

function buildDate(yearMonth, day) {
  return `${yearMonth}-${String(day).padStart(2, '0')}`;
}

function isBetween(dateValue, startDate, endDate) {
  const date = normalizeDate(dateValue);
  return date >= startDate && date <= endDate;
}

function sumDailyTargetsByDay(targets) {
  const dailyTargets = new Map();

  targets.forEach((target) => {
    Object.entries(target.dailyTargets || {}).forEach(([day, value]) => {
      const targetValue = Number(value || 0);
      if (targetValue <= 0) {
        return;
      }
      const dayNumber = Number(day);
      dailyTargets.set(dayNumber, (dailyTargets.get(dayNumber) || 0) + targetValue);
    });
  });

  return Array.from(dailyTargets.entries())
    .map(([day, target]) => ({ day, target }))
    .sort((left, right) => left.day - right.day);
}

function countTrainingInWindow(employees, { base, channel, startDate, endDate }) {
  const seen = new Set();

  employees.forEach((employee) => {
    if (toText(employee.base) !== base || toText(employee.channelType) !== channel) {
      return;
    }
    if (!isBetween(employee.trainingDate, startDate, endDate)) {
      return;
    }

    const employeeKey = employee.employeeNo || toText(employee.phone);
    if (employeeKey) {
      seen.add(employeeKey);
    }
  });

  return seen.size;
}

function countFunnelInWindow(interviews, { base, channel, startDate, endDate }) {
  return interviews.reduce((summary, interview) => {
    if (toText(interview.base) !== base || toText(interview.channelType) !== channel) {
      return summary;
    }
    if (!isBetween(interview.feedbackDate, startDate, endDate)) {
      return summary;
    }

    summary.arrivedCount += 1;
    if (PASSED_INTERVIEW_RESULTS.has(interview.feedbackResult)) {
      summary.passedCount += 1;
    }
    return summary;
  }, {
    arrivedCount: 0,
    passedCount: 0,
    trainingCount: 0
  });
}

function getBatchStatus({ target, actualTraining, windowStart, windowEnd, asOfDate }) {
  if (actualTraining >= target) {
    return 'achieved';
  }
  if (asOfDate && asOfDate < windowStart) {
    return 'notStarted';
  }
  if (asOfDate && asOfDate >= windowStart && asOfDate <= windowEnd) {
    return 'inProgress';
  }
  return 'missed';
}

function buildGapDiagnosis({ target, actualTraining, arrivedCount, passedCount }) {
  const expectedPassedCount = Math.ceil(target / EXPECTED_ENTRY_RATE);
  const expectedArrivedCount = Math.ceil(expectedPassedCount / EXPECTED_INTERVIEW_PASS_RATE);
  const gap = actualTraining - target;
  const arrivedEnough = arrivedCount >= expectedArrivedCount;
  const passedEnough = passedCount >= expectedPassedCount;
  const entryEnough = actualTraining >= target;
  const actualEntryRate = passedCount > 0 ? actualTraining / passedCount : 0;
  const stages = [
    {
      name: '到面环节',
      actual: arrivedCount,
      expected: expectedArrivedCount,
      status: arrivedEnough ? 'normal' : 'insufficient',
      text: arrivedEnough ? '满足预计需求' : '低于预计需求'
    },
    {
      name: '面通环节',
      actual: passedCount,
      expected: expectedPassedCount,
      status: passedEnough ? 'normal' : 'insufficient',
      text: passedEnough ? '满足预计需求' : '低于预计需求'
    },
    {
      name: '入职环节',
      actual: actualTraining,
      expected: target,
      status: entryEnough ? 'normal' : 'insufficient',
      text: entryEnough ? '满足目标' : '低于目标'
    }
  ];

  if (gap >= 0) {
    return {
      reason: '达标 / 正常',
      conclusion: '该批次当前无 GAP，保持节奏即可',
      suggestion: '保持当前招聘节奏，继续跟进入职稳定性',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  if (!arrivedEnough && !passedEnough && !entryEnough) {
    return {
      reason: '整体储备不足',
      conclusion: '到面、面通、入职均低于预计需求，需要补充候选人池',
      suggestion: '优先加大邀约和渠道补量，同时补充候选人备份',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  if (!arrivedEnough) {
    return {
      reason: '前端邀约/到面不足',
      conclusion: '当前到面人数不足，后续漏斗没有足够候选人承接',
      suggestion: '优先增加邀约量、提升到面率、补充渠道候选人',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  if (!passedEnough && actualEntryRate >= EXPECTED_ENTRY_RATE) {
    return {
      reason: '面试通过率低',
      conclusion: '到面人数足够，但面试通过人数低于预计需求',
      suggestion: '优先复盘候选人质量、面试标准和渠道匹配度',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  return {
    reason: '通过后入职转化不足',
    conclusion: '不是到面不够，主要卡在面通后的入职确认和承接',
    suggestion: '优先催入职确认 / 补 offer / 加候选人备份',
    expectedArrivedCount,
    expectedPassedCount,
    expectedEntryCount: target,
    stages
  };
}

function buildBatchDrilldown({ yearMonth, base, channel, targets = [], employees = [], interviews = [], asOfDate = '' }) {
  if (!yearMonth || !base || !channel) {
    return [];
  }

  const matchedTargets = targets.filter((target) => (
    target.yearMonth === yearMonth
      && toText(target.base) === base
      && toText(target.channel) === channel
  ));
  const batches = sumDailyTargetsByDay(matchedTargets);
  const month = Number(yearMonth.slice(5, 7));
  const normalizedAsOfDate = normalizeDate(asOfDate);

  return batches.map((batch, index) => {
    const previousDay = index === 0 ? 1 : batches[index - 1].day + 1;
    const windowStart = buildDate(yearMonth, previousDay);
    const windowEnd = buildDate(yearMonth, batch.day);
    const actualTraining = countTrainingInWindow(employees, { base, channel, startDate: windowStart, endDate: windowEnd });
    const funnel = countFunnelInWindow(interviews, { base, channel, startDate: windowStart, endDate: windowEnd });
    const achievementRate = batch.target > 0 ? actualTraining / batch.target : 0;
    const diagnosis = buildGapDiagnosis({
      target: batch.target,
      actualTraining,
      arrivedCount: funnel.arrivedCount,
      passedCount: funnel.passedCount
    });
    const status = getBatchStatus({
      target: batch.target,
      actualTraining,
      windowStart,
      windowEnd,
      asOfDate: normalizedAsOfDate
    });

    return {
      label: `${month}月${batch.day}日批次`,
      day: batch.day,
      windowStart,
      windowEnd,
      channel,
      target: batch.target,
      actualTraining,
      gap: actualTraining - batch.target,
      achievementRate,
      achievementRateText: formatDashboardRate(achievementRate),
      status,
      statusText: getStatusText(status),
      diagnosis,
      funnel: {
        ...funnel,
        trainingCount: actualTraining
      }
    };
  });
}

function getAllBatchDays(targets, yearMonth, filters = {}) {
  const baseFilter = toText(filters.base);
  const channelFilter = toText(filters.channel);
  const batchDayFilter = Number(filters.batchDay || 0);
  const days = new Set();

  targets.forEach((target) => {
    if (target.yearMonth !== yearMonth) {
      return;
    }
    if (baseFilter && target.base !== baseFilter) {
      return;
    }
    if (channelFilter && target.channel !== channelFilter) {
      return;
    }
    Object.entries(target.dailyTargets || {}).forEach(([day, value]) => {
      if (Number(value || 0) > 0) {
        days.add(Number(day));
      }
    });
  });

  return Array.from(days)
    .filter((day) => !batchDayFilter || day === batchDayFilter)
    .sort((left, right) => left - right);
}

function buildEmptyBatchCell(day, yearMonth) {
  const month = Number(yearMonth.slice(5, 7));
  return {
    type: 'batch',
    day,
    label: `${month}月${day}日批次`,
    status: 'empty',
    statusText: getStatusText('empty'),
    target: 0,
    actualTraining: 0,
    gap: 0,
    achievementRate: 0,
    achievementRateText: '0.0%',
    displayText: '0.0%',
    funnel: {
      arrivedCount: 0,
      passedCount: 0,
      trainingCount: 0
    }
  };
}

function buildTotalMatrixCell(cell) {
  const hasData = cell.monthlyTarget > 0 || cell.actualTraining > 0;
  const status = getCellStatus(cell.achievementRate, hasData);
  return {
    type: 'total',
    day: 'total',
    label: '合计',
    ...cell,
    status,
    statusText: getStatusText(status),
    achievementRateText: formatDashboardRate(cell.achievementRate),
    displayText: formatDashboardRate(cell.achievementRate)
  };
}

function getSortWeight(status) {
  const weights = {
    risk: 0,
    warning: 1,
    achieved: 2,
    empty: 3
  };
  return weights[status] ?? 9;
}

function toMatrixStatus(batchStatus) {
  if (batchStatus === 'missed') {
    return 'risk';
  }
  if (batchStatus === 'inProgress') {
    return 'warning';
  }
  if (batchStatus === 'notStarted') {
    return 'empty';
  }
  return batchStatus;
}

function buildBatchMatrix({ yearMonth, matrix, targets = [], employees = [], interviews = [], filters = {}, asOfDate = '' }) {
  const batchDays = getAllBatchDays(targets, yearMonth, filters);
  const statusFilter = toText(filters.status);
  const columns = [
    ...batchDays.map((day) => ({
      type: 'batch',
      day,
      label: `${Number(yearMonth.slice(5, 7))}月${day}日批次`
    })),
    { type: 'total', day: 'total', label: '合计' }
  ];
  const summary = {
    risk: 0,
    warning: 0,
    achieved: 0,
    empty: 0
  };
  const riskItems = [];

  const rows = [];
  matrix.rows.forEach((baseRow) => {
    matrix.channels.forEach((channel) => {
      const batches = buildBatchDrilldown({
        yearMonth,
        base: baseRow.base,
        channel,
        targets,
        employees,
        interviews,
        asOfDate
      });
      const batchMap = new Map(batches.map((batch) => [batch.day, {
        type: 'batch',
        ...batch,
        displayText: batch.achievementRateText
      }]));
      const cells = {};

      batchDays.forEach((day) => {
        const sourceCell = batchMap.get(day) || buildEmptyBatchCell(day, yearMonth);
        const matrixStatus = toMatrixStatus(sourceCell.status);
        const cell = {
          ...sourceCell,
          batchStatus: sourceCell.status,
          batchStatusText: sourceCell.statusText,
          status: matrixStatus,
          statusText: getStatusText(matrixStatus)
        };
        cells[day] = cell;
        summary[cell.status] += 1;
        if (cell.status === 'risk' || cell.status === 'warning') {
          riskItems.push({
            base: baseRow.base,
            channel,
            day,
            label: `${baseRow.base} / ${channel} / ${cell.label}`,
            status: cell.status,
            statusText: cell.statusText,
            gap: cell.gap,
            achievementRate: cell.achievementRate,
            achievementRateText: cell.achievementRateText,
            target: cell.target,
            actualTraining: cell.actualTraining,
            reason: cell.diagnosis?.reason || '',
            suggestion: cell.diagnosis?.suggestion || ''
          });
        }
      });

      const total = buildTotalMatrixCell(baseRow.cells[channel]);
      const row = {
        base: baseRow.base,
        channel,
        label: `${baseRow.base} / ${channel}`,
        cells,
        total
      };

      const matchesStatus = !statusFilter
        || Object.values(cells).some((cell) => cell.status === statusFilter)
        || total.status === statusFilter;
      if (matchesStatus) {
        rows.push(row);
      }
    });
  });

  riskItems.sort((left, right) => {
    const statusDiff = getSortWeight(left.status) - getSortWeight(right.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }
    if (left.gap !== right.gap) {
      return left.gap - right.gap;
    }
    return left.achievementRate - right.achievementRate;
  });

  rows.sort((left, right) => {
    const leftWorst = Math.min(...Object.values(left.cells).map((cell) => getSortWeight(cell.status)), getSortWeight(left.total.status));
    const rightWorst = Math.min(...Object.values(right.cells).map((cell) => getSortWeight(cell.status)), getSortWeight(right.total.status));
    if (leftWorst !== rightWorst) {
      return leftWorst - rightWorst;
    }
    return left.label.localeCompare(right.label, 'zh-Hans-CN');
  });

  return {
    columns,
    rows,
    summary,
    riskItems
  };
}

function findDefaultCell(matrix) {
  const statusPriority = ['risk', 'warning', 'achieved'];

  for (const status of statusPriority) {
    for (const row of matrix.rows) {
      const channel = matrix.channels.find((item) => row.cells[item]?.status === status);
      if (channel) {
        return {
          base: row.base,
          channel
        };
      }
    }
  }

  return {
    base: matrix.rows[0]?.base || '',
    channel: matrix.channels[0] || ''
  };
}

function findDefaultMatrixSelection(batchMatrix) {
  const firstRisk = batchMatrix.riskItems[0];
  if (firstRisk) {
    return {
      base: firstRisk.base,
      channel: firstRisk.channel,
      selectedBatchDay: firstRisk.day
    };
  }

  const firstRow = batchMatrix.rows[0];
  const firstColumn = batchMatrix.columns.find((column) => column.type === 'batch');
  return {
    base: firstRow?.base || '',
    channel: firstRow?.channel || '',
    selectedBatchDay: firstColumn?.day || 'total'
  };
}

function findSelectedMatrixDetail(batchMatrix, selectedCell) {
  const row = batchMatrix.rows.find((item) => item.base === selectedCell.base && item.channel === selectedCell.channel);
  if (!row) {
    return undefined;
  }

  const selectedBatchDay = selectedCell.selectedBatchDay;
  if (selectedBatchDay === 'total') {
    return row.total;
  }

  return row.cells[Number(selectedBatchDay)] || row.total;
}

function sortChannels(left, right) {
  const leftIndex = CHANNEL_DISPLAY_ORDER.indexOf(left.channel || left);
  const rightIndex = CHANNEL_DISPLAY_ORDER.indexOf(right.channel || right);
  const normalizedLeftIndex = leftIndex === -1 ? CHANNEL_DISPLAY_ORDER.length : leftIndex;
  const normalizedRightIndex = rightIndex === -1 ? CHANNEL_DISPLAY_ORDER.length : rightIndex;
  if (normalizedLeftIndex !== normalizedRightIndex) {
    return normalizedLeftIndex - normalizedRightIndex;
  }
  return toText(left.channel || left).localeCompare(toText(right.channel || right), 'zh-Hans-CN');
}

function pickPositionBase(progress, batchMatrix, selectedBase = '') {
  if (selectedBase) {
    return selectedBase;
  }
  if (batchMatrix.riskItems[0]?.base) {
    return batchMatrix.riskItems[0].base;
  }

  const bases = progress.bases || [];
  const worstBase = bases
    .map((base) => ({
      base: base.base,
      total: base.channelRows.find((row) => row.channel === '合计')
    }))
    .filter((item) => item.total)
    .sort((left, right) => {
      if (left.total.gap !== right.total.gap) {
        return left.total.gap - right.total.gap;
      }
      return left.total.achievementRate - right.total.achievementRate;
    })[0];

  return worstBase?.base || bases[0]?.base || '';
}

function buildBaseAchievementOverview(progress) {
  const baseAchievements = (progress.bases || [])
    .map((base) => {
      const total = base.channelRows.find((row) => row.channel === '合计') || {
        monthlyTarget: 0,
        cutoffTarget: 0,
        actualTraining: 0,
        gap: 0,
        achievementRate: 0,
        achievementRateText: '0.00%'
      };
      const status = getCutoffTargetStatus(total);

      return {
        base: base.base,
        monthlyTarget: total.monthlyTarget,
        cutoffTarget: total.cutoffTarget,
        actualTraining: total.actualTraining,
        gap: total.gap,
        achievementRate: total.achievementRate,
        achievementRateText: total.achievementRateText,
        status,
        statusText: getStatusText(status)
      };
    })
    .filter((base) => base.monthlyTarget > 0 || base.actualTraining > 0)
    .sort((left, right) => {
      const statusDiff = getSortWeight(left.status) - getSortWeight(right.status);
      if (statusDiff !== 0) {
        return statusDiff;
      }
      if (left.gap !== right.gap) {
        return left.gap - right.gap;
      }
      return left.base.localeCompare(right.base, 'zh-Hans-CN');
    });
  const riskBaseCount = baseAchievements.filter((base) => base.status === 'risk' || base.status === 'warning').length;

  return {
    mode: 'baseOverview',
    base: '',
    title: '全部基地达成情况',
    total: {
      ...progress.overall,
      status: getCutoffTargetStatus(progress.overall),
      statusText: getStatusText(getCutoffTargetStatus(progress.overall))
    },
    baseAchievements,
    riskBaseCount,
    mainRiskText: riskBaseCount > 0
      ? `当前有 ${riskBaseCount} 个基地未达标或预警，优先处理达成率最低的基地`
      : '全部基地当前达成正常，保持招聘节奏'
  };
}

function buildPositionChannelBoard({ progress, batchMatrix, selectedBase = '', selectedBatchDay = '' }) {
  if (!selectedBase) {
    return buildBaseAchievementOverview(progress);
  }

  const base = pickPositionBase(progress, batchMatrix, selectedBase);
  const baseProgress = (progress.bases || []).find((item) => item.base === base);
  const baseRows = batchMatrix.rows.filter((row) => row.base === base);
  const total = baseProgress?.channelRows.find((row) => row.channel === '合计') || {
    monthlyTarget: 0,
    cutoffTarget: 0,
    actualTraining: 0,
    gap: 0,
    achievementRate: 0,
    achievementRateText: '0.00%'
  };
  const channels = baseRows
    .map((row) => ({
      channel: row.channel,
      monthlyTarget: row.total.monthlyTarget,
      cutoffTarget: row.total.cutoffTarget,
      actualTraining: row.total.actualTraining,
      gap: row.total.gap,
      achievementRate: row.total.achievementRate,
      achievementRateText: row.total.achievementRateText,
      status: row.total.status,
      statusText: row.total.statusText,
      targetShareText: row.total.targetShareText,
      actualShareText: row.total.actualShareText
    }))
    .filter((row) => row.monthlyTarget > 0 || row.actualTraining > 0)
    .sort(sortChannels);
  const batchColumns = batchMatrix.columns.filter((column) => column.type === 'batch');
  const batchRisks = batchColumns.map((column) => {
    const cells = baseRows
      .map((row) => ({
        channel: row.channel,
        ...row.cells[column.day]
      }))
      .filter((cell) => cell);
    const target = cells.reduce((sum, cell) => sum + Number(cell.target || 0), 0);
    const actualTraining = cells.reduce((sum, cell) => sum + Number(cell.actualTraining || 0), 0);
    const gap = actualTraining - target;
    const achievementRate = target > 0 ? actualTraining / target : 0;
    const worstCell = cells
      .slice()
      .sort((left, right) => {
        const statusDiff = getSortWeight(left.status) - getSortWeight(right.status);
        if (statusDiff !== 0) {
          return statusDiff;
        }
        return Number(left.gap || 0) - Number(right.gap || 0);
      })[0];
    const status = worstCell?.status || getCellStatus(achievementRate, target > 0 || actualTraining > 0);

    return {
      day: column.day,
      label: column.label,
      target,
      actualTraining,
      gap,
      achievementRate,
      achievementRateText: formatDashboardRate(achievementRate),
      status,
      statusText: getStatusText(status),
      reason: worstCell?.diagnosis?.reason || (gap >= 0 ? '达标 / 正常' : '存在入职缺口'),
      suggestion: worstCell?.diagnosis?.suggestion || '',
      worstChannel: worstCell?.channel || ''
    };
  });
  const selectedDay = Number(selectedBatchDay || batchRisks.find((batch) => batch.status === 'risk')?.day || batchRisks[0]?.day || 0);
  const selectedBatchSummary = batchRisks.find((batch) => batch.day === selectedDay) || batchRisks[0];
  const selectedBatchRows = baseRows
    .map((row) => ({
      channel: row.channel,
      ...(row.cells[selectedBatchSummary?.day] || {})
    }))
    .filter((cell) => cell.day)
    .sort(sortChannels);
  const mainRisks = batchRisks
    .filter((batch) => batch.status === 'risk' || batch.status === 'warning')
    .map((batch) => `${batch.worstChannel || '多渠道'}${batch.reason}`)
    .slice(0, 2);

  return {
    mode: 'position',
    base,
    title: base ? `${base} · 多渠道岗位` : '多渠道岗位',
    total: {
      ...total,
      status: getCellStatus(total.achievementRate, total.monthlyTarget > 0 || total.actualTraining > 0),
      statusText: getStatusText(getCellStatus(total.achievementRate, total.monthlyTarget > 0 || total.actualTraining > 0))
    },
    channels,
    batchRisks,
    selectedBatch: selectedBatchSummary ? {
      ...selectedBatchSummary,
      channels: selectedBatchRows
    } : undefined,
    mainRiskText: mainRisks.length > 0 ? `当前主要风险：${mainRisks.join('，')}` : '当前无明显 GAP 风险，保持渠道节奏'
  };
}

function buildOverviewInsights({ progress, trainingDetails = [], selfSourcingEfficiency = [] }) {
  const overall = progress.overall || {};
  const overallEfficiency = selfSourcingEfficiency.find((item) => item.stage === '整体') || {
    recruiterCount: 0,
    efficiency: '0.0'
  };
  const probationEfficiency = selfSourcingEfficiency.find((item) => item.stage === '试用期') || {
    recruiterCount: 0,
    trainingCount: 0,
    efficiency: '0.0'
  };
  const formalEfficiency = selfSourcingEfficiency.find((item) => item.stage === '正式期') || {
    recruiterCount: 0,
    trainingCount: 0,
    efficiency: '0.0'
  };
  const cutoffAchievementRate = overall.cutoffTarget > 0
    ? overall.actualTraining / overall.cutoffTarget
    : 0;
  const overallRiskStatus = getCutoffTargetStatus(overall);
  const actualTotal = overall.actualTraining || 0;
  const channelShares = CHANNEL_DISPLAY_ORDER.map((channel) => {
    const source = (progress.channels || []).find((item) => item.channel === channel) || {
      monthlyTarget: 0,
      actualTraining: 0
    };
    const share = actualTotal > 0 ? source.actualTraining / actualTotal : 0;

    return {
      channel,
      monthlyTarget: source.monthlyTarget,
      actualTraining: source.actualTraining,
      share,
      shareText: formatPercent(share)
    };
  });
  const baseAchievements = (progress.bases || [])
    .map((base) => {
      const total = base.channelRows.find((row) => row.channel === '合计') || {
        monthlyTarget: 0,
        cutoffTarget: 0,
        actualTraining: 0,
        gap: 0,
        achievementRate: 0,
        achievementRateText: '0.00%'
      };
      const status = getCutoffTargetStatus(total);

      return {
        base: base.base,
        monthlyTarget: total.monthlyTarget,
        cutoffTarget: total.cutoffTarget,
        actualTraining: total.actualTraining,
        gap: total.gap,
        achievementRate: total.achievementRate,
        achievementRateText: total.achievementRateText,
        status,
        statusText: getStatusText(status)
      };
    })
    .filter((base) => base.monthlyTarget > 0 || base.actualTraining > 0);
  const socialChannelMap = new Map();
  trainingDetails
    .filter((employee) => employee.channelType === '渠道社招')
    .forEach((employee) => {
      const channelName = toText(employee.channelName) || '未填写渠道名称';
      const base = toText(employee.base) || '未填写基地';
      if (!socialChannelMap.has(channelName)) {
        socialChannelMap.set(channelName, {
          channelName,
          total: 0,
          bases: new Map()
        });
      }
      const item = socialChannelMap.get(channelName);
      item.total += 1;
      item.bases.set(base, (item.bases.get(base) || 0) + 1);
    });
  const socialChannelTop3 = Array.from(socialChannelMap.values())
    .map((item) => {
      const baseBreakdown = Array.from(item.bases.entries())
        .map(([base, count]) => ({ base, count }))
        .sort((left, right) => {
          if (left.count !== right.count) {
            return right.count - left.count;
          }
          return left.base.localeCompare(right.base, 'zh-Hans-CN');
        });

      return {
        channelName: item.channelName,
        total: item.total,
        baseBreakdown,
        baseBreakdownText: baseBreakdown.map((base) => `${base.base}${base.count}`).join('、')
      };
    })
    .sort((left, right) => {
      if (left.total !== right.total) {
        return right.total - left.total;
      }
      return left.channelName.localeCompare(right.channelName, 'zh-Hans-CN');
    })
    .slice(0, 3);

  return {
    cards: {
      targetAchievementRateText: overall.achievementRateText || formatPercent(overall.achievementRate || 0),
      selfSourcingShareText: overall.selfSourcingShareText || '0.00%',
      selfSourcingEfficiency: overallEfficiency.efficiency,
      recruiterTeamSize: overallEfficiency.recruiterCount
    },
    overallRisk: {
      monthlyTarget: overall.monthlyTarget || 0,
      cutoffTarget: overall.cutoffTarget || 0,
      actualTraining: overall.actualTraining || 0,
      gap: overall.gap || 0,
      achievementRate: overall.achievementRate || 0,
      achievementRateText: overall.achievementRateText || '0.00%',
      cutoffAchievementRate,
      cutoffAchievementRateText: formatPercent(cutoffAchievementRate),
      status: overallRiskStatus,
      statusText: getStatusText(overallRiskStatus)
    },
    baseAchievements,
    channelShares,
    socialChannelTop3,
    selfSourcingEfficiency: [overallEfficiency, probationEfficiency, formalEfficiency]
  };
}

function getDashboardOverview(query = {}) {
  const progress = getTargetProgress(query);
  const yearMonth = progress.yearMonth;
  const filters = {
    base: toText(query.base),
    channel: toText(query.channel),
    status: toText(query.status)
  };
  const selectedFromQuery = {
    base: toText(query.selectedBase),
    channel: toText(query.selectedChannel),
    selectedBatchDay: toText(query.selectedBatchDay)
  };
  const targets = yearMonth ? listTargetsByMonth(yearMonth) : [];
  const employees = listAllEmployees();
  const interviews = yearMonth ? listAllInterviewRecords({ yearMonth }) : [];
  const matrix = buildDashboardMatrix(progress, filters);
  const batchMatrix = buildBatchMatrix({
    yearMonth,
    matrix,
    targets,
    employees,
    interviews,
    filters,
    asOfDate: query.cutoffDate || formatDate(new Date())
  });
  const defaultCell = findDefaultMatrixSelection(batchMatrix);
  const selectedCell = {
    base: selectedFromQuery.base || defaultCell.base,
    channel: selectedFromQuery.channel || defaultCell.channel,
    selectedBatchDay: selectedFromQuery.selectedBatchDay || defaultCell.selectedBatchDay
  };
  const positionBoard = buildPositionChannelBoard({
    progress,
    batchMatrix,
    selectedBase: filters.base,
    selectedBatchDay: selectedCell.selectedBatchDay
  });
  const details = getTrainingDetails({ yearMonth });
  const selfSourcingCount = details.filter((item) => item.channelType === '自主社招').length;
  const selfSourcingEfficiency = getSelfSourcingEfficiency({ yearMonth });
  const overallEfficiency = selfSourcingEfficiency.find((item) => item.stage === '整体');
  const overviewInsights = buildOverviewInsights({
    progress,
    trainingDetails: details,
    selfSourcingEfficiency
  });

  const batches = buildBatchDrilldown({
    yearMonth,
    base: selectedCell.base,
    channel: selectedCell.channel,
    targets,
    employees,
    interviews,
    asOfDate: query.cutoffDate || formatDate(new Date())
  });
  const selectedBatchDay = selectedCell.selectedBatchDay === 'total'
    ? 'total'
    : Number(selectedCell.selectedBatchDay || batches[0]?.day || 0);

  return {
    ...progress,
    topMetrics: {
      ...progress.overall,
      selfSourcingEfficiency: overallEfficiency ? overallEfficiency.efficiency : '0.0',
      selfSourcingShare: progress.overall.actualTraining > 0
        ? selfSourcingCount / progress.overall.actualTraining
        : 0
    },
    trainingDetails: details,
    selfSourcingEfficiency,
    overviewInsights,
    filters,
    options: getDistinctTargetFilterOptions(),
    matrix,
    batchMatrix,
    positionBoard,
    selectedCell,
    selectedBatchDay,
    selectedBatch: batches.find((batch) => batch.day === selectedBatchDay) || batches[0],
    selectedMatrixDetail: findSelectedMatrixDetail(batchMatrix, {
      ...selectedCell,
      selectedBatchDay
    }),
    batches,
    monthLastDate: yearMonth ? buildDate(yearMonth, getMonthLastDay(yearMonth)) : ''
  };
}

module.exports = {
  buildBatchDrilldown,
  buildBatchMatrix,
  buildDashboardMatrix,
  buildOverviewInsights,
  buildPositionChannelBoard,
  getDashboardOverview,
  getTrainingDetails,
  getSelfSourcingEfficiency
};
