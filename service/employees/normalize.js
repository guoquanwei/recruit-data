const { normalizeDate } = require('../shared/date');
const { toText } = require('../shared/format');

const FRONTLINE_POSITIONS = new Set([
  '客服专员',
  '客服班长',
  '培训期学员'
]);

const STANDARD_BASES = new Set([
  '联通河北',
  '联通天津',
  '联通北京',
  '10015升投',
  '南二在线客服项目',
  '长春热线项目',
  '吉林外呼项目',
  '京东外呼项目',
  '辽宁外呼项目',
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
  'ITO项目',
  '人才开发部',
  '忽略'
]);

function inferBase({ department, officeLocation }) {
  const departmentText = toText(department);
  const officeText = toText(officeLocation);
  const source = `${departmentText} ${officeText}`;
  const departmentParts = departmentText
    .split(/\s+[-/]\s+|\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (departmentParts[2] === '人才开发部' || source.includes('人才开发部')) {
    return '人才开发部';
  }

  if (source.includes('韶关基地') || source.includes('SG01-韶关基地')) {
    return '南二在线客服项目';
  }
  if (source.includes('北京基地') || source.includes('BJ01-') || source.includes('BJ02-') || source.includes('BJ03-') || source.includes('BJ04-')) {
    return '忽略';
  }
  if (source.includes('济南实训基地') || source.includes('SD02-济南实训基地')) {
    return '济南基地-夏都';
  }
  if (source.includes('合肥基地') || source.includes('AH01-合肥基地')) {
    return '合肥基地';
  }
  if (source.includes('成都基地') || source.includes('CD01-成都基地')) {
    return '成都基地';
  }
  if (source.includes('宜宾基地') || source.includes('YB-宜宾基地')) {
    return '宜宾基地';
  }
  if (source.includes('京东外呼项目')) {
    return '京东外呼项目';
  }
  if (source.includes('辽宁外呼项目') || source.includes('辽宁外呼')) {
    return '辽宁外呼项目';
  }
  if (source.includes('贵阳') || source.includes('GZ01-贵阳德福中心')) {
    return 'ITO项目';
  }
  if (source.includes('成都中行') || source.includes('重庆中行') || source.includes('重庆外呼项目') || source.includes('ZH-成都中行') || source.includes('CQ-重庆中行') || source.includes('CQ-重庆外呼项目')) {
    return '新业务运营中心';
  }
  if (source.includes('10015') || source.includes('15升投')) {
    return '10015升投';
  }
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
  return officeText || departmentText;
}

function hasCurrentYearDate(...dates) {
  const currentYear = String(new Date().getFullYear());
  return dates.some((date) => toText(date).startsWith(`${currentYear}-`));
}

function normalizeInferredBase(base, dates) {
  const baseText = toText(base);
  if (baseText && !STANDARD_BASES.has(baseText) && hasCurrentYearDate(...dates)) {
    return 'ITO项目';
  }
  return baseText;
}

function normalizeEmployeeRow(row, sourceType) {
  const department = sourceType === 'resigned' ? row.离职前部门 : row.部门;
  const position = sourceType === 'resigned' ? row.离职前职位 : row.职位;
  const employeeStatus = sourceType === 'resigned' ? '离职' : toText(row.员工状态) || '在职';
  const officeLocation = row.办公地点;
  const entryDate = normalizeDate(row.入职日期);
  const trainingDate = normalizeDate(row.入培时间) || entryDate;
  const resignedDate = normalizeDate(row.离职日期);
  const base = inferBase({ department, officeLocation });

  return {
    employeeNo: toText(row.工号),
    name: toText(row.姓名),
    sourceType,
    employeeStatus,
    base: normalizeInferredBase(base, [trainingDate, entryDate, resignedDate]),
    department: toText(department),
    position: toText(position),
    channelType: toText(row.招聘渠道),
    channelName: toText(row.渠道名称),
    officeLocation: toText(officeLocation),
    trainingDate,
    entryDate,
    resignedDate,
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

function isRecruiterEmployee(employee) {
  return toText(employee.department).includes('人才开发部')
    && toText(employee.position).includes('招聘');
}

module.exports = {
  FRONTLINE_POSITIONS,
  inferBase,
  normalizeActiveEmployee,
  normalizeResignedEmployee,
  isFrontlineEmployee,
  isRecruiterEmployee
};