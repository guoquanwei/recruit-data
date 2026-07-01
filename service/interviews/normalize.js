const { normalizeDate } = require('../shared/date');
const { toText } = require('../shared/format');

function inferInterviewBase(positionName) {
  const text = toText(positionName);

  if (text.includes('江苏基地') && text.includes('淮安')) return '江苏基地-淮安';
  if (text.includes('江苏基地') && text.includes('南京')) return '江苏基地-南京';
  if (text.includes('韶关基地') || text.includes('南二在线')) return '南二在线客服项目';
  if (text.includes('联通河北') || text.includes('石家庄')) return '联通河北';
  if (text.includes('联通天津')) return '联通天津';
  if (text.includes('15中台') || text.includes('10015')) return '10015升投';
  if (text.includes('京东')) return '京东外呼项目';
  if (text.includes('辽宁') && (text.includes('10016') || text.includes('外呼'))) return '辽宁外呼项目';
  if (text.includes('长春基地') && (text.includes('10016') || text.includes('外呼'))) return '吉林外呼项目';
  if (text.includes('长春基地') || text.includes('吉林10010') || text.includes('热转')) return '长春热线项目';
  if (text.includes('济南') && text.includes('夏都')) return '济南基地-夏都';
  if (text.includes('济南') || text.includes('济阳')) return '济南基地-济阳';
  if (text.includes('湖南基地') && text.includes('荷花')) return '湖南基地-荷花';
  if (text.includes('湖南基地') && text.includes('空港')) return '湖南基地-空港';
  if (text.includes('成都中行') || text.includes('重庆中行') || text.includes('天津中行')) return '新业务运营中心';
  if (text.includes('成都') || text.includes('四川')) return '成都基地';

  return '';
}

function normalizeInterviewRecord(row) {
  const channelType = toText(row.猎头公司标签);
  const channelName = toText(row.猎头合约名称);
  const positionName = toText(row.职位名称);

  return {
    base: inferInterviewBase(positionName),
    positionName,
    candidateName: toText(row.候选人名称),
    gender: toText(row.性别),
    phone: toText(row.电话),
    feedbackDate: normalizeDate(row.面试官填写反馈时间),
    feedbackResult: toText(row.面试官反馈结果),
    interviewer: toText(row.面试官),
    channelType,
    channelName,
    channelTag: channelType,
    contractName: channelName,
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
  inferInterviewBase,
  normalizeInterviewRecord,
  resolveInterviewOverwriteDates
};
