const { getDatabase } = require('../../dao/db');

function insertInterviewRecords(database, records) {
  const statement = database.prepare(`
    INSERT INTO interview_records (
      base,
      position_name,
      candidate_name,
      gender,
      phone,
      feedback_date,
      feedback_result,
      interviewer,
      channel_type,
      channel_name,
      channel_tag,
      contract_name,
      referrer,
      evaluation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  records.forEach((record) => {
    statement.run(
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
  const params = {};

  if (filters.keyword) {
    where.push('(position_name LIKE @keyword OR candidate_name LIKE @keyword OR phone LIKE @keyword OR evaluation LIKE @keyword)');
    params.keyword = `%${filters.keyword}%`;
  }
  if (filters.yearMonth) {
    where.push('feedback_date >= @monthStart AND feedback_date <= @monthEnd');
    params.monthStart = `${filters.yearMonth}-01`;
    params.monthEnd = `${filters.yearMonth}-31`;
  }
  if (filters.base) {
    where.push('base = @base');
    params.base = filters.base;
  }
  if (filters.positionName) {
    where.push('position_name = @positionName');
    params.positionName = filters.positionName;
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
  if (filters.channelType) {
    where.push('channel_type = @channelType');
    params.channelType = filters.channelType;
  }
  if (filters.channelName) {
    where.push('channel_name = @channelName');
    params.channelName = filters.channelName;
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

function listAllInterviewRecords(filters = {}) {
  const database = getDatabase();
  const { whereSql, params } = buildInterviewFilters(filters);
  return database.prepare(`SELECT * FROM interview_records ${whereSql}`).all(params).map(fromDatabaseRow);
}

function getDistinctInterviewFilterOptions() {
  const database = getDatabase();
  const pluck = (sql, field) => database.prepare(sql).all().map((row) => row[field]).filter(Boolean);

  return {
    months: pluck("SELECT DISTINCT substr(feedback_date, 1, 7) AS month FROM interview_records WHERE feedback_date <> '' ORDER BY month DESC", 'month'),
    bases: pluck("SELECT DISTINCT base FROM interview_records WHERE base <> '' ORDER BY base", 'base'),
    positionNames: pluck('SELECT DISTINCT position_name FROM interview_records ORDER BY position_name', 'position_name'),
    feedbackResults: pluck('SELECT DISTINCT feedback_result FROM interview_records ORDER BY feedback_result', 'feedback_result'),
    interviewers: pluck('SELECT DISTINCT interviewer FROM interview_records ORDER BY interviewer', 'interviewer'),
    channelTags: pluck('SELECT DISTINCT channel_tag FROM interview_records ORDER BY channel_tag', 'channel_tag'),
    channelTypes: pluck('SELECT DISTINCT channel_type FROM interview_records ORDER BY channel_type', 'channel_type'),
    channelNames: pluck('SELECT DISTINCT channel_name FROM interview_records ORDER BY channel_name', 'channel_name')
  };
}

module.exports = {
  buildInterviewFilters,
  insertInterviewRecords,
  replaceAllInterviewRecords,
  replaceInterviewRecordsByDates,
  listInterviewRecords,
  listAllInterviewRecords,
  getDistinctInterviewFilterOptions
};
