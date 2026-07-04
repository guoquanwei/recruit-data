const { maskPhone, parsePage, toText } = require('../shared/format');
const { normalizeDate } = require('../shared/date');
const {
  countEmployees,
  getDistinctEmployeeFilterOptions,
  listEmployees,
  countOrgTableFrontlineEmployees,
  listOrgTableFrontlineEmployees,
  getOrgTableDistinctFilterOptions,
  countOrgTableRecruiters,
  listOrgTableRecruiters,
  getOrgTableRecruiterFilterOptions
} = require('./repository');

function toEmployeeViewModel(employee) {
  return {
    ...employee,
    maskedPhone: maskPhone(employee.phone),
    trainingDate: normalizeDate(employee.trainingDate),
    entryDate: normalizeDate(employee.entryDate),
    resignedDate: normalizeDate(employee.resignedDate),
    handoverDate: normalizeDate(employee.handoverDate)
  };
}

function buildEmployeeFilters(query = {}, role) {
  return {
    role,
    keyword: toText(query.keyword),
    base: toText(query.base),
    position: toText(query.position),
    status: toText(query.status),
    channelName: toText(query.channelName),
    channelType: toText(query.channelType),
    startDate: toText(query.startDate),
    endDate: toText(query.endDate)
  };
}

function hasEmployeeFilter(filters) {
  return Boolean(
    filters.keyword
      || filters.base
      || filters.position
      || filters.status
      || filters.channelName
      || filters.channelType
      || filters.startDate
      || filters.endDate
  );
}

async function getEmployeeList(query = {}, role) {
  const page = parsePage(query);
  const filters = buildEmployeeFilters(query, role);

  let result;
  let roleTotal;
  let options;

  if (role === 'frontline') {
    result = await listOrgTableFrontlineEmployees({ filters, page });
    roleTotal = await countOrgTableFrontlineEmployees({});
    options = await getOrgTableDistinctFilterOptions({});
  } else if (role === 'recruiter') {
    result = await listOrgTableRecruiters({ filters, page });
    roleTotal = await countOrgTableRecruiters({});
    options = await getOrgTableRecruiterFilterOptions({});
  } else {
    result = await listEmployees({ filters, page });
    const roleOnlyFilters = { role };
    roleTotal = await countEmployees(roleOnlyFilters);
    options = await getDistinctEmployeeFilterOptions(roleOnlyFilters);
  }

  return {
    ...result,
    rows: result.rows.map(toEmployeeViewModel),
    page,
    filters,
    options,
    hasFilters: hasEmployeeFilter(filters),
    emptyMessage: roleTotal === 0
      ? '暂无数据，请先导入员工表。'
      : '没有符合筛选条件的数据，请调整筛选项后重试。'
  };
}

async function getEmployeeExportRows(query = {}, role) {
  const filters = buildEmployeeFilters(query, role);
  let result;

  if (role === 'frontline') {
    result = await listOrgTableFrontlineEmployees({
      filters,
      page: {
        limit: 1_000_000,
        offset: 0
      }
    });
  } else if (role === 'recruiter') {
    result = await listOrgTableRecruiters({
      filters,
      page: {
        limit: 1_000_000,
        offset: 0
      }
    });
  } else {
    result = await listEmployees({
      filters,
      page: {
        limit: 1_000_000,
        offset: 0
      }
    });
  }

  return result.rows.map(toEmployeeViewModel);
}

module.exports = {
  getEmployeeList,
  getEmployeeExportRows,
  toEmployeeViewModel
};