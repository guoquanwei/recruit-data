const { listAllEmployees } = require('../employees/repository');
const { maskPhone, parsePage, toText, formatPercent } = require('../shared/format');
const { getDistinctInterviewFilterOptions, listAllInterviewRecords, listInterviewRecords } = require('./repository');

function buildInterviewFilters(query = {}) {
  return {
    keyword: toText(query.keyword),
    feedbackDate: toText(query.feedbackDate),
    feedbackResult: toText(query.feedbackResult),
    interviewer: toText(query.interviewer),
    channelTag: toText(query.channelTag)
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

function getInterviewFunnel() {
  const records = listAllInterviewRecords();
  const employees = listAllEmployees();
  const employeePhones = new Set(employees.map((employee) => toText(employee.phone)).filter(Boolean));
  const feedbackCounts = new Map();
  const channelCounts = new Map();

  records.forEach((record) => {
    const result = record.feedbackResult || '未填写';
    feedbackCounts.set(result, (feedbackCounts.get(result) || 0) + 1);

    const channel = record.channelTag || '未填写';
    const channelItem = channelCounts.get(channel) || { channel, interviewCount: 0, recommendedCount: 0, trainingCount: 0 };
    channelItem.interviewCount += 1;

    if (['推荐', '强烈推荐'].includes(result)) {
      channelItem.recommendedCount += 1;
      if (employeePhones.has(toText(record.phone))) {
        channelItem.trainingCount += 1;
      }
    }

    channelCounts.set(channel, channelItem);
  });

  return {
    feedbackResults: Array.from(feedbackCounts.entries()).map(([name, count]) => ({ name, count })),
    channels: Array.from(channelCounts.values()).map((item) => ({
      ...item,
      conversionRate: item.recommendedCount > 0 ? item.trainingCount / item.recommendedCount : 0,
      conversionRateText: formatPercent(item.recommendedCount > 0 ? item.trainingCount / item.recommendedCount : 0)
    }))
  };
}

module.exports = {
  getInterviewList,
  getInterviewFunnel,
  toInterviewViewModel
};
