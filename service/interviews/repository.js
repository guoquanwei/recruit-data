const { queryAll, queryOne } = require('../../dao/db');
const { bulkInsert } = require('../../dao/bulkInsert');

const INTERVIEW_COLUMNS = [
  'base',
  'position_name',
  'candidate_name',
  'gender',
  'phone',
  'feedback_date',
  'feedback_result',
  'interviewer',
  'channel_type',
  'channel_name',
  'channel_tag',
  'contract_name',
  'referrer',
  'evaluation'
];

async function insertInterviewRecords(database, records) {
  return bulkInsert(database, {
    tableName: 'interview_records',
    columns: INTERVIEW_COLUMNS,
    rows: records,
    mapRow: (record) => [
      record.base,
      record.positionName,
      record.candidateName,
      record.gender,
      record.phone,
      record.feedbackDate,
      record.feedbackResult,
      record.interviewer,
      record.channelType,
      record.channelName,
      record.channelTag,
      record.contractName,
      record.referrer,
      record.evaluation
    ]
  });
}

async function replaceAllInterviewRecords(database, records) {
  await database.query('DELETE FROM interview_records');
  return insertInterviewRecords(database, records);
}

async function replaceInterviewRecordsByDates(database, dates, records) {
  if (dates.length > 0) {
    await database.query('DELETE FROM interview_records WHERE feedback_date = ANY($1)', [dates]);
  }

  return insertInterviewRecords(database, records);
}

function fromDatabaseRow(row) {
  return {
    id: row.id,
    base: row.base,
    positionName: row.position_name,
    candidateName: row.candidate_name,
    gender: row.gender,
    phone: row.phone,
    feedbackDate: row.feedback_date,
    feedbackResult: row.feedback_result,
    interviewer: row.interviewer,
    channelType: row.channel_type || row.channel_tag,
    channelName: row.channel_name || row.contract_name,
    channelTag: row.channel_tag,
    contractName: row.contract_name,
    referrer: row.referrer,
    evaluation: row.evaluation
  };
}

function buildInterviewFilters(filters = {}) {
  const where = [];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.keyword) {
    const keyword = addParam(`%${filters.keyword}%`);
    where.push(`(position_name LIKE ${keyword} OR candidate_name LIKE ${keyword} OR phone LIKE ${keyword} OR evaluation LIKE ${keyword})`);
  }
  if (filters.yearMonth) {
    where.push(`feedback_date >= ${addParam(`${filters.yearMonth}-01`)} AND feedback_date <= ${addParam(`${filters.yearMonth}-31`)}`);
  }
  if (filters.base) {
    where.push(`base = ${addParam(filters.base)}`);
  }
  if (filters.positionName) {
    where.push(`position_name = ${addParam(filters.positionName)}`);
  }
  if (filters.feedbackDate) {
    where.push(`feedback_date = ${addParam(filters.feedbackDate)}`);
  }
  if (filters.feedbackResult) {
    where.push(`feedback_result = ${addParam(filters.feedbackResult)}`);
  }
  if (filters.interviewer) {
    where.push(`interviewer = ${addParam(filters.interviewer)}`);
  }
  if (filters.channelTag) {
    where.push(`channel_tag = ${addParam(filters.channelTag)}`);
  }
  if (filters.channelType) {
    where.push(`channel_type = ${addParam(filters.channelType)}`);
  }
  if (filters.channelName) {
    where.push(`channel_name = ${addParam(filters.channelName)}`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

async function listInterviewRecords({ filters = {}, page }) {
  const { whereSql, params } = buildInterviewFilters(filters);
  const total = await queryOne(`SELECT COUNT(*)::int AS total FROM interview_records ${whereSql}`, params);
  const rows = await queryAll(`
    SELECT *
    FROM interview_records
    ${whereSql}
    ORDER BY feedback_date DESC, id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, page.limit, page.offset]);

  return {
    total: total.total,
    rows: rows.map(fromDatabaseRow)
  };
}

let allInterviewsCache;

function clearInterviewCache() {
  allInterviewsCache = undefined;
}

async function listAllInterviewRecords(filters = {}) {
  if (!filters || Object.keys(filters).length === 0) {
    if (allInterviewsCache) {
      return allInterviewsCache;
    }
    allInterviewsCache = (await queryAll('SELECT * FROM interview_records')).map(fromDatabaseRow);
    return allInterviewsCache;
  }

  const { whereSql, params } = buildInterviewFilters(filters);
  const rows = await queryAll(`SELECT * FROM interview_records ${whereSql}`, params);
  return rows.map(fromDatabaseRow);
}

async function getDistinctInterviewFilterOptions() {
  const pluck = async (sql, field) => (await queryAll(sql)).map((row) => row[field]).filter(Boolean);

  return {
    months: await pluck("SELECT DISTINCT substring(feedback_date from 1 for 7) AS month FROM interview_records WHERE feedback_date <> '' ORDER BY month DESC", 'month'),
    bases: await pluck("SELECT DISTINCT base FROM interview_records WHERE base <> '' ORDER BY base", 'base'),
    positionNames: await pluck('SELECT DISTINCT position_name FROM interview_records ORDER BY position_name', 'position_name'),
    feedbackResults: await pluck('SELECT DISTINCT feedback_result FROM interview_records ORDER BY feedback_result', 'feedback_result'),
    interviewers: await pluck('SELECT DISTINCT interviewer FROM interview_records ORDER BY interviewer', 'interviewer'),
    channelTags: await pluck('SELECT DISTINCT channel_tag FROM interview_records ORDER BY channel_tag', 'channel_tag'),
    channelTypes: await pluck('SELECT DISTINCT channel_type FROM interview_records ORDER BY channel_type', 'channel_type'),
    channelNames: await pluck('SELECT DISTINCT channel_name FROM interview_records ORDER BY channel_name', 'channel_name')
  };
}

module.exports = {
  buildInterviewFilters,
  clearInterviewCache,
  insertInterviewRecords,
  replaceAllInterviewRecords,
  replaceInterviewRecordsByDates,
  listInterviewRecords,
  listAllInterviewRecords,
  getDistinctInterviewFilterOptions
};