const { getDatabase } = require('../../dao/db');
const { isFrontlineEmployee } = require('./normalize');

const EMPLOYEE_COLUMNS = [
  'source_type',
  'employee_no',
  'name',
  'employee_status',
  'base',
  'department',
  'position',
  'channel_type',
  'channel_name',
  'office_location',
  'training_date',
  'entry_date',
  'resigned_date',
  'phone',
  'id_card',
  'handover_date'
];

const BASE_OPTION_ORDER = [
  '联通河北',
  '联通天津',
  '联通北京',
  '10015升投',
  '南二在线客服项目',
  '长春热线项目',
  '吉林外呼项目',
  '江苏基地-南京',
  '江苏基地-淮安',
  '济南基地-济阳',
  '济南基地-夏都',
  '湖南基地-空港',
  '湖南基地-荷花',
  '成都基地',
  '宜宾基地',
  '合肥基地',
  '新业务运营中心',
  'ITO项目'
];

function toDatabaseRow(employee) {
  return {
    source_type: employee.sourceType,
    employee_no: employee.employeeNo,
    name: employee.name,
    employee_status: employee.employeeStatus,
    base: employee.base,
    department: employee.department,
    position: employee.position,
    channel_type: employee.channelType,
    channel_name: employee.channelName,
    office_location: employee.officeLocation,
    training_date: employee.trainingDate,
    entry_date: employee.entryDate,
    resigned_date: employee.resignedDate,
    phone: employee.phone,
    id_card: employee.idCard,
    handover_date: employee.handoverDate
  };
}

function fromDatabaseRow(row) {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    sourceType: row.source_type,
    employeeNo: row.employee_no,
    name: row.name,
    employeeStatus: row.employee_status,
    base: row.base,
    department: row.department,
    position: row.position,
    channelType: row.channel_type,
    channelName: row.channel_name,
    officeLocation: row.office_location,
    trainingDate: row.training_date,
    entryDate: row.entry_date,
    resignedDate: row.resigned_date,
    phone: row.phone,
    idCard: row.id_card,
    handoverDate: row.handover_date
  };
}

function replaceEmployeesBySource(database, sourceType, employees) {
  database.prepare('DELETE FROM employees WHERE source_type = ?').run(sourceType);

  const placeholders = EMPLOYEE_COLUMNS.map((column) => `@${column}`).join(', ');
  const statement = database.prepare(`
    INSERT INTO employees (${EMPLOYEE_COLUMNS.join(', ')})
    VALUES (${placeholders})
  `);

  employees.forEach((employee) => {
    statement.run(toDatabaseRow(employee));
  });

  return employees.length;
}

function buildEmployeeFilters(filters = {}) {
  const where = [];
  const params = {};

  if (filters.keyword) {
    where.push('(employee_no LIKE @keyword OR name LIKE @keyword OR phone LIKE @keyword)');
    params.keyword = `%${filters.keyword}%`;
  }
  if (filters.base) {
    where.push('base = @base');
    params.base = filters.base;
  }
  if (filters.position) {
    where.push('position = @position');
    params.position = filters.position;
  }
  if (filters.status) {
    where.push('employee_status = @status');
    params.status = filters.status;
  }
  if (filters.channelName) {
    where.push('channel_name LIKE @channelName');
    params.channelName = `%${filters.channelName}%`;
  }
  if (filters.channelType) {
    where.push('channel_type = @channelType');
    params.channelType = filters.channelType;
  }
  if (filters.startDate) {
    where.push('training_date >= @startDate');
    params.startDate = filters.startDate;
  }
  if (filters.endDate) {
    where.push('training_date <= @endDate');
    params.endDate = filters.endDate;
  }
  if (filters.role === 'recruiter') {
    where.push("department LIKE '%人才开发部%'");
    where.push("position LIKE '%招聘%'");
  }
  if (filters.role === 'frontline') {
    where.push("position IN ('客服专员', '培训期学员')");
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

function countEmployees(filters = {}) {
  const database = getDatabase();
  const { whereSql, params } = buildEmployeeFilters(filters);
  return database.prepare(`SELECT COUNT(*) AS total FROM employees ${whereSql}`).get(params).total;
}

function listEmployees({ filters = {}, page }) {
  const database = getDatabase();
  const { whereSql, params } = buildEmployeeFilters(filters);
  const count = database.prepare(`SELECT COUNT(*) AS total FROM employees ${whereSql}`).get(params).total;
  const rows = database.prepare(`
    SELECT *
    FROM employees
    ${whereSql}
    ORDER BY training_date DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all({
    ...params,
    limit: page.limit,
    offset: page.offset
  });

  return {
    total: count,
    rows: rows.map(fromDatabaseRow)
  };
}

function listAllEmployees() {
  const database = getDatabase();
  return database.prepare('SELECT * FROM employees').all().map(fromDatabaseRow);
}

function formatBaseOptions(bases) {
  return bases
    .filter((base) => base && base !== '忽略' && !base.includes('伽睿集团'))
    .sort((left, right) => {
      const leftIndex = BASE_OPTION_ORDER.indexOf(left);
      const rightIndex = BASE_OPTION_ORDER.indexOf(right);

      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
          - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
      }

      return left.localeCompare(right, 'zh-Hans-CN');
    });
}

function getDistinctEmployeeFilterOptions(filters = {}) {
  const database = getDatabase();
  const { whereSql, params } = buildEmployeeFilters(filters);

  function pluck(sql, field) {
    return database.prepare(sql).all(params).map((row) => row[field]).filter(Boolean);
  }

  return {
    bases: formatBaseOptions(pluck(`SELECT DISTINCT base FROM employees ${whereSql} ORDER BY base`, 'base')),
    channelTypes: pluck(`SELECT DISTINCT channel_type FROM employees ${whereSql} ORDER BY channel_type`, 'channel_type')
  };
}

function isFrontlineRecord(row) {
  return isFrontlineEmployee(fromDatabaseRow(row));
}

module.exports = {
  replaceEmployeesBySource,
  buildEmployeeFilters,
  countEmployees,
  formatBaseOptions,
  listEmployees,
  listAllEmployees,
  getDistinctEmployeeFilterOptions,
  fromDatabaseRow,
  isFrontlineRecord
};
