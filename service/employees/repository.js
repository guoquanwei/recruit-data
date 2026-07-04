const { queryAll, queryOne } = require('../../dao/db');
const { bulkInsert } = require('../../dao/bulkInsert');
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

let allEmployeesCache;

function clearEmployeeCache() {
  allEmployeesCache = undefined;
}

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

function buildEmployeeFilters(filters = {}) {
  const where = [];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.keyword) {
    const keyword = addParam(`%${filters.keyword}%`);
    where.push(`(employee_no LIKE ${keyword} OR name LIKE ${keyword} OR phone LIKE ${keyword})`);
  }
  if (filters.base) {
    where.push(`base = ${addParam(filters.base)}`);
  }
  if (filters.position) {
    where.push(`position = ${addParam(filters.position)}`);
  }
  if (filters.status) {
    where.push(`employee_status = ${addParam(filters.status)}`);
  }
  if (filters.channelName) {
    where.push(`channel_name LIKE ${addParam(`%${filters.channelName}%`)}`);
  }
  if (filters.channelType) {
    where.push(`channel_type = ${addParam(filters.channelType)}`);
  }
  if (filters.startDate) {
    where.push(`training_date >= ${addParam(filters.startDate)}`);
  }
  if (filters.endDate) {
    where.push(`training_date <= ${addParam(filters.endDate)}`);
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

async function replaceEmployeesBySource(database, sourceType, employees) {
  await database.query('DELETE FROM employees WHERE source_type = $1', [sourceType]);
  clearEmployeeCache();

  return bulkInsert(database, {
    tableName: 'employees',
    columns: EMPLOYEE_COLUMNS,
    rows: employees,
    mapRow: (employee) => {
      const row = toDatabaseRow(employee);
      return EMPLOYEE_COLUMNS.map((column) => row[column]);
    }
  });
}

async function countEmployees(filters = {}) {
  const { whereSql, params } = buildEmployeeFilters(filters);
  const row = await queryOne(`SELECT COUNT(*)::int AS total FROM employees ${whereSql}`, params);
  return row.total;
}

async function listEmployees({ filters = {}, page }) {
  const { whereSql, params } = buildEmployeeFilters(filters);
  const count = await queryOne(`SELECT COUNT(*)::int AS total FROM employees ${whereSql}`, params);
  const rows = await queryAll(`
    SELECT *
    FROM employees
    ${whereSql}
    ORDER BY training_date DESC, id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, page.limit, page.offset]);

  return {
    total: count.total,
    rows: rows.map(fromDatabaseRow)
  };
}

async function listAllEmployees() {
  if (allEmployeesCache) {
    return allEmployeesCache;
  }
  allEmployeesCache = (await queryAll('SELECT * FROM employees')).map(fromDatabaseRow);
  return allEmployeesCache;
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

async function getDistinctEmployeeFilterOptions(filters = {}) {
  const { whereSql, params } = buildEmployeeFilters(filters);

  async function pluck(sql, field) {
    return (await queryAll(sql, params)).map((row) => row[field]).filter(Boolean);
  }

  return {
    bases: formatBaseOptions(await pluck(`SELECT DISTINCT base FROM employees ${whereSql} ORDER BY base`, 'base')),
    channelTypes: await pluck(`SELECT DISTINCT channel_type FROM employees ${whereSql} ORDER BY channel_type`, 'channel_type')
  };
}

function isFrontlineRecord(row) {
  return isFrontlineEmployee(fromDatabaseRow(row));
}

module.exports = {
  replaceEmployeesBySource,
  buildEmployeeFilters,
  clearEmployeeCache,
  countEmployees,
  formatBaseOptions,
  listEmployees,
  listAllEmployees,
  getDistinctEmployeeFilterOptions,
  fromDatabaseRow,
  isFrontlineRecord
};
