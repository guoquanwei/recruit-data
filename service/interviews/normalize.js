const { normalizeDate } = require('../shared/date');
const { toText } = require('../shared/format');

function normalizeInterviewRecord(row) {
  return {
    positionName: toText(row.职位名称),
    candidateName: toText(row.候选人名称),
    gender: toText(row.性别),
    phone: toText(row.电话),
    feedbackDate: normalizeDate(row.面试官填写反馈时间),
    feedbackResult: toText(row.面试官反馈结果),
    interviewer: toText(row.面试官),
    channelTag: toText(row.猎头公司标签),
    contractName: toText(row.猎头合约名称),
    referrer: toText(row.内推人),
    evaluation: toText(row.综合评价)
  };
}

function resolveInterviewOverwriteDates(records) {
  return Array.from(new Set(
    records
      .map((record) => normalizeDate(record.feedbackDate || record.面试官填写反馈时间))
      .filter(Boolean)
  )).sort();
}

module.exports = {
  normalizeInterviewRecord,
  resolveInterviewOverwriteDates
};
