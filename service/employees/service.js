const { maskPhone, parsePage, toText } = require('../shared/format');
const { countEmployees, getDistinctEmployeeFilterOptions, listEmployees } = require('./repository');

function toEmployeeViewModel(employee) {
  return {
    ...employee,
    maskedPhone: maskPhone(employee.phone)
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

function getEmployeeList(query = {}, role) {
  const page = parsePage(query);
  const filters = buildEmployeeFilters(query, role);
  const result = listEmployees({ filters, page });
  const roleOnlyFilters = { role };
  const roleTotal = countEmployees(roleOnlyFilters);

  return {
    ...result,
    rows: result.rows.map(toEmployeeViewModel),
    page,
    filters,
    options: getDistinctEmployeeFilterOptions(roleOnlyFilters),
    hasFilters: hasEmployeeFilter(filters),
    emptyMessage: roleTotal === 0
      ? '暂无数据，请先导入员工表。'
      : '没有符合筛选条件的数据，请调整筛选项后重试。'
  };
}

module.exports = {
  getEmployeeList,
  toEmployeeViewModel
};
