const { getDatabase } = require('../../dao/db');

function insertInterviewRecords(database, records) {
  const statement = database.prepare(`
    INSERT INTO interview_records (
      position_name,
      candidate_name,
      gender,
      phone,
      feedback_date,
      feedback_result,
      interviewer,
      channel_tag,
      contract_name,
      referrer,
      evaluation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  records.forEach((record) => {
    statement.run(
      record.positionName,
      record.candidateName,
      record.gender,
      record.phone,
      record.feedbackDate,
      record.feedbackResult,
      record.interviewer,
      record.channelTag,
      record.contractName,
      record.referrer,
      record.evaluation
    );
  });

  return records.length;
}

function replaceAllInterviewRecords(database, records) {
  database.prepare('DELETE FROM interview_records').run();
  return insertInterviewRecords(database, records);
}

function replaceInterviewRecordsByDates(database, dates, records) {
  const statement = database.prepare('DELETE FROM interview_records WHERE feedback_date = ?');
  dates.forEach((date) => statement.run(date));

  return insertInterviewRecords(database, records);
}

function fromDatabaseRow(row) {
  return {
    id: row.id,
    positionName: row.position_name,
    candidateName: row.candidate_name,
    gender: row.gender,
    phone: row.phone,
    feedbackDate: row.feedback_date,
    feedbackResult: row.feedback_result,
    interviewer: row.interviewer,
    channelTag: row.channel_tag,
    contractName: row.contract_name,
    referrer: row.referrer,
    evaluation: row.evaluation
  };
}

function buildInterviewFilters(filters = {}) {
  const where = [];
  const params = {};

  if (filters.keyword) {
    where.push('(position_name LIKE @keyword OR candidate_name LIKE @keyword OR phone LIKE @keyword OR evaluation LIKE @keyword)');
    params.keyword = `%${filters.keyword}%`;
  }
  if (filters.feedbackDate) {
    where.push('feedback_date = @feedbackDate');
    params.feedbackDate = filters.feedbackDate;
  }
  if (filters.feedbackResult) {
    where.push('feedback_result = @feedbackResult');
    params.feedbackResult = filters.feedbackResult;
  }
  if (filters.interviewer) {
    where.push('interviewer = @interviewer');
    params.interviewer = filters.interviewer;
  }
  if (filters.channelTag) {
    where.push('channel_tag = @channelTag');
    params.channelTag = filters.channelTag;
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

function listInterviewRecords({ filters = {}, page }) {
  const database = getDatabase();
  const { whereSql, params } = buildInterviewFilters(filters);
  const total = database.prepare(`SELECT COUNT(*) AS total FROM interview_records ${whereSql}`).get(params).total;
  const rows = database.prepare(`
    SELECT *
    FROM interview_records
    ${whereSql}
    ORDER BY feedback_date DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all({
    ...params,
    limit: page.limit,
    offset: page.offset
  });

  return {
    total,
    rows: rows.map(fromDatabaseRow)
  };
}

function listAllInterviewRecords() {
  const database = getDatabase();
  return database.prepare('SELECT * FROM interview_records').all().map(fromDatabaseRow);
}

function getDistinctInterviewFilterOptions() {
  const database = getDatabase();
  const pluck = (sql, field) => database.prepare(sql).all().map((row) => row[field]).filter(Boolean);

  return {
    feedbackResults: pluck('SELECT DISTINCT feedback_result FROM interview_records ORDER BY feedback_result', 'feedback_result'),
    interviewers: pluck('SELECT DISTINCT interviewer FROM interview_records ORDER BY interviewer', 'interviewer'),
    channelTags: pluck('SELECT DISTINCT channel_tag FROM interview_records ORDER BY channel_tag', 'channel_tag')
  };
}

module.exports = {
  insertInterviewRecords,
  replaceAllInterviewRecords,
  replaceInterviewRecordsByDates,
  listInterviewRecords,
  listAllInterviewRecords,
  getDistinctInterviewFilterOptions
};
