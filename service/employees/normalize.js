const { normalizeDate } = require('../shared/date');
const { toText } = require('../shared/format');

const FRONTLINE_POSITIONS = new Set([
  '客服专员',
  '培训期学员'
]);

function inferBase({ department, officeLocation }) {
  const departmentText = toText(department);
  const officeText = toText(officeLocation);
  const source = `${departmentText} ${officeText}`;

  if (source.includes('联通河北') || source.includes('河北基地') || source.includes('石家庄')) {
    return '联通河北';
  }
  if (source.includes('联通天津') || source.includes('天津')) {
    return '联通天津';
  }
  if (source.includes('江苏') && source.includes('淮安')) {
    return '江苏基地-淮安';
  }
  if (source.includes('江苏') || source.includes('南京')) {
    return '江苏基地-南京';
  }
  if (source.includes('湖南') && source.includes('空港')) {
    return '湖南基地-空港';
  }
  if (source.includes('湖南') && source.includes('荷花')) {
    return '湖南基地-荷花';
  }
  if (source.includes('济阳')) {
    return '济南基地-济阳';
  }
  if (source.includes('夏都')) {
    return '济南基地-夏都';
  }
  if (source.includes('长春') && source.includes('外呼')) {
    return '吉林外呼项目';
  }
  if (source.includes('长春')) {
    return '长春热线项目';
  }
  if (source.includes('10015') || source.includes('15升投')) {
    return '10015升投';
  }

  return officeText || departmentText;
}

function normalizeEmployeeRow(row, sourceType) {
  const department = sourceType === 'resigned' ? row.离职前部门 : row.部门;
  const position = sourceType === 'resigned' ? row.离职前职位 : row.职位;
  const employeeStatus = sourceType === 'resigned' ? '离职' : toText(row.员工状态) || '在职';
  const officeLocation = row.办公地点;

  return {
    employeeNo: toText(row.工号),
    name: toText(row.姓名),
    sourceType,
    employeeStatus,
    base: inferBase({ department, officeLocation }),
    department: toText(department),
    position: toText(position),
    channelType: toText(row.招聘渠道),
    channelName: toText(row.渠道名称),
    officeLocation: toText(officeLocation),
    trainingDate: normalizeDate(row.入培时间),
    entryDate: normalizeDate(row.入职日期),
    resignedDate: normalizeDate(row.离职日期),
    phone: toText(row.手机号码),
    idCard: toText(row.证件号),
    handoverDate: normalizeDate(row.通关交接时间)
  };
}

function normalizeActiveEmployee(row) {
  return normalizeEmployeeRow(row, 'active');
}

function normalizeResignedEmployee(row) {
  return normalizeEmployeeRow(row, 'resigned');
}

function isFrontlineEmployee(employee) {
  return FRONTLINE_POSITIONS.has(toText(employee.position));
}

module.exports = {
  FRONTLINE_POSITIONS,
  inferBase,
  normalizeActiveEmployee,
  normalizeResignedEmployee,
  isFrontlineEmployee
};
