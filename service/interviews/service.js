const { listAllEmployees } = require('../employees/repository');
const { maskPhone, parsePage, toText, formatPercent } = require('../shared/format');
const { getDistinctInterviewFilterOptions, listAllInterviewRecords, listInterviewRecords } = require('./repository');

function buildInterviewFilters(query = {}) {
  return {
    keyword: toText(query.keyword),
    yearMonth: toText(query.yearMonth),
    base: toText(query.base),
    positionName: toText(query.positionName),
    feedbackDate: toText(query.feedbackDate),
    feedbackResult: toText(query.feedbackResult),
    interviewer: toText(query.interviewer),
    channelTag: toText(query.channelTag),
    channelType: toText(query.channelType),
    channelName: toText(query.channelName)
  };
}

function toInterviewViewModel(record) {
  return {
    ...record,
    maskedPhone: maskPhone(record.phone)
  };
}

function getInterviewList(query = {}) {
  const page = parsePage(query);
  const filters = buildInterviewFilters(query);
  const result = listInterviewRecords({ filters, page });

  return {
    ...result,
    rows: result.rows.map(toInterviewViewModel),
    page,
    filters,
    options: getDistinctInterviewFilterOptions(),
    emptyMessage: result.total === 0
      ? '没有符合筛选条件的面试记录，请调整筛选项后重试。'
      : ''
  };
}

function getInterviewExportRows(query = {}) {
  const filters = buildInterviewFilters(query);
  const result = listInterviewRecords({
    filters,
    page: {
      limit: 1_000_000,
      offset: 0
    }
  });

  return result.rows.map(toInterviewViewModel);
}


function getInterviewFunnel(query = {}) {
  const options = getDistinctInterviewFilterOptions();
  const filters = buildInterviewFilters(query);
  filters.yearMonth = filters.yearMonth || options.months[0] || '';
  const records = listAllInterviewRecords(filters);
  const employees = listAllEmployees();
  const employeePhones = new Set(employees.map((employee) => toText(employee.phone)).filter(Boolean));
  const feedbackCounts = new Map();

  records.forEach((record) => {
    const result = record.feedbackResult || '未填写';
    feedbackCounts.set(result, (feedbackCounts.get(result) || 0) + 1);
  });

  return {
    filters,
    options,
    overview: {
      interviewCount: records.length,
      baseMatchedCount: records.filter((record) => record.base).length,
      baseUnmatchedCount: records.filter((record) => !record.base).length
    },
    feedbackResults: Array.from(feedbackCounts.entries()).map(([name, count]) => ({ name, count })),
    monthlyRows: buildMonthlyFunnelRows(records, employees, filters.yearMonth),
    bases: buildFunnelRows(records, employeePhones, (record) => record.base || '未匹配基地', 'base'),
    channels: buildFunnelRows(records, employeePhones, (record) => record.channelType || '未填写', 'channel'),
    channelNames: buildFunnelRows(records, employeePhones, (record) => record.channelName || '未填写', 'channelName').slice(0, 50)
  };
}

function isPassedInterview(record) {
  return ['推荐', '强烈推荐'].includes(record.feedbackResult);
}

function buildMonthlyFunnelRows(records, employees, yearMonth) {
  const baseMap = new Map();

  records.forEach((record) => {
    const base = record.base || '未匹配基地';
    const row = baseMap.get(base) || {
      base,
      arrivedCount: 0,
      passedCount: 0,
      trainingCount: 0
    };

    row.arrivedCount += 1;
    if (isPassedInterview(record)) {
      row.passedCount += 1;
    }
    baseMap.set(base, row);
  });

  const trainedEmployeesByBase = new Map();
  employees.forEach((employee) => {
    if (yearMonth && !String(employee.trainingDate || '').startsWith(yearMonth)) {
      return;
    }

    const base = employee.base || '未匹配基地';
    const employeeKey = employee.employeeNo || toText(employee.phone);
    if (!employeeKey) {
      return;
    }

    if (!baseMap.has(base)) {
      baseMap.set(base, {
        base,
        arrivedCount: 0,
        passedCount: 0,
        trainingCount: 0
      });
    }
    const employeeKeys = trainedEmployeesByBase.get(base) || new Set();
    employeeKeys.add(employeeKey);
    trainedEmployeesByBase.set(base, employeeKeys);
  });

  return Array.from(baseMap.values())
    .map((row) => {
      const trainingCount = trainedEmployeesByBase.get(row.base)?.size || 0;
      const passRate = row.arrivedCount > 0 ? row.passedCount / row.arrivedCount : 0;
      const trainingRate = row.passedCount > 0 ? trainingCount / row.passedCount : 0;

      return {
        ...row,
        trainingCount,
        passRate,
        trainingRate,
        passRateText: formatPercent(passRate),
        trainingRateText: formatPercent(trainingRate)
      };
    })
    .sort((left, right) => right.arrivedCount - left.arrivedCount);
}

function buildFunnelRows(records, employeePhones, getName, fieldName) {
  const counts = new Map();

  records.forEach((record) => {
    const name = getName(record);
    const item = counts.get(name) || {
      [fieldName]: name,
      interviewCount: 0,
      recommendedCount: 0,
      trainingCount: 0
    };

    item.interviewCount += 1;
    if (['推荐', '强烈推荐'].includes(record.feedbackResult)) {
      item.recommendedCount += 1;
      if (employeePhones.has(toText(record.phone))) {
        item.trainingCount += 1;
      }
    }

    counts.set(name, item);
  });

  return Array.from(counts.values())
    .map((item) => ({
      ...item,
      conversionRate: item.recommendedCount > 0 ? item.trainingCount / item.recommendedCount : 0,
      conversionRateText: formatPercent(item.recommendedCount > 0 ? item.trainingCount / item.recommendedCount : 0)
    }))
    .sort((left, right) => right.interviewCount - left.interviewCount);
}

module.exports = {
  buildFunnelRows,
  buildMonthlyFunnelRows,
  getInterviewExportRows,
  getInterviewList,
  getInterviewFunnel,
  toInterviewViewModel
};
