const { listAllEmployees, listAllOrgTableFrontlineEmployees, listAllOrgTableRecruiters } = require('../employees/repository');
const { listAllInterviewRecords } = require('../interviews/repository');
const { formatDate, getMonthLastDay, normalizeDate } = require('../shared/date');
const { formatPercent, maskPhone, toText } = require('../shared/format');
const { getTargetProgress } = require('../targets/service');
const { getDistinctTargetFilterOptions, listTargetsByMonth } = require('../targets/repository');
const { execute } = require('../../dao/db');

const PASSED_INTERVIEW_RESULTS = new Set(['推荐', '强烈推荐']);
const EXPECTED_INTERVIEW_PASS_RATE = 0.6;
const EXPECTED_ENTRY_RATE = 2 / 3;
const INVITE_ARRIVE_RATE = 0.8;
const CHANNEL_DISPLAY_ORDER = ['回流', '内推', '渠道社招', '渠道校招', '自主社招'];
const EXCLUDED_FUNNEL_DIAGNOSIS_CHANNELS = new Set(['回流', '渠道校招']);
const OVERVIEW_TABS = new Set(['overview', 'base', 'channel', 'self']);
const SEVEN_DAY_RETENTION_OFFSET_DAYS = 6;
const SELF_SOURCING_STAGE_TARGETS = {
  formal: {
    monthlyTrainingTarget: 20,
    sevenDayTrainingTarget: 12
  },
  probation: {
    monthlyTrainingTarget: 12,
    sevenDayTrainingTarget: 8
  }
};
const SELF_SOURCING_ATTRITION_RISK_THRESHOLD = 0.2;

function calculateWorkDaysInMonth(employee, yearMonth) {
  const entryDateStr = normalizeDate(employee.entryDate) || '';
  if (!entryDateStr || !entryDateStr.startsWith(yearMonth)) {
    return 0;
  }

  return 1;
}

function normalizeOverviewTab(tab) {
  const normalizedTab = toText(tab);
  return OVERVIEW_TABS.has(normalizedTab) ? normalizedTab : 'overview';
}

function getTrainingDetails(query = {}, preloadedEmployees) {
  const yearMonth = toText(query.yearMonth);
  const cutoffDate = normalizeDate(query.cutoffDate);
  const baseFilter = toText(query.base);
  const channelFilter = toText(query.channel);
  return (preloadedEmployees || [])
    .filter((employee) => {
      const trainingDateStr = normalizeDate(employee.trainingDate) || '';
      return !yearMonth || trainingDateStr.startsWith(yearMonth);
    })
    .filter((employee) => !cutoffDate || normalizeDate(employee.trainingDate) <= cutoffDate)
    .filter((employee) => !baseFilter || toText(employee.base) === baseFilter)
    .filter((employee) => !channelFilter || toText(employee.channelType) === channelFilter)
    .map((employee) => ({
      base: employee.base,
      employeeNo: employee.employeeNo,
      name: employee.name,
      maskedPhone: maskPhone(employee.phone),
      channelType: employee.channelType,
      channelName: employee.channelName,
      trainingDate: normalizeDate(employee.trainingDate),
      employeeStatus: employee.employeeStatus,
      resignedDate: normalizeDate(employee.resignedDate),
      workDaysInMonth: calculateWorkDaysInMonth(employee, yearMonth)
    }));
}

function getSelfSourcingRecruiterName(item) {
  return toText(item.channelName).split('+')[0].trim();
}

function filterSelfSourcingTrainingDetails(details = [], filters = {}) {
  const recruiter = toText(filters.recruiter);
  return details.filter((item) => {
    if (item.channelType !== '自主社招') {
      return false;
    }
    if (!recruiter) {
      return true;
    }
    return getSelfSourcingRecruiterName(item) === recruiter;
  });
}

function buildSelfSourcingRecruiterOptions(details = []) {
  return Array.from(new Set(
    details
      .filter((item) => item.channelType === '自主社招')
      .map(getSelfSourcingRecruiterName)
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

function parseDateValue(value) {
  const normalized = normalizeDate(value);
  if (!normalized) {
    return undefined;
  }
  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function addMonths(date, months) {
  const result = new Date(date.getTime());
  const originalDay = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== originalDay) {
    result.setDate(0);
  }
  return result;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function getMonthRange(yearMonth) {
  return {
    monthStart: `${yearMonth}-01`,
    monthEnd: buildDate(yearMonth, getMonthLastDay(yearMonth))
  };
}

function getRecruiterBaseDate(recruiter) {
  return normalizeDate(recruiter.trainingDate) || normalizeDate(recruiter.entryDate);
}

function isRecruiterActiveInMonth(recruiter, yearMonth) {
  const { monthStart, monthEnd } = getMonthRange(yearMonth);
  const startDate = normalizeDate(recruiter.entryDate) || normalizeDate(recruiter.trainingDate);
  const resignedDate = normalizeDate(recruiter.resignedDate);

  if (!startDate) {
    return false;
  }

  return startDate <= monthEnd && (!resignedDate || resignedDate >= monthStart);
}

function isRecruiterInYear(recruiter, year) {
  const startDate = normalizeDate(recruiter.entryDate) || normalizeDate(recruiter.trainingDate);
  const resignedDate = normalizeDate(recruiter.resignedDate);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  if (!startDate) {
    return false;
  }

  return startDate <= yearEnd && (!resignedDate || resignedDate >= yearStart);
}

function getRecruiterDisplayStatus(recruiter, asOfDate) {
  const resignedDate = normalizeDate(recruiter.resignedDate);
  const currentDate = normalizeDate(asOfDate);
  return resignedDate && (!currentDate || resignedDate <= currentDate) ? '离职' : '在职';
}

function getRecruiterStage(recruiter, asOfDate) {
  const baseDate = parseDateValue(getRecruiterBaseDate(recruiter));
  const currentDate = parseDateValue(asOfDate) || new Date();
  if (!baseDate) {
    return 'probation';
  }

  return addMonths(baseDate, 6) <= currentDate ? 'formal' : 'probation';
}

function isSevenDayMatured(employee, asOfDate) {
  const trainingDate = parseDateValue(employee.trainingDate);
  const currentDate = parseDateValue(asOfDate) || new Date();
  if (!trainingDate) {
    return false;
  }

  return addDays(trainingDate, SEVEN_DAY_RETENTION_OFFSET_DAYS) <= currentDate;
}

function getSevenDayDate(employee) {
  const trainingDate = parseDateValue(employee.trainingDate);
  return trainingDate ? formatDate(addDays(trainingDate, SEVEN_DAY_RETENTION_OFFSET_DAYS)) : '';
}

function isSevenDayRetained(employee, asOfDate) {
  const trainingDate = parseDateValue(employee.trainingDate);
  const currentDate = parseDateValue(asOfDate) || new Date();
  if (!trainingDate) {
    return false;
  }
  const sevenDayDate = addDays(trainingDate, SEVEN_DAY_RETENTION_OFFSET_DAYS);
  const resignedDate = parseDateValue(employee.resignedDate);

  return sevenDayDate <= currentDate && (!resignedDate || resignedDate > sevenDayDate);
}

function getWorkDays(employee, asOfDate) {
  const trainingDate = parseDateValue(employee.trainingDate);
  const endDate = parseDateValue(employee.resignedDate) || parseDateValue(asOfDate) || new Date();
  if (!trainingDate || endDate < trainingDate) {
    return 0;
  }
  return Math.floor((endDate - trainingDate) / (24 * 60 * 60 * 1000)) + 1;
}

function toSelfSourcingCandidateDetail(employee, asOfDate) {
  return {
    status: employee.employeeStatus || '',
    employeeNo: employee.employeeNo || '',
    name: employee.name || '',
    channelType: employee.channelType || '',
    channelName: employee.channelName || '',
    trainingDate: normalizeDate(employee.trainingDate),
    employeeStatus: employee.employeeStatus || '',
    resignedDate: normalizeDate(employee.resignedDate),
    workDays: getWorkDays(employee, asOfDate)
  };
}

function buildYearMonthsThrough(yearMonth) {
  const normalizedYearMonth = toText(yearMonth);
  const year = Number(normalizedYearMonth.slice(0, 4));
  const month = Number(normalizedYearMonth.slice(5, 7));
  if (!year || !month) {
    return [];
  }

  return Array.from({ length: month }, (_, index) => {
    const monthNumber = index + 1;
    return {
      yearMonth: `${year}-${String(monthNumber).padStart(2, '0')}`,
      label: `${monthNumber}月`
    };
  });
}

function calculateMonthlyCutoffTarget(target, yearMonth, asOfDate) {
  const normalizedYearMonth = toText(yearMonth);
  const normalizedAsOfDate = normalizeDate(asOfDate);
  if (!target || !normalizedYearMonth || !normalizedAsOfDate) {
    return target || 0;
  }
  const asOfYearMonth = normalizedAsOfDate.slice(0, 7);
  if (asOfYearMonth < normalizedYearMonth) {
    return 0;
  }
  if (asOfYearMonth > normalizedYearMonth) {
    return target;
  }

  const day = Number(normalizedAsOfDate.slice(8, 10));
  const lastDay = getMonthLastDay(normalizedYearMonth);
  return Math.ceil(target * Math.min(day, lastDay) / lastDay);
}

function calculateRateText(actual, target) {
  return target > 0 ? formatPercent(actual / target) : '0.00%';
}

function calculateSelfSourcingAttritionRate(details = [], asOfDate) {
  if (!details.length) {
    return 0;
  }
  const currentDate = normalizeDate(asOfDate);
  const resignedCount = details.filter((employee) => {
    const resignedDate = normalizeDate(employee.resignedDate);
    return resignedDate && (!currentDate || resignedDate <= currentDate);
  }).length;
  return resignedCount / details.length;
}

function hasThreeMonthLowSevenDayEfficiency(monthRows = []) {
  const latestThreeMonths = monthRows.slice(-3);
  return latestThreeMonths.length === 3
    && latestThreeMonths.every((month) => (
      month.actualAchievement > 0
      && month.sevenDayRetainedCount < month.sevenDayTarget
    ));
}

function buildRecruiterDiagnosis({ monthlyGap, sevenDayRetainedCount, sevenDayCutoffTarget, monthRows, selectedMonthDetails, currentDate }) {
  const attritionRate = calculateSelfSourcingAttritionRate(selectedMonthDetails, currentDate);
  const hasThreeMonthLowSevenDay = hasThreeMonthLowSevenDayEfficiency(monthRows);
  const hasHighAttrition = attritionRate >= SELF_SOURCING_ATTRITION_RISK_THRESHOLD;
  const sevenDayRate = sevenDayCutoffTarget > 0 ? sevenDayRetainedCount / sevenDayCutoffTarget : 0;
  const reasons = [];

  if (sevenDayRate < 1) {
    reasons.push(`7天达成率${formatPercent(sevenDayRate)}，低于截止目标`);
  }
  if (monthlyGap < 0) {
    reasons.push(`当月参培 GAP ${monthlyGap}`);
  }
  if (hasThreeMonthLowSevenDay) {
    reasons.push('连续3个月7天人效低于目标');
  }
  if (hasHighAttrition) {
    reasons.push(`流失偏高${Math.round(attritionRate * 100)}%`);
  }

  const riskStatus = sevenDayRate < 0.6
    ? '高风险'
    : (sevenDayRate >= 0.8
      ? '正常达标'
      : '需关注');

  return {
    riskStatus,
    riskReason: reasons.length ? reasons.join('；') : '当月达成和7天留存均无明显异常',
    diagnosis: {
      hasThreeMonthLowSevenDayEfficiency: hasThreeMonthLowSevenDay,
      hasHighAttrition,
      sevenDayRate,
      sevenDayRateText: formatPercent(sevenDayRate),
      attritionRate,
      attritionRateText: formatPercent(attritionRate)
    }
  };
}

function buildRecruiterFunnelDiagnosis({
  recruiterName,
  yearMonth,
  interviews = [],
  selectedMonthDetails = [],
  selectedSevenDayCount = 0,
  monthlyCutoffTarget = 0,
  monthlyGap = 0,
  sevenDayCutoffTarget = 0,
  sevenDayGap = 0,
  diagnosis = {}
}) {
  const recruiterInterviews = interviews.filter((interview) => (
    (!yearMonth || toText(interview.feedbackDate).startsWith(yearMonth))
    && toText(interview.channelType) === '自主社招'
    && getSelfSourcingRecruiterName(interview) === recruiterName
  ));
  const interviewCount = recruiterInterviews.length;
  const passedCount = recruiterInterviews.filter((interview) => PASSED_INTERVIEW_RESULTS.has(interview.feedbackResult)).length;
  const trainingCount = selectedMonthDetails.length;
  const passRate = interviewCount > 0 ? passedCount / interviewCount : 0;
  const trainingRate = passedCount > 0 ? trainingCount / passedCount : 0;
  const sevenDayRate = sevenDayCutoffTarget > 0 ? selectedSevenDayCount / sevenDayCutoffTarget : 0;
  const monthlyRate = monthlyCutoffTarget > 0 ? trainingCount / monthlyCutoffTarget : 0;
  const diagnosisPath = [];

  if (monthlyGap < 0) {
    diagnosisPath.push({
      stage: '参培达成',
      current: `${trainingCount} 人 / 目标 ${monthlyCutoffTarget} 人 / ${formatPercent(monthlyRate)}`,
      diagnosis: `参培未达标，当前 GAP ${monthlyGap}`,
      suggestion: '提升参培率：复盘面通后未参培原因，强化 offer 后跟进、入培提醒和候选人备份，优先补足高意向候选人。'
    });
  }

  if (sevenDayGap < 0) {
    diagnosisPath.push({
      stage: '7天留存',
      current: `${selectedSevenDayCount} 人 / 目标 ${sevenDayCutoffTarget} 人 / ${formatPercent(sevenDayRate)}`,
      diagnosis: `7天人效未达标，当前 GAP ${sevenDayGap}`,
      suggestion: '提升留存率：跟踪 7 天内离职原因，前置岗位预期管理，优化候选人画像、入培前筛选和入职首周关怀。'
    });
  }

  if (diagnosis.hasThreeMonthLowSevenDayEfficiency) {
    diagnosisPath.push({
      stage: '连续人效',
      current: '最近3个月均低于7天目标',
      diagnosis: '连续3个月7天人效低于目标，说明短期波动已变成持续风险',
      suggestion: '按月复盘来源渠道、候选人质量和入职首周流失原因，建立连续追踪清单，优先修复影响留存的共性问题。'
    });
  }

  if (diagnosis.hasHighAttrition) {
    diagnosisPath.push({
      stage: '流失风险',
      current: diagnosis.attritionRateText || '0.00%',
      diagnosis: `当月流失偏高，流失率 ${diagnosis.attritionRateText || '0.00%'}`,
      suggestion: '拆解离职原因，区分岗位预期、薪酬认知、管理承接和候选人稳定性问题，回写到邀约与筛选标准。'
    });
  }

  if (diagnosisPath.length === 0) {
    diagnosisPath.push({
      stage: '达成健康',
      current: `参培 ${trainingCount} 人 / 7天 ${selectedSevenDayCount} 人`,
      diagnosis: '当前参培和7天留存均无明显异常',
      suggestion: '保持现有招聘节奏，继续沉淀有效渠道、候选人画像和入培承接动作。'
    });
  }

  return {
    interviewCount,
    passedCount,
    trainingCount,
    passRateText: formatPercent(passRate),
    trainingRateText: formatPercent(trainingRate),
    sevenDayRateText: formatPercent(sevenDayRate),
    diagnosisPath
  };
}

function isTalentRecruiter(employee) {
  if (employee.sourceType === 'org_table') {
    return employee.base === '人才开发部'
      && ['招聘专员', '初级招聘主管'].includes(employee.position);
  }
  return employee.position === '招聘专员'
    && toText(employee.department).includes('人才开发部');
}

function buildSelfSourcingEfficiency({ yearMonth, asOfDate, employees = [], filters = {} }) {
  const normalizedYearMonth = toText(yearMonth);
  const recruiterFilter = toText(filters.recruiter);
  const currentDate = normalizeDate(asOfDate) || (normalizedYearMonth ? buildDate(normalizedYearMonth, getMonthLastDay(normalizedYearMonth)) : formatDate(new Date()));
  const recruiters = getSelfSourcingRecruitersForMonth(employees, normalizedYearMonth)
    .filter((recruiter) => !recruiterFilter || recruiter.name === recruiterFilter);
  const recruiterByName = new Map(recruiters.map((recruiter) => [recruiter.name, recruiter]));
  const selfSourcingEmployees = employees.filter((employee) => {
    const trainingDateStr = normalizeDate(employee.trainingDate) || '';
    return employee.channelType === '自主社招'
      && (!normalizedYearMonth || trainingDateStr.startsWith(normalizedYearMonth))
      && (!currentDate || trainingDateStr <= currentDate)
      && (!recruiterFilter || getSelfSourcingRecruiterName(employee) === recruiterFilter);
  });
  const summary = {
    probation: { stage: '试用期', recruiterCount: 0, trainingCount: 0, sevenDayCount: 0 },
    formal: { stage: '正式期', recruiterCount: 0, trainingCount: 0, sevenDayCount: 0 },
    overall: { stage: '整体', recruiterCount: recruiters.length, trainingCount: selfSourcingEmployees.length, sevenDayCount: 0 }
  };

  recruiters.forEach((recruiter) => {
    const stage = getRecruiterStage(recruiter, currentDate);
    summary[stage].recruiterCount += 1;
  });

  selfSourcingEmployees.forEach((employee) => {
    const recruiterName = toText(employee.channelName).split('+')[0];
    const recruiter = recruiterByName.get(recruiterName);
    const sevenDayMatured = isSevenDayRetained(employee, currentDate);
    if (recruiter) {
      const stage = getRecruiterStage(recruiter, currentDate);
      summary[stage].trainingCount += 1;
      if (sevenDayMatured) {
        summary[stage].sevenDayCount += 1;
      }
    }
    if (sevenDayMatured) {
      summary.overall.sevenDayCount += 1;
    }
  });

  const rows = [summary.overall, summary.probation, summary.formal].map((item) => ({
    ...item,
    efficiency: item.recruiterCount > 0 ? (item.trainingCount / item.recruiterCount).toFixed(1) : '0.0',
    sevenDayEfficiency: item.recruiterCount > 0 ? (item.sevenDayCount / item.recruiterCount).toFixed(1) : '0.0'
  }));
  rows.scales = rows.map((item) => ({
    stage: item.stage,
    recruiterCount: item.recruiterCount
  }));
  return rows;
}

function getSelfSourcingRecruitersForYear(employees = [], yearMonth = '') {
  const normalizedYearMonth = toText(yearMonth);
  const year = Number(normalizedYearMonth.slice(0, 4));
  return employees
    .filter((employee) => isTalentRecruiter(employee))
    .filter((employee) => !year || isRecruiterInYear(employee, year));
}

function getSelfSourcingRecruitersForMonth(employees = [], yearMonth = '') {
  const normalizedYearMonth = toText(yearMonth);
  return getSelfSourcingRecruitersForYear(employees, normalizedYearMonth)
    .filter((recruiter) => !normalizedYearMonth || isRecruiterActiveInMonth(recruiter, normalizedYearMonth));
}

function buildSelfSourcingRecruiterRows({ yearMonth, asOfDate, employees = [], interviews = [], filters = {} }) {
  const normalizedYearMonth = toText(yearMonth);
  const recruiterFilter = toText(filters.recruiter);
  const currentDate = normalizeDate(asOfDate) || (normalizedYearMonth ? buildDate(normalizedYearMonth, getMonthLastDay(normalizedYearMonth)) : formatDate(new Date()));
  const months = buildYearMonthsThrough(normalizedYearMonth);
  const selectedMonth = months[months.length - 1]?.yearMonth || normalizedYearMonth;
  const recruiters = getSelfSourcingRecruitersForMonth(employees, selectedMonth)
    .filter((recruiter) => !recruiterFilter || recruiter.name === recruiterFilter);
  const selfSourcingEmployees = employees.filter((employee) => {
    const trainingDateStr = normalizeDate(employee.trainingDate) || '';
    return employee.channelType === '自主社招'
      && months.some((month) => trainingDateStr.startsWith(month.yearMonth))
      && (!recruiterFilter || getSelfSourcingRecruiterName(employee) === recruiterFilter);
  });
  const recruiterMap = new Map(recruiters.map((recruiter) => [recruiter.name, recruiter]));
  const employeeMap = new Map();

  selfSourcingEmployees.forEach((employee) => {
    const recruiterName = getSelfSourcingRecruiterName(employee);
    if (!recruiterName) {
      return;
    }
    if (!employeeMap.has(recruiterName)) {
      employeeMap.set(recruiterName, []);
    }
    employeeMap.get(recruiterName).push(employee);
  });

  const recruiterNames = Array.from(recruiterMap.keys())
    .sort((left, right) => {
      const leftRecruiter = recruiterMap.get(left);
      const rightRecruiter = recruiterMap.get(right);
      const leftStatus = getRecruiterDisplayStatus(leftRecruiter, currentDate);
      const rightStatus = getRecruiterDisplayStatus(rightRecruiter, currentDate);
      const statusWeight = { 在职: 0, 离职: 1 };
      const statusDiff = (statusWeight[leftStatus] ?? 9) - (statusWeight[rightStatus] ?? 9);
      if (statusDiff !== 0) {
        return statusDiff;
      }
      return left.localeCompare(right, 'zh-Hans-CN');
    });

  return recruiterNames.map((name) => {
    const recruiter = recruiterMap.get(name) || {};
    const details = employeeMap.get(name) || [];
    const status = recruiter.name ? getRecruiterDisplayStatus(recruiter, currentDate) : '未匹配';
    const stage = recruiter.name ? getRecruiterStage(recruiter, currentDate) : 'probation';
    const targets = SELF_SOURCING_STAGE_TARGETS[stage];
    const monthRows = months.map((month) => {
      const monthEnd = buildDate(month.yearMonth, getMonthLastDay(month.yearMonth));
      const monthAsOfDate = month.yearMonth === selectedMonth ? currentDate : monthEnd;
      const monthStage = recruiter.name ? getRecruiterStage(recruiter, monthAsOfDate) : stage;
      const monthTargets = SELF_SOURCING_STAGE_TARGETS[monthStage];
      const sevenDayTarget = calculateMonthlyCutoffTarget(monthTargets.sevenDayTrainingTarget, month.yearMonth, monthAsOfDate);
      const monthlyDetails = details.filter((employee) => {
        const trainingDateStr = normalizeDate(employee.trainingDate) || '';
        return trainingDateStr.startsWith(month.yearMonth)
          && trainingDateStr <= monthAsOfDate;
      });
      const sevenDayRetainedDetails = details.filter((employee) => {
        const sevenDayDate = getSevenDayDate(employee);
        return sevenDayDate.startsWith(month.yearMonth)
          && sevenDayDate <= monthAsOfDate
          && isSevenDayRetained(employee, monthAsOfDate);
      });
      return {
        ...month,
        monthlyTarget: monthTargets.monthlyTrainingTarget,
        sevenDayTarget,
        actualAchievement: monthlyDetails.length,
        sevenDayRetainedCount: sevenDayRetainedDetails.length,
        sevenDayGap: sevenDayRetainedDetails.length - sevenDayTarget,
        sevenDayRateText: calculateRateText(sevenDayRetainedDetails.length, sevenDayTarget),
        sevenDayRetainedDetails: sevenDayRetainedDetails.map((employee) => toSelfSourcingCandidateDetail(employee, monthAsOfDate))
      };
    });
    const recruiterEntryYearMonth = (normalizeDate(recruiter.entryDate) || normalizeDate(recruiter.trainingDate) || '').slice(0, 7);
    const selectedYear = selectedMonth.slice(0, 4);
    const chartStartYearMonth = recruiterEntryYearMonth.startsWith(`${selectedYear}-`)
      ? recruiterEntryYearMonth
      : months[0]?.yearMonth;
    const efficiencyChartMonths = monthRows.filter((month) => !chartStartYearMonth || month.yearMonth >= chartStartYearMonth);
    const cumulativeDetails = details.filter((employee) => {
      const sevenDayDate = getSevenDayDate(employee);
      return sevenDayDate
        && (!chartStartYearMonth || sevenDayDate.slice(0, 7) >= chartStartYearMonth)
        && sevenDayDate <= currentDate;
    });
    const cumulativeSevenDayDetails = cumulativeDetails
      .filter((employee) => isSevenDayRetained(employee, currentDate))
      .map((employee) => toSelfSourcingCandidateDetail(employee, currentDate));
    const selectedMonthDetails = details.filter((employee) => {
      const trainingDateStr = normalizeDate(employee.trainingDate) || '';
      return trainingDateStr.startsWith(selectedMonth)
        && trainingDateStr <= currentDate;
    });
    const selectedSevenDayDetails = details.filter((employee) => {
      const sevenDayDate = getSevenDayDate(employee);
      return sevenDayDate.startsWith(selectedMonth)
        && sevenDayDate <= currentDate
        && isSevenDayRetained(employee, currentDate);
    });
    const selectedSevenDayCount = selectedSevenDayDetails.length;
    const cumulativeSevenDayCount = cumulativeSevenDayDetails.length;
    const monthlyCutoffTarget = calculateMonthlyCutoffTarget(targets.monthlyTrainingTarget, selectedMonth, currentDate);
    const sevenDayCutoffTarget = calculateMonthlyCutoffTarget(targets.sevenDayTrainingTarget, selectedMonth, currentDate);
    const monthlyGap = selectedMonthDetails.length - monthlyCutoffTarget;
    const sevenDayGap = selectedSevenDayCount - sevenDayCutoffTarget;
    const diagnosis = buildRecruiterDiagnosis({
      monthlyGap,
      sevenDayRetainedCount: selectedSevenDayCount,
      sevenDayCutoffTarget,
      monthRows: efficiencyChartMonths,
      selectedMonthDetails,
      currentDate
    });
    const recruitmentFunnel = buildRecruiterFunnelDiagnosis({
      recruiterName: name,
      yearMonth: selectedMonth,
      interviews,
      selectedMonthDetails,
      selectedSevenDayCount,
      monthlyCutoffTarget,
      monthlyGap,
      sevenDayCutoffTarget,
      sevenDayGap,
      diagnosis: diagnosis.diagnosis
    });

    return {
      name,
      employeeNo: recruiter.employeeNo || '',
      entryDate: normalizeDate(recruiter.entryDate) || normalizeDate(recruiter.trainingDate) || '',
      employeeStatus: recruiter.name ? status : '未匹配',
      stage,
      monthlyTrainingTarget: targets.monthlyTrainingTarget,
      monthlyCutoffTarget,
      actualAchievement: selectedMonthDetails.length,
      monthlyGap,
      monthlyAchievementRateText: calculateRateText(selectedMonthDetails.length, monthlyCutoffTarget),
      actualDetails: selectedMonthDetails.map((employee) => toSelfSourcingCandidateDetail(employee, currentDate)),
      sevenDayTrainingTarget: targets.sevenDayTrainingTarget,
      sevenDayCutoffTarget,
      sevenDayRetainedCount: selectedSevenDayCount,
      sevenDayGap,
      sevenDayAchievementRateText: calculateRateText(selectedSevenDayCount, sevenDayCutoffTarget),
      sevenDayRetainedDetails: selectedSevenDayDetails.map((employee) => toSelfSourcingCandidateDetail(employee, currentDate)),
      cutoffMonthlyAverageSevenDayEfficiency: (cumulativeSevenDayCount / (efficiencyChartMonths.length || 1)).toFixed(1),
      cumulativeSevenDayEfficiency: cumulativeSevenDayCount.toFixed(1),
      cumulativeSevenDayDetails,
      ...diagnosis,
      recruitmentFunnel,
      efficiencyChartMonths,
      months: monthRows
    };
  });
}

async function saveRecruiterMonthlyScales(yearMonth, scales = []) {
  if (!yearMonth) {
    return;
  }

  for (const scale of scales) {
    await execute(`
    INSERT INTO recruiter_monthly_scales (year_month, stage, recruiter_count, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT(year_month, stage) DO UPDATE SET
        recruiter_count = EXCLUDED.recruiter_count,
      updated_at = CURRENT_TIMESTAMP
    `, [yearMonth, scale.stage, scale.recruiterCount]);
  }
}

async function getSelfSourcingEfficiency(query = {}, preloadedEmployees) {
  const yearMonth = toText(query.yearMonth);
  const employees = preloadedEmployees || await listAllEmployees();
  const rows = buildSelfSourcingEfficiency({
    yearMonth,
    asOfDate: query.cutoffDate,
    employees,
    filters: {
      recruiter: query.recruiter
    }
  });
  await saveRecruiterMonthlyScales(yearMonth, rows.scales);
  return rows;
}

function getCellStatus(achievementRate, hasData = true) {
  if (!hasData) {
    return 'empty';
  }
  if (achievementRate >= 1) {
    return 'achieved';
  }
  if (achievementRate >= 0.7) {
    return 'warning';
  }
  return 'risk';
}

function getStatusText(status) {
  const textMap = {
    achieved: '达成',
    warning: '预警',
    risk: '风险',
    empty: '无数据',
    notStarted: '未开始',
    inProgress: '进行中',
    missed: '未达标'
  };

  return textMap[status] || status;
}

function getCutoffTargetStatus({ cutoffTarget = 0, actualTraining = 0, monthlyTarget = 0 }) {
  const hasData = Number(cutoffTarget) > 0 || Number(monthlyTarget) > 0 || Number(actualTraining) > 0;
  if (!hasData) {
    return 'empty';
  }
  return Number(actualTraining) < Number(cutoffTarget) ? 'risk' : 'achieved';
}

function formatDashboardRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0.0%';
  }
  return `${(number * 100).toFixed(1)}%`;
}

function buildDashboardMatrix(progress, filters = {}) {
  const baseFilter = toText(filters.base);
  const channelFilter = toText(filters.channel);
  const bases = progress.bases
    .filter((base) => !baseFilter || base.base === baseFilter)
    .filter((base) => base.channelRows.some((row) => row.channel !== '合计' && (!channelFilter || row.channel === channelFilter)));
  const channels = progress.channels
    .filter((channel) => channel.monthlyTarget > 0 || channel.actualTraining > 0)
    .map((channel) => channel.channel)
    .filter((channel) => !channelFilter || channel === channelFilter);
  const rows = bases.map((base) => {
    const cells = {};

    channels.forEach((channel) => {
      const row = base.channelRows.find((item) => item.channel === channel) || {
        channel,
        monthlyTarget: 0,
        cutoffTarget: 0,
        actualTraining: 0,
        gap: 0,
        achievementRate: 0,
        achievementRateText: '0.00%',
        targetShareText: '0.00%',
        actualShareText: '0.00%',
        shareGapText: '0.00%'
      };
      const hasData = row.monthlyTarget > 0 || row.actualTraining > 0;

      cells[channel] = {
        ...row,
        status: getCellStatus(row.achievementRate, hasData),
        statusText: getStatusText(getCellStatus(row.achievementRate, hasData))
      };
    });

    return {
      base: base.base,
      cells
    };
  });

  return {
    channels,
    rows
  };
}

function buildDate(yearMonth, day) {
  return `${yearMonth}-${String(day).padStart(2, '0')}`;
}

function isBetween(dateValue, startDate, endDate) {
  const date = normalizeDate(dateValue);
  return date >= startDate && date <= endDate;
}

function sumDailyTargetsByDay(targets) {
  const dailyTargets = new Map();

  targets.forEach((target) => {
    Object.entries(target.dailyTargets || {}).forEach(([day, value]) => {
      const targetValue = Number(value || 0);
      if (targetValue <= 0) {
        return;
      }
      const dayNumber = Number(day);
      dailyTargets.set(dayNumber, (dailyTargets.get(dayNumber) || 0) + targetValue);
    });
  });

  return Array.from(dailyTargets.entries())
    .map(([day, target]) => ({ day, target }))
    .sort((left, right) => left.day - right.day);
}

function countTrainingInWindow(employees, { base, channel, startDate, endDate }) {
  const seen = new Set();

  employees.forEach((employee) => {
    if (toText(employee.base) !== base || toText(employee.channelType) !== channel) {
      return;
    }
    if (!isBetween(employee.trainingDate, startDate, endDate)) {
      return;
    }

    const employeeKey = employee.employeeNo || toText(employee.phone);
    if (employeeKey) {
      seen.add(employeeKey);
    }
  });

  return seen.size;
}

function getAssignedTargetBatchDay(dateValue, batchDays = [], yearMonth = '') {
  const date = normalizeDate(dateValue);
  if (!date || !date.startsWith(yearMonth) || batchDays.length === 0) {
    return undefined;
  }

  const day = Number(date.slice(8, 10));
  const previousBatchDay = batchDays
    .filter((batchDay) => batchDay <= day)
    .at(-1);
  return previousBatchDay || batchDays[0];
}

function countTrainingInAssignedBatch(employees, { base, channel, yearMonth, batchDays, batchDay }) {
  const seen = new Set();

  employees.forEach((employee) => {
    if (toText(employee.base) !== base || toText(employee.channelType) !== channel) {
      return;
    }
    if (getAssignedTargetBatchDay(employee.trainingDate, batchDays, yearMonth) !== batchDay) {
      return;
    }

    const employeeKey = employee.employeeNo || toText(employee.phone);
    if (employeeKey) {
      seen.add(employeeKey);
    }
  });

  return seen.size;
}

function countFunnelInWindow(interviews, { base, channel, startDate, endDate }) {
  return interviews.reduce((summary, interview) => {
    if (toText(interview.base) !== base || toText(interview.channelType) !== channel) {
      return summary;
    }
    if (!isBetween(interview.feedbackDate, startDate, endDate)) {
      return summary;
    }

    summary.arrivedCount += 1;
    if (PASSED_INTERVIEW_RESULTS.has(interview.feedbackResult)) {
      summary.passedCount += 1;
    }
    return summary;
  }, {
    arrivedCount: 0,
    passedCount: 0,
    trainingCount: 0
  });
}

function getBatchStatus({ target, actualTraining, windowStart, windowEnd, asOfDate }) {
  if (actualTraining >= target) {
    return 'achieved';
  }
  if (asOfDate && asOfDate < windowStart) {
    return 'notStarted';
  }
  if (asOfDate && asOfDate >= windowStart && asOfDate <= windowEnd) {
    return 'inProgress';
  }
  return 'missed';
}

function buildGapDiagnosis({ target, actualTraining, arrivedCount, passedCount }) {
  const expectedPassedCount = Math.ceil(target / EXPECTED_ENTRY_RATE);
  const expectedArrivedCount = Math.ceil(expectedPassedCount / EXPECTED_INTERVIEW_PASS_RATE);
  const gap = actualTraining - target;
  const arrivedEnough = arrivedCount >= expectedArrivedCount;
  const passedEnough = passedCount >= expectedPassedCount;
  const entryEnough = actualTraining >= target;
  const actualEntryRate = passedCount > 0 ? actualTraining / passedCount : 0;
  const stages = [
    {
      name: '到面环节',
      actual: arrivedCount,
      expected: expectedArrivedCount,
      status: arrivedEnough ? 'normal' : 'insufficient',
      text: arrivedEnough ? '满足预计需求' : '低于预计需求'
    },
    {
      name: '面通环节',
      actual: passedCount,
      expected: expectedPassedCount,
      status: passedEnough ? 'normal' : 'insufficient',
      text: passedEnough ? '满足预计需求' : '低于预计需求'
    },
    {
      name: '入职环节',
      actual: actualTraining,
      expected: target,
      status: entryEnough ? 'normal' : 'insufficient',
      text: entryEnough ? '满足目标' : '低于目标'
    }
  ];

  if (gap >= 0) {
    return {
      reason: '达标 / 正常',
      conclusion: '该批次当前无 GAP，保持节奏即可',
      suggestion: '保持当前招聘节奏，继续跟进入职稳定性',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  if (!arrivedEnough && !passedEnough && !entryEnough) {
    return {
      reason: '整体储备不足',
      conclusion: '到面、面通、入职均低于预计需求，需要补充候选人池',
      suggestion: '优先加大邀约和渠道补量，同时补充候选人备份',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  if (!arrivedEnough) {
    return {
      reason: '前端邀约/到面不足',
      conclusion: '当前到面人数不足，后续漏斗没有足够候选人承接',
      suggestion: '优先增加邀约量、提升到面率、补充渠道候选人',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  if (!passedEnough && actualEntryRate >= EXPECTED_ENTRY_RATE) {
    return {
      reason: '面试通过率低',
      conclusion: '到面人数足够，但面试通过人数低于预计需求',
      suggestion: '优先复盘候选人质量、面试标准和渠道匹配度',
      expectedArrivedCount,
      expectedPassedCount,
      expectedEntryCount: target,
      stages
    };
  }

  return {
    reason: '通过后入职转化不足',
    conclusion: '不是到面不够，主要卡在面通后的入职确认和承接',
    suggestion: '优先催入职确认 / 补 offer / 加候选人备份',
    expectedArrivedCount,
    expectedPassedCount,
    expectedEntryCount: target,
    stages
  };
}

function buildBatchDrilldown({ yearMonth, base, channel, targets = [], employees = [], interviews = [], asOfDate = '' }) {
  if (!yearMonth || !base || !channel) {
    return [];
  }

  const matchedTargets = targets.filter((target) => (
    target.yearMonth === yearMonth
    && toText(target.base) === base
    && toText(target.channel) === channel
  ));
  const batches = sumDailyTargetsByDay(matchedTargets);
  const batchDays = batches.map((batch) => batch.day);
  const month = Number(yearMonth.slice(5, 7));
  const normalizedAsOfDate = normalizeDate(asOfDate);

  return batches.map((batch, index) => {
    const previousDay = index === 0 ? 1 : batches[index - 1].day + 1;
    const windowStart = buildDate(yearMonth, previousDay);
    const windowEnd = buildDate(yearMonth, batch.day);
    const actualTraining = countTrainingInAssignedBatch(employees, {
      base,
      channel,
      yearMonth,
      batchDays,
      batchDay: batch.day
    });
    const funnel = countFunnelInWindow(interviews, { base, channel, startDate: windowStart, endDate: windowEnd });
    const achievementRate = batch.target > 0 ? actualTraining / batch.target : 0;
    const diagnosis = buildGapDiagnosis({
      target: batch.target,
      actualTraining,
      arrivedCount: funnel.arrivedCount,
      passedCount: funnel.passedCount
    });
    const status = getBatchStatus({
      target: batch.target,
      actualTraining,
      windowStart,
      windowEnd,
      asOfDate: normalizedAsOfDate
    });

    return {
      label: `${month}月${batch.day}日批次`,
      day: batch.day,
      windowStart,
      windowEnd,
      channel,
      target: batch.target,
      actualTraining,
      gap: actualTraining - batch.target,
      achievementRate,
      achievementRateText: formatDashboardRate(achievementRate),
      status,
      statusText: getStatusText(status),
      diagnosis,
      funnel: {
        ...funnel,
        trainingCount: actualTraining
      }
    };
  });
}

function getAllBatchDays(targets, yearMonth, filters = {}) {
  const baseFilter = toText(filters.base);
  const channelFilter = toText(filters.channel);
  const batchDayFilter = Number(filters.batchDay || 0);
  const days = new Set();

  targets.forEach((target) => {
    if (target.yearMonth !== yearMonth) {
      return;
    }
    if (baseFilter && target.base !== baseFilter) {
      return;
    }
    if (channelFilter && target.channel !== channelFilter) {
      return;
    }
    Object.entries(target.dailyTargets || {}).forEach(([day, value]) => {
      if (Number(value || 0) > 0) {
        days.add(Number(day));
      }
    });
  });

  return Array.from(days)
    .filter((day) => !batchDayFilter || day === batchDayFilter)
    .sort((left, right) => left - right);
}

function buildEmptyBatchCell(day, yearMonth) {
  const month = Number(yearMonth.slice(5, 7));
  return {
    type: 'batch',
    day,
    label: `${month}月${day}日批次`,
    status: 'empty',
    statusText: getStatusText('empty'),
    target: 0,
    actualTraining: 0,
    gap: 0,
    achievementRate: 0,
    achievementRateText: '0.0%',
    displayText: '0.0%',
    funnel: {
      arrivedCount: 0,
      passedCount: 0,
      trainingCount: 0
    }
  };
}

function buildActualOnlyBatchCell(day, yearMonth, { base, channel, previousDay, batchDays = [], employees = [], interviews = [] }) {
  const windowStart = buildDate(yearMonth, previousDay);
  const windowEnd = buildDate(yearMonth, day);
  const actualTraining = countTrainingInAssignedBatch(employees, {
    base,
    channel,
    yearMonth,
    batchDays,
    batchDay: day
  });
  if (actualTraining <= 0) {
    return buildEmptyBatchCell(day, yearMonth);
  }
  const funnel = countFunnelInWindow(interviews, { base, channel, startDate: windowStart, endDate: windowEnd });

  return {
    type: 'batch',
    day,
    label: `${Number(yearMonth.slice(5, 7))}月${day}日批次`,
    windowStart,
    windowEnd,
    status: 'achieved',
    statusText: '健康',
    target: 0,
    actualTraining,
    gap: actualTraining,
    achievementRate: 1,
    achievementRateText: '100.0%',
    displayText: '100.0%',
    diagnosis: buildGapDiagnosis({
      target: 0,
      actualTraining,
      arrivedCount: funnel.arrivedCount,
      passedCount: funnel.passedCount
    }),
    funnel: {
      ...funnel,
      trainingCount: actualTraining
    }
  };
}

function buildTotalMatrixCell(cell) {
  const hasData = cell.monthlyTarget > 0 || cell.actualTraining > 0;
  const status = getCellStatus(cell.achievementRate, hasData);
  return {
    type: 'total',
    day: 'total',
    label: '合计',
    ...cell,
    status,
    statusText: getStatusText(status),
    achievementRateText: formatDashboardRate(cell.achievementRate),
    displayText: formatDashboardRate(cell.achievementRate)
  };
}

function getSortWeight(status) {
  const weights = {
    risk: 0,
    warning: 1,
    achieved: 2,
    empty: 3
  };
  return weights[status] ?? 9;
}

function toMatrixStatus(batchStatus) {
  if (batchStatus === 'missed') {
    return 'risk';
  }
  if (batchStatus === 'inProgress') {
    return 'warning';
  }
  if (batchStatus === 'notStarted') {
    return 'empty';
  }
  return batchStatus;
}

function shouldDiagnoseFunnel(channel) {
  return !EXCLUDED_FUNNEL_DIAGNOSIS_CHANNELS.has(toText(channel));
}

function buildBatchMatrix({ yearMonth, matrix, targets = [], employees = [], interviews = [], filters = {}, asOfDate = '' }) {
  const batchDays = getAllBatchDays(targets, yearMonth, filters);
  const statusFilter = toText(filters.status);
  const columns = [
    ...batchDays.map((day) => ({
      type: 'batch',
      day,
      label: `${Number(yearMonth.slice(5, 7))}月${day}日批次`
    })),
    { type: 'total', day: 'total', label: '合计' }
  ];
  const summary = {
    risk: 0,
    warning: 0,
    achieved: 0,
    empty: 0
  };
  const riskItems = [];

  const rows = [];
  matrix.rows.forEach((baseRow) => {
    matrix.channels.forEach((channel) => {
      const diagnosable = shouldDiagnoseFunnel(channel);
      const batches = buildBatchDrilldown({
        yearMonth,
        base: baseRow.base,
        channel,
        targets,
        employees,
        interviews,
        asOfDate
      });
      const batchMap = new Map(batches.map((batch) => [batch.day, {
        type: 'batch',
        ...batch,
        displayText: batch.achievementRateText
      }]));
      const targetBatchDays = Array.from(batchMap.keys());
      const cells = {};

      batchDays.forEach((day, index) => {
        const previousDay = index === 0 ? 1 : batchDays[index - 1] + 1;
        const sourceCell = batchMap.get(day) || (targetBatchDays.length > 0
          ? buildEmptyBatchCell(day, yearMonth)
          : buildActualOnlyBatchCell(day, yearMonth, {
          base: baseRow.base,
          channel,
          previousDay,
          batchDays,
          employees,
          interviews
        }));
        const matrixStatus = toMatrixStatus(sourceCell.status);
        const cell = {
          ...sourceCell,
          batchStatus: sourceCell.status,
          batchStatusText: sourceCell.statusText,
          status: matrixStatus,
          statusText: sourceCell.target <= 0 && sourceCell.actualTraining > 0
            ? sourceCell.statusText
            : getStatusText(matrixStatus)
        };
        cells[day] = cell;
        summary[cell.status] += 1;
        if (diagnosable && (cell.status === 'risk' || cell.status === 'warning')) {
          riskItems.push({
            base: baseRow.base,
            channel,
            day,
            label: `${baseRow.base} / ${channel} / ${cell.label}`,
            status: cell.status,
            statusText: cell.statusText,
            gap: cell.gap,
            achievementRate: cell.achievementRate,
            achievementRateText: cell.achievementRateText,
            target: cell.target,
            actualTraining: cell.actualTraining,
            reason: cell.diagnosis?.reason || '',
            suggestion: cell.diagnosis?.suggestion || ''
          });
        }
      });

      const total = buildTotalMatrixCell(baseRow.cells[channel]);
      const row = {
        base: baseRow.base,
        channel,
        label: `${baseRow.base} / ${channel}`,
        diagnosable,
        cells,
        total
      };

      const matchesStatus = !statusFilter
        || Object.values(cells).some((cell) => cell.status === statusFilter)
        || total.status === statusFilter;
      if (matchesStatus) {
        rows.push(row);
      }
    });
  });

  riskItems.sort((left, right) => {
    const statusDiff = getSortWeight(left.status) - getSortWeight(right.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }
    if (left.gap !== right.gap) {
      return left.gap - right.gap;
    }
    return left.achievementRate - right.achievementRate;
  });

  rows.sort((left, right) => {
    const leftWorst = Math.min(...Object.values(left.cells).map((cell) => getSortWeight(cell.status)), getSortWeight(left.total.status));
    const rightWorst = Math.min(...Object.values(right.cells).map((cell) => getSortWeight(cell.status)), getSortWeight(right.total.status));
    if (leftWorst !== rightWorst) {
      return leftWorst - rightWorst;
    }
    return left.label.localeCompare(right.label, 'zh-Hans-CN');
  });

  return {
    columns,
    rows,
    summary,
    riskItems
  };
}

function findDefaultCell(matrix) {
  const statusPriority = ['risk', 'warning', 'achieved'];

  for (const status of statusPriority) {
    for (const row of matrix.rows) {
      const channel = matrix.channels.find((item) => row.cells[item]?.status === status);
      if (channel) {
        return {
          base: row.base,
          channel
        };
      }
    }
  }

  return {
    base: matrix.rows[0]?.base || '',
    channel: matrix.channels[0] || ''
  };
}

function findDefaultMatrixSelection(batchMatrix, preferredBase = '') {
  const riskItems = preferredBase
    ? batchMatrix.riskItems.filter((item) => item.base === preferredBase)
    : batchMatrix.riskItems;
  const firstRisk = riskItems[0];
  if (firstRisk) {
    return {
      base: firstRisk.base,
      channel: firstRisk.channel,
      selectedBatchDay: firstRisk.day
    };
  }

  const firstRow = preferredBase
    ? batchMatrix.rows.find((row) => row.base === preferredBase)
    : batchMatrix.rows[0];
  const firstColumn = batchMatrix.columns.find((column) => column.type === 'batch');
  return {
    base: firstRow?.base || '',
    channel: firstRow?.channel || '',
    selectedBatchDay: firstColumn?.day || 'total'
  };
}

function findSelectedMatrixDetail(batchMatrix, selectedCell) {
  const row = batchMatrix.rows.find((item) => item.base === selectedCell.base && item.channel === selectedCell.channel);
  if (!row) {
    return undefined;
  }

  const selectedBatchDay = selectedCell.selectedBatchDay;
  if (selectedBatchDay === 'total') {
    return row.total;
  }

  return row.cells[Number(selectedBatchDay)] || row.total;
}

function sortChannels(left, right) {
  const leftIndex = CHANNEL_DISPLAY_ORDER.indexOf(left.channel || left);
  const rightIndex = CHANNEL_DISPLAY_ORDER.indexOf(right.channel || right);
  const normalizedLeftIndex = leftIndex === -1 ? CHANNEL_DISPLAY_ORDER.length : leftIndex;
  const normalizedRightIndex = rightIndex === -1 ? CHANNEL_DISPLAY_ORDER.length : rightIndex;
  if (normalizedLeftIndex !== normalizedRightIndex) {
    return normalizedLeftIndex - normalizedRightIndex;
  }
  return toText(left.channel || left).localeCompare(toText(right.channel || right), 'zh-Hans-CN');
}

function buildChannelFunnelRows(channels = [], batchGap = null) {
  return channels.map((channel) => {
    const funnel = channel.funnel || {};
    const arrivedCount = Number(funnel.arrivedCount || 0);
    const passedCount = Number(funnel.passedCount || 0);
    const trainingCount = Number(funnel.trainingCount ?? channel.actualTraining ?? 0);
    const row = {
      channel: channel.channel,
      arrivedCount,
      passedCount,
      trainingCount,
      passRateText: arrivedCount > 0 ? formatPercent(passedCount / arrivedCount) : '0.00%',
      trainingRateText: passedCount > 0 ? formatPercent(trainingCount / passedCount) : '0.00%',
      status: channel.status,
      statusText: channel.statusText,
      gap: channel.gap
    };

    if (batchGap === null || Number(batchGap) < 0) {
      return row;
    }

    if (Number(row.gap || 0) >= 0) {
      return {
        ...row,
        status: 'achieved',
        statusText: Number(channel.target || 0) <= 0 && trainingCount > 0 ? '健康' : getStatusText('achieved')
      };
    }

    return {
      ...row,
      status: 'warning',
      statusText: '需关注'
    };
  });
}

function getChannelBoardStatus(row) {
  const monthlyTarget = Number(row.monthlyTarget || 0);
  const actualTraining = Number(row.actualTraining || 0);
  if (monthlyTarget <= 0 && actualTraining > 0) {
    return {
      status: 'achieved',
      statusText: '健康'
    };
  }
  const hasData = monthlyTarget > 0 || actualTraining > 0;
  const status = getCellStatus(row.achievementRate, hasData);
  return {
    status,
    statusText: getStatusText(status)
  };
}

function formatChineseMonthDay(dateValue) {
  const normalized = normalizeDate(dateValue);
  if (!normalized) {
    return '';
  }

  return `${Number(normalized.slice(5, 7))}月${Number(normalized.slice(8, 10))}日`;
}

function countInclusiveDays(startDate, endDate) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  if (!start || !end) {
    return 1;
  }

  const diff = Math.floor((Date.parse(end) - Date.parse(start)) / 86400000);
  return Math.max(1, diff + 1);
}

function getBatchPreparationEndDate(windowEnd) {
  const end = normalizeDate(windowEnd);
  if (!end) {
    return '';
  }

  const date = new Date(`${end}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return formatDate(date);
}

function getBatchActionPeriod({ windowStart, windowEnd, asOfDate }) {
  const start = normalizeDate(windowStart);
  const end = getBatchPreparationEndDate(windowEnd);

  if (!start || !end || end < start) {
    return {
      label: '后续',
      days: 1
    };
  }

  const today = normalizeDate(asOfDate);
  if (!today || today > end) {
    return {
      label: `${formatChineseMonthDay(start)} - ${formatChineseMonthDay(end)}`,
      days: countInclusiveDays(start, end)
    };
  }

  const periodStart = today >= start ? today : start;
  return {
    label: `${formatChineseMonthDay(periodStart)} - ${formatChineseMonthDay(end)}`,
    days: countInclusiveDays(periodStart, end)
  };
}

function countBaseSelfRecruiters(employees = [], interviews = [], base = '', windowStart = '', windowEnd = '', yearMonth = '') {
  const recruiterNames = new Set();

  interviews.forEach((interview) => {
    if (toText(interview.channelType) !== '自主社招') {
      return;
    }
    if (base && toText(interview.base) !== base) {
      return;
    }
    if (windowStart && windowEnd && !isBetween(interview.feedbackDate, windowStart, windowEnd)) {
      return;
    }
    const recruiterName = getSelfSourcingRecruiterName(interview);
    if (recruiterName) {
      recruiterNames.add(recruiterName);
    }
  });

  if (recruiterNames.size > 0) {
    return recruiterNames.size;
  }

  employees.forEach((employee) => {
    if (toText(employee.channelType) !== '自主社招') {
      return;
    }
    if (base && toText(employee.base) !== base) {
      return;
    }
    if (yearMonth && !employee.trainingDate.startsWith(yearMonth)) {
      return;
    }
    const recruiterName = getSelfSourcingRecruiterName(employee);
    if (recruiterName) {
      recruiterNames.add(recruiterName);
    }
  });

  const fallbackCount = getSelfSourcingRecruitersForMonth(employees, yearMonth).length;
  return Math.max(1, recruiterNames.size || fallbackCount);
}

function estimateDailyInviteCapacity(interviews = [], base = '', windowStart = '', windowEnd = '', asOfDate = '') {
  const end = normalizeDate(asOfDate) && normalizeDate(asOfDate) <= normalizeDate(windowEnd)
    ? normalizeDate(asOfDate)
    : normalizeDate(windowEnd);
  const start = normalizeDate(windowStart);
  if (!start || !end || end < start) {
    return 0;
  }

  const inviteCount = interviews.filter((interview) => (
    toText(interview.channelType) === '自主社招'
    && (!base || toText(interview.base) === base)
    && isBetween(interview.feedbackDate, start, end)
  )).length;

  return Math.ceil(inviteCount / countInclusiveDays(start, end));
}

function countSocialSuppliers(interviews = [], base = '', windowStart = '', windowEnd = '') {
  const suppliers = new Set();

  interviews.forEach((interview) => {
    if (toText(interview.channelType) !== '渠道社招') {
      return;
    }
    if (base && toText(interview.base) !== base) {
      return;
    }
    if (windowStart && windowEnd && !isBetween(interview.feedbackDate, windowStart, windowEnd)) {
      return;
    }
    const supplierName = toText(interview.channelName);
    if (supplierName) {
      suppliers.add(supplierName);
    }
  });

  return Math.max(1, suppliers.size);
}

function buildSelfBatchActionPlan(cell, batchMeta, context = {}) {
  const period = getBatchActionPeriod({
    windowStart: cell.windowStart || batchMeta.windowStart,
    windowEnd: cell.windowEnd || batchMeta.windowEnd,
    asOfDate: context.asOfDate
  });
  const expectedArrived = Number(cell.diagnosis?.expectedArrivedCount || 0);
  const actualArrived = Number(cell.funnel?.arrivedCount || 0);
  const arrivedGap = Math.max(0, expectedArrived - actualArrived);
  const dailyArrived = Math.max(1, Math.ceil(arrivedGap / period.days));
  const dailyInvite = Math.max(1, Math.ceil(arrivedGap / INVITE_ARRIVE_RATE / period.days));
  const recruiterCount = countBaseSelfRecruiters(
    context.employees,
    context.interviews,
    batchMeta.base,
    cell.windowStart || batchMeta.windowStart,
    cell.windowEnd || batchMeta.windowEnd,
    context.yearMonth
  );
  const perRecruiterInvite = Math.max(1, Math.ceil(dailyInvite / recruiterCount));
  const currentDailyCapacity = estimateDailyInviteCapacity(
    context.interviews,
    batchMeta.base,
    cell.windowStart || batchMeta.windowStart,
    cell.windowEnd || batchMeta.windowEnd,
    context.asOfDate
  );
  const capacityOk = currentDailyCapacity <= 0 || currentDailyCapacity >= dailyInvite;
  const diagnosis = arrivedGap > 0
    ? `到面人数未达标，当前候选人储备无法支撑 ${batchMeta.label} 到岗。`
    : (cell.diagnosis?.conclusion || `自主社招低于 ${batchMeta.label} 目标，需继续跟进剩余候选人到岗确认。`);

  return {
    channel: '自主社招',
    title: '自主社招提升方案',
    owner: '自招团队',
    status: cell.status,
    statusText: cell.statusText,
    focus: diagnosis,
    diagnosis,
    communicationScript: '',
    actions: [
      `${period.label}每天至少完成 ${dailyArrived} 人有效到面，对应每天约 ${dailyInvite} 人有效邀约。`,
      capacityOk
        ? `当前自招有 ${recruiterCount} 名招聘专员，均摊后每人每天需要完成约 ${perRecruiterInvite} 人有效邀约；人力测算可承接当前缺口，优先把邀约和到面动作做满，暂不扩编。`
        : `当前自招有 ${recruiterCount} 名招聘专员，均摊后每人每天需要完成约 ${perRecruiterInvite} 人有效邀约，按现有人力日均约 ${currentDailyCapacity} 人邀约，存在产能缺口，建议增加招聘专员或临时加人。`,
      '如果每天邀约人数完成了，但实际到面仍然不足，说明候选人爽约较多，需要提前讲清岗位要求、薪资、工作地点和到岗时间，减少无效邀约。'
    ]
  };
}

function buildSocialBatchActionPlan(cell, batchMeta, context = {}) {
  const period = getBatchActionPeriod({
    windowStart: cell.windowStart || batchMeta.windowStart,
    windowEnd: cell.windowEnd || batchMeta.windowEnd,
    asOfDate: context.asOfDate
  });
  const expectedArrived = Number(cell.diagnosis?.expectedArrivedCount || 0);
  const actualArrived = Number(cell.funnel?.arrivedCount || 0);
  const arrivedGap = Math.max(0, expectedArrived - actualArrived);
  const dailyArrived = Math.max(1, Math.ceil(arrivedGap / period.days));
  const supplierCount = countSocialSuppliers(
    context.interviews,
    batchMeta.base,
    cell.windowStart || batchMeta.windowStart,
    cell.windowEnd || batchMeta.windowEnd
  );
  const perSupplierDaily = Math.max(1, Math.ceil(dailyArrived / supplierCount));
  const supplierCapacity = Math.ceil(actualArrived / period.days);
  const capacityGap = Math.max(0, dailyArrived - supplierCapacity);
  const suggestedNewSuppliers = capacityGap > 0 ? 1 : 0;
  const diagnosis = `渠道社招整体到面不足，现有供应商池日均到面能力低于 ${batchMeta.label} 达成节奏。`;
  const actions = [
    `${period.label}每天需完成 ${dailyArrived} 人到面，当前 ${supplierCount} 家供应商平均每家每天需提升到 ${perSupplierDaily} 人到面。`,
    capacityGap > 0
      ? `现有供应商池最近日均到面约 ${supplierCapacity} 人，低于后续所需 ${dailyArrived} 人，存在 ${capacityGap} 人/天产能缺口。`
      : `现有供应商池最近日均到面约 ${supplierCapacity} 人，已达到后续所需 ${dailyArrived} 人/天。`
  ];

  if (suggestedNewSuppliers > 0) {
    actions.push(`若现有供应商无法提升到该节奏，建议新增 ${suggestedNewSuppliers} 家 RPO 供应商或要求现有供应商短期加量。`);
  }

  return {
    channel: '渠道社招',
    title: '渠道社招提升方案',
    owner: 'RPO 供应商池',
    status: cell.status,
    statusText: cell.statusText,
    focus: diagnosis,
    diagnosis,
    communicationScript: '',
    actions
  };
}

function buildReferralBatchActionPlan(cell, batchMeta) {
  const diagnosis = cell.diagnosis?.conclusion
    || `内推渠道低于 ${batchMeta.label} 目标，但不做复杂产能测算，重点提示基地侧加强宣导。`;

  return {
    channel: '内推',
    title: '内推提升方案',
    owner: '基地负责人',
    status: cell.status,
    statusText: cell.statusText,
    focus: diagnosis,
    diagnosis,
    communicationScript: '',
    actions: [
      '基地负责人在班前会 / 班后会加强岗位需求、到岗时间和奖励政策宣导。',
      '推动班组长收集员工推荐名单，并对已推荐候选人及时跟进邀约和到面。',
      '将内推缺口纳入基地周度复盘，持续提醒员工转介绍。'
    ]
  };
}

function buildChannelBatchActionPlan(cell, batchMeta, context = {}) {
  if (Number(cell.gap || 0) >= 0 || Number(cell.target || 0) <= 0) {
    return undefined;
  }

  if (cell.channel === '自主社招') {
    return buildSelfBatchActionPlan(cell, batchMeta, context);
  }

  if (cell.channel === '渠道社招') {
    return buildSocialBatchActionPlan(cell, batchMeta, context);
  }

  if (cell.channel === '内推') {
    return buildReferralBatchActionPlan(cell, batchMeta);
  }

  return undefined;
}

function buildBatchActionPlans(cells = [], batchMeta = {}, context = {}) {
  const actionPlans = cells
    .map((cell) => buildChannelBatchActionPlan(cell, batchMeta, context))
    .filter(Boolean)
    .sort(sortChannels);

  if (actionPlans.length === 0) {
    return [{
      title: '保持现状',
      owner: '基地负责人',
      status: 'achieved',
      statusText: '已达成',
      focus: '当前批次各渠道目标已达成',
      diagnosis: '目标已达成，当前不需要额外提升方案。',
      communicationScript: '',
      actions: ['保持现有招聘节奏和渠道跟进即可。']
    }];
  }

  return actionPlans;
}

function buildBatchMainRiskText(batch, worstCell) {
  if (batch.gap >= 0) {
    return '当前批次目标已达成，保持现有招聘节奏';
  }

  const reason = worstCell?.diagnosis?.reason || batch.reason || '存在入职缺口';
  return `当前主要风险：${worstCell?.channel || batch.worstChannel || '多渠道'}${reason}`;
}

function buildHealthyActionPlans(base) {
  return [{
    channel: '整体',
    title: '基地达成健康',
    owner: '基地负责人',
    focus: '达成稳定性 + 漏斗保持',
    status: 'achieved',
    statusText: '健康',
    diagnosis: '当前基地已完成目标，各项环节均在健康值，建议保持现有招聘节奏。',
    communicationScript: `${base}当前达成健康，自招团队和渠道经理保持日常跟进，重点沉淀高转化来源与稳定入职做法。`,
    actions: [
      '保留当前高转化渠道和招聘顾问节奏',
      '复盘已入职候选人来源，沉淀可复用画像',
      '继续关注入职后稳定性，避免只看数量不看质量'
    ]
  }];
}

function pickPositionBase(progress, batchMatrix, selectedBase = '') {
  if (selectedBase) {
    return selectedBase;
  }
  if (batchMatrix.riskItems[0]?.base) {
    return batchMatrix.riskItems[0].base;
  }

  const bases = progress.bases || [];
  const worstBase = bases
    .map((base) => ({
      base: base.base,
      total: base.channelRows.find((row) => row.channel === '合计')
    }))
    .filter((item) => item.total)
    .sort((left, right) => {
      if (left.total.gap !== right.total.gap) {
        return left.total.gap - right.total.gap;
      }
      return left.total.achievementRate - right.total.achievementRate;
    })[0];

  return worstBase?.base || bases[0]?.base || '';
}

function pickLargestRiskBase(progress) {
  const bases = progress.bases || [];
  const largestRiskBase = bases
    .map((base) => ({
      base: base.base,
      total: base.channelRows.find((row) => row.channel === '合计')
    }))
    .filter((item) => item.total && (item.total.monthlyTarget > 0 || item.total.actualTraining > 0))
    .sort((left, right) => {
      if (left.total.gap !== right.total.gap) {
        return left.total.gap - right.total.gap;
      }
      return left.total.achievementRate - right.total.achievementRate;
    })[0];

  return largestRiskBase?.base || '';
}

function isActualOnlyBase(base) {
  return Number(base.monthlyTarget || 0) <= 0 && Number(base.actualTraining || 0) > 0;
}

function sortBaseAchievements(left, right) {
  const leftActualOnly = isActualOnlyBase(left);
  const rightActualOnly = isActualOnlyBase(right);
  if (leftActualOnly !== rightActualOnly) {
    return leftActualOnly ? 1 : -1;
  }
  if (left.achievementRate !== right.achievementRate) {
    return left.achievementRate - right.achievementRate;
  }
  if (left.gap !== right.gap) {
    return left.gap - right.gap;
  }
  return left.base.localeCompare(right.base, 'zh-Hans-CN');
}

function buildBaseAchievementOverview(progress) {
  const baseAchievements = (progress.bases || [])
    .map((base) => {
      const total = base.channelRows.find((row) => row.channel === '合计') || {
        monthlyTarget: 0,
        cutoffTarget: 0,
        actualTraining: 0,
        gap: 0,
        achievementRate: 0,
        achievementRateText: '0.00%'
      };
      const status = getCutoffTargetStatus(total);

      return {
        base: base.base,
        monthlyTarget: total.monthlyTarget,
        cutoffTarget: total.cutoffTarget,
        actualTraining: total.actualTraining,
        gap: total.gap,
        achievementRate: total.achievementRate,
        achievementRateText: total.achievementRateText,
        status,
        statusText: getStatusText(status)
      };
    })
    .filter((base) => base.monthlyTarget > 0 || base.actualTraining > 0)
    .sort(sortBaseAchievements);
  const riskBaseCount = baseAchievements.filter((base) => base.status === 'risk' || base.status === 'warning').length;

  return {
    mode: 'baseOverview',
    base: '',
    title: '全部基地达成情况',
    total: {
      ...progress.overall,
      status: getCutoffTargetStatus(progress.overall),
      statusText: getStatusText(getCutoffTargetStatus(progress.overall))
    },
    baseAchievements,
    riskBaseCount,
    mainRiskText: riskBaseCount > 0
      ? `当前有 ${riskBaseCount} 个基地未达标或预警，优先处理达成率最低的基地`
      : '全部基地当前达成正常，保持招聘节奏'
  };
}

function buildPositionChannelBoard({
  progress,
  batchMatrix,
  selectedBase = '',
  selectedBatchDay = '',
  employees = [],
  interviews = [],
  asOfDate = '',
  yearMonth = ''
}) {
  if (!selectedBase) {
    return buildBaseAchievementOverview(progress);
  }

  const base = pickPositionBase(progress, batchMatrix, selectedBase);
  const baseProgress = (progress.bases || []).find((item) => item.base === base);
  const baseRows = batchMatrix.rows.filter((row) => row.base === base);
  const total = baseProgress?.channelRows.find((row) => row.channel === '合计') || {
    monthlyTarget: 0,
    cutoffTarget: 0,
    actualTraining: 0,
    gap: 0,
    achievementRate: 0,
    achievementRateText: '0.00%'
  };
  const channels = (baseProgress?.channelRows || [])
    .filter((row) => row.channel !== '合计')
    .map((row) => {
      const channelStatus = getChannelBoardStatus(row);
      return {
        channel: row.channel,
        monthlyTarget: row.monthlyTarget,
        cutoffTarget: row.cutoffTarget,
        actualTraining: row.actualTraining,
        gap: row.gap,
        achievementRate: row.achievementRate,
        achievementRateText: row.achievementRateText,
        status: channelStatus.status,
        statusText: channelStatus.statusText,
        targetShareText: row.targetShareText,
        actualShareText: row.actualShareText
      };
    })
    .filter((row) => row.monthlyTarget > 0 || row.actualTraining > 0)
    .sort(sortChannels);
  const batchColumns = batchMatrix.columns.filter((column) => column.type === 'batch');
  const actionContext = {
    employees,
    interviews,
    asOfDate,
    yearMonth
  };
  const batchRisks = batchColumns.map((column) => {
    const cells = baseRows
      .map((row) => ({
        channel: row.channel,
        ...row.cells[column.day]
      }))
      .filter((cell) => cell);
    const referenceCell = cells.find((cell) => cell.windowStart && cell.windowEnd) || cells[0];
    const batchMeta = {
      day: column.day,
      label: column.label,
      base,
      windowStart: referenceCell?.windowStart || '',
      windowEnd: referenceCell?.windowEnd || (yearMonth ? buildDate(yearMonth, column.day) : '')
    };
    const target = cells.reduce((sum, cell) => sum + Number(cell.target || 0), 0);
    const actualTraining = cells.reduce((sum, cell) => sum + Number(cell.actualTraining || 0), 0);
    const gap = actualTraining - target;
    const achievementRate = target > 0 ? actualTraining / target : 0;
    const worstCell = cells
      .slice()
      .sort((left, right) => {
        const statusDiff = getSortWeight(left.status) - getSortWeight(right.status);
        if (statusDiff !== 0) {
          return statusDiff;
        }
        return Number(left.gap || 0) - Number(right.gap || 0);
      })[0];
    const status = getCellStatus(achievementRate, target > 0 || actualTraining > 0);

    return {
      day: column.day,
      label: column.label,
      target,
      actualTraining,
      gap,
      achievementRate,
      achievementRateText: formatDashboardRate(achievementRate),
      status,
      statusText: getStatusText(status),
      channels: cells.slice().sort(sortChannels),
      funnelRows: buildChannelFunnelRows(cells.slice().sort(sortChannels), gap),
      actionPlans: buildBatchActionPlans(cells, batchMeta, actionContext),
      mainRiskText: buildBatchMainRiskText({
        gap,
        reason: worstCell?.diagnosis?.reason || (gap >= 0 ? '达标 / 正常' : '存在入职缺口'),
        worstChannel: worstCell?.channel || ''
      }, worstCell),
      reason: worstCell?.diagnosis?.reason || (gap >= 0 ? '达标 / 正常' : '存在入职缺口'),
      suggestion: worstCell?.diagnosis?.suggestion || '',
      worstChannel: worstCell?.channel || ''
    };
  }).filter((batch) => batch.target > 0 || batch.actualTraining > 0);
  const selectedDay = Number(selectedBatchDay || batchRisks.find((batch) => batch.status === 'risk')?.day || batchRisks[0]?.day || 0);
  const selectedBatchSummary = batchRisks.find((batch) => batch.day === selectedDay) || batchRisks[0];
  const selectedBatchRows = baseRows
    .map((row) => ({
      channel: row.channel,
      ...(row.cells[selectedBatchSummary?.day] || {})
    }))
    .filter((cell) => cell.day)
    .sort(sortChannels);
  const mainRisks = batchRisks
    .filter((batch) => batch.status === 'risk' || batch.status === 'warning')
    .map((batch) => `${batch.worstChannel || '多渠道'}${batch.reason}`)
    .slice(0, 2);
  const funnelRows = buildChannelFunnelRows(
    selectedBatchRows,
    selectedBatchSummary?.gap
  );
  const totalStatus = getCellStatus(total.achievementRate, total.monthlyTarget > 0 || total.actualTraining > 0);
  const isHealthy = totalStatus === 'achieved';
  const actionPlans = isHealthy
    ? buildHealthyActionPlans(base)
    : (selectedBatchSummary?.actionPlans || buildBatchActionPlans(selectedBatchRows, {
      day: selectedBatchSummary?.day,
      label: selectedBatchSummary?.label,
      base,
      windowStart: selectedBatchRows.find((cell) => cell.windowStart)?.windowStart || '',
      windowEnd: selectedBatchRows.find((cell) => cell.windowEnd)?.windowEnd || ''
    }, actionContext));

  return {
    mode: 'position',
    base,
    title: base ? `${base} · 多渠道岗位` : '多渠道岗位',
    total: {
      ...total,
      status: totalStatus,
      statusText: getStatusText(totalStatus)
    },
    healthStatus: isHealthy ? 'healthy' : 'risk',
    channels,
    funnelRows,
    actionPlans,
    batchRisks,
    selectedBatch: selectedBatchSummary ? {
      ...selectedBatchSummary,
      channels: selectedBatchRows
    } : undefined,
    mainRiskText: isHealthy
      ? '当前基地已达成，各项环节均在健康值，保持自招与渠道协同节奏'
      : (selectedBatchSummary?.mainRiskText || (mainRisks.length > 0 ? `当前主要风险：${mainRisks.join('，')}` : '当前无明显 GAP 风险，保持渠道节奏'))
  };
}

function buildOverviewInsights({ progress, trainingDetails = [], selfSourcingEfficiency = [] }) {
  const overall = progress.overall || {};
  const overallEfficiency = selfSourcingEfficiency.find((item) => item.stage === '整体') || {
    recruiterCount: 0,
    efficiency: '0.0'
  };
  const probationEfficiency = selfSourcingEfficiency.find((item) => item.stage === '试用期') || {
    recruiterCount: 0,
    trainingCount: 0,
    efficiency: '0.0'
  };
  const formalEfficiency = selfSourcingEfficiency.find((item) => item.stage === '正式期') || {
    recruiterCount: 0,
    trainingCount: 0,
    efficiency: '0.0'
  };
  const cutoffAchievementRate = overall.cutoffTarget > 0
    ? overall.actualTraining / overall.cutoffTarget
    : 0;
  const overallRiskStatus = getCutoffTargetStatus(overall);
  const actualTotal = overall.actualTraining || 0;
  const channelShares = CHANNEL_DISPLAY_ORDER.map((channel) => {
    const source = (progress.channels || []).find((item) => item.channel === channel) || {
      monthlyTarget: 0,
      actualTraining: 0
    };
    const share = actualTotal > 0 ? source.actualTraining / actualTotal : 0;

    return {
      channel,
      monthlyTarget: source.monthlyTarget,
      actualTraining: source.actualTraining,
      share,
      shareText: formatPercent(share)
    };
  });
  const baseAchievements = (progress.bases || [])
    .map((base) => {
      const total = base.channelRows.find((row) => row.channel === '合计') || {
        monthlyTarget: 0,
        cutoffTarget: 0,
        actualTraining: 0,
        gap: 0,
        achievementRate: 0,
        achievementRateText: '0.00%'
      };
      const status = getCutoffTargetStatus(total);

      return {
        base: base.base,
        monthlyTarget: total.monthlyTarget,
        cutoffTarget: total.cutoffTarget,
        actualTraining: total.actualTraining,
        gap: total.gap,
        achievementRate: total.achievementRate,
        achievementRateText: total.achievementRateText,
        status,
        statusText: getStatusText(status)
      };
    })
    .filter((base) => base.monthlyTarget > 0 || base.actualTraining > 0)
    .sort(sortBaseAchievements);
  const socialChannelMap = new Map();
  trainingDetails
    .filter((employee) => employee.channelType === '渠道社招')
    .forEach((employee) => {
      const channelName = toText(employee.channelName) || '未填写渠道名称';
      const base = toText(employee.base) || '未填写基地';
      if (!socialChannelMap.has(channelName)) {
        socialChannelMap.set(channelName, {
          channelName,
          total: 0,
          bases: new Map()
        });
      }
      const item = socialChannelMap.get(channelName);
      item.total += 1;
      item.bases.set(base, (item.bases.get(base) || 0) + 1);
    });
  const socialChannelTop3 = Array.from(socialChannelMap.values())
    .map((item) => {
      const baseBreakdown = Array.from(item.bases.entries())
        .map(([base, count]) => ({ base, count }))
        .sort((left, right) => {
          if (left.count !== right.count) {
            return right.count - left.count;
          }
          return left.base.localeCompare(right.base, 'zh-Hans-CN');
        });

      return {
        channelName: item.channelName,
        total: item.total,
        baseBreakdown,
        baseBreakdownText: baseBreakdown.map((base) => `${base.base}${base.count}`).join('、')
      };
    })
    .sort((left, right) => {
      if (left.total !== right.total) {
        return right.total - left.total;
      }
      return left.channelName.localeCompare(right.channelName, 'zh-Hans-CN');
    })
    .slice(0, 3);
  const riskBases = baseAchievements
    .filter((base) => base.status === 'risk')
    .sort((left, right) => {
      if (left.gap !== right.gap) {
        return left.gap - right.gap;
      }
      return left.achievementRate - right.achievementRate;
    });
  const overallEfficiencySummary = selfSourcingEfficiency.find((item) => item.stage === '整体') || {};
  const riskBaseText = riskBases.slice(0, 3)
    .map((base) => `${base.base}${base.achievementRateText}`)
    .join('、') || '暂无风险基地';
  const largestGapBase = riskBases[0];
  const operationsSummary = {
    text: `当月达成进度：本月目标${overall.monthlyTarget || 0}，截止目标${overall.cutoffTarget || 0}，当前已入培${overall.actualTraining || 0}，达成率${overall.achievementRateText || '0.00%'}，GAP ${overall.gap || 0}；未达成基地${riskBases.length}个（${riskBaseText}）；自主社招占比${overall.selfSourcingShareText || '0.00%'}，整体人效${overallEfficiencySummary.efficiency || '0.0'}。`,
    riskBases: riskBases.slice(0, 5),
    suggestions: [
      largestGapBase ? `优先跟进${largestGapBase.base}，当前GAP ${largestGapBase.gap}，建议进入基地风险分析确认卡点。` : '当前无风险基地，建议保持日常监控。',
      socialChannelTop3[0] ? `关注渠道社招主力供应商${socialChannelTop3[0].channelName}的交付质量和7天留存。` : '渠道社招暂无明显集中供应商，建议继续观察渠道结构。',
      '对自主社招团队同时看入培人效和满7天人效，避免只追数量忽略留存质量。'
    ]
  };

  return {
    cards: {
      targetAchievementRateText: overall.achievementRateText || formatPercent(overall.achievementRate || 0),
      selfSourcingShareText: overall.selfSourcingShareText || '0.00%',
      selfSourcingEfficiency: overallEfficiency.sevenDayEfficiency || '0.0',
      recruiterTeamSize: overallEfficiency.recruiterCount
    },
    overallRisk: {
      monthlyTarget: overall.monthlyTarget || 0,
      cutoffTarget: overall.cutoffTarget || 0,
      actualTraining: overall.actualTraining || 0,
      gap: overall.gap || 0,
      achievementRate: overall.achievementRate || 0,
      achievementRateText: overall.achievementRateText || '0.00%',
      cutoffAchievementRate,
      cutoffAchievementRateText: formatPercent(cutoffAchievementRate),
      status: overallRiskStatus,
      statusText: getStatusText(overallRiskStatus)
    },
    baseAchievements,
    channelShares,
    socialChannelTop3,
    selfSourcingEfficiency: [overallEfficiency, probationEfficiency, formalEfficiency],
    operationsSummary
  };
}

async function getDashboardOverview(query = {}) {
  const [frontlineEmployees, recruiters] = await Promise.all([
    listAllOrgTableFrontlineEmployees(),
    listAllOrgTableRecruiters()
  ]);
  const employees = [...frontlineEmployees, ...recruiters];
  const progress = await getTargetProgress(query, employees);
  const yearMonth = progress.yearMonth;
  const asOfDate = progress.cutoffDate;
  const filters = {
    base: toText(query.base),
    channel: toText(query.channel),
    status: toText(query.status),
    recruiter: toText(query.recruiter)
  };
  const overviewTab = normalizeOverviewTab(query.tab);
  const selectedFromQuery = {
    base: toText(query.selectedBase),
    channel: toText(query.selectedChannel),
    selectedBatchDay: toText(query.selectedBatchDay)
  };

  const [targets, interviews, selfSourcingEfficiency, options] = await Promise.all([
    yearMonth ? listTargetsByMonth(yearMonth) : [],
    (overviewTab === 'base' || overviewTab === 'self') && yearMonth
      ? listAllInterviewRecords({ yearMonth })
      : [],
    getSelfSourcingEfficiency({
      yearMonth,
      cutoffDate: asOfDate,
      recruiter: filters.recruiter
    }, employees),
    getDistinctTargetFilterOptions({
      yearMonth,
      base: filters.base
    })
  ]);

  const details = getTrainingDetails({
    yearMonth,
    cutoffDate: asOfDate,
    base: filters.base,
    channel: filters.channel
  }, employees);
  const selfSourcingCount = details.filter((item) => item.channelType === '自主社招').length;
  const overallEfficiency = selfSourcingEfficiency.find((item) => item.stage === '整体');
  const overviewInsights = buildOverviewInsights({
    progress,
    trainingDetails: details,
    selfSourcingEfficiency
  });
  const matrix = overviewTab === 'base' ? buildDashboardMatrix(progress, filters) : { channels: [], rows: [] };
  const batchMatrix = overviewTab === 'base'
    ? buildBatchMatrix({
      yearMonth,
      matrix,
      targets,
      employees,
      interviews,
      filters,
      asOfDate
    })
    : { columns: [], rows: [], summary: { risk: 0, warning: 0, achieved: 0, empty: 0 }, riskItems: [] };
  const defaultBase = overviewTab === 'base'
    ? (filters.base || selectedFromQuery.base || pickLargestRiskBase(progress))
    : '';
  const defaultCell = overviewTab === 'base'
    ? findDefaultMatrixSelection(batchMatrix, defaultBase)
    : { base: '', channel: '', selectedBatchDay: '' };
  const selectedCell = {
    base: selectedFromQuery.base || defaultBase || defaultCell.base,
    channel: selectedFromQuery.channel || defaultCell.channel,
    selectedBatchDay: selectedFromQuery.selectedBatchDay || defaultCell.selectedBatchDay
  };
  if (overviewTab === 'base') {
    filters.base = filters.base || selectedCell.base;
  }
  const positionBoard = overviewTab === 'base'
    ? buildPositionChannelBoard({
      progress,
      batchMatrix,
      selectedBase: filters.base || selectedCell.base,
      selectedBatchDay: selectedCell.selectedBatchDay,
      employees,
      interviews,
      asOfDate,
      yearMonth
    })
    : undefined;
  const selfSourcingDetails = overviewTab === 'self'
    ? filterSelfSourcingTrainingDetails(details, {
      recruiter: filters.recruiter
    })
    : [];
  const selfSourcingRecruiterRows = overviewTab === 'self'
    ? buildSelfSourcingRecruiterRows({
      yearMonth,
      asOfDate,
      employees,
      interviews,
      filters: {
        recruiter: filters.recruiter
      }
    })
    : [];
  const selfSourcingRecruiterOptions = overviewTab === 'self'
    ? getSelfSourcingRecruitersForMonth(employees, yearMonth)
      .sort((left, right) => {
        const leftStatus = getRecruiterDisplayStatus(left, asOfDate);
        const rightStatus = getRecruiterDisplayStatus(right, asOfDate);
        const statusWeight = { 在职: 0, 离职: 1 };
        const statusDiff = (statusWeight[leftStatus] ?? 9) - (statusWeight[rightStatus] ?? 9);
        if (statusDiff !== 0) {
          return statusDiff;
        }
        return left.name.localeCompare(right.name, 'zh-Hans-CN');
      })
      .map((recruiter) => recruiter.name)
    : [];

  const batches = overviewTab === 'base'
    ? buildBatchDrilldown({
      yearMonth,
      base: selectedCell.base,
      channel: selectedCell.channel,
      targets,
      employees,
      interviews,
      asOfDate
    })
    : [];
  const selectedBatchDay = selectedCell.selectedBatchDay === 'total'
    ? 'total'
    : Number(selectedCell.selectedBatchDay || batches[0]?.day || 0);

  return {
    ...progress,
    topMetrics: {
      ...progress.overall,
      selfSourcingEfficiency: overallEfficiency ? overallEfficiency.efficiency : '0.0',
      selfSourcingShare: progress.overall.actualTraining > 0
        ? selfSourcingCount / progress.overall.actualTraining
        : 0
    },
    trainingDetails: details,
    selfSourcingDetails,
    selfSourcingRecruiterRows,
    selfSourcingRecruiterOptions,
    selfSourcingEfficiency,
    overviewInsights,
    overviewTab,
    filters,
    options,
    matrix,
    batchMatrix,
    positionBoard,
    selectedCell,
    selectedBatchDay,
    selectedBatch: batches.find((batch) => batch.day === selectedBatchDay) || batches[0],
    selectedMatrixDetail: findSelectedMatrixDetail(batchMatrix, {
      ...selectedCell,
      selectedBatchDay
    }),
    batches,
    monthLastDate: yearMonth ? buildDate(yearMonth, getMonthLastDay(yearMonth)) : ''
  };
}

module.exports = {
  buildBatchDrilldown,
  buildBatchMatrix,
  buildDashboardMatrix,
  buildOverviewInsights,
  buildPositionChannelBoard,
  buildSelfSourcingEfficiency,
  buildSelfSourcingRecruiterRows,
  buildSelfSourcingRecruiterOptions,
  filterSelfSourcingTrainingDetails,
  normalizeOverviewTab,
  getDashboardOverview,
  getTrainingDetails,
  getSelfSourcingEfficiency
};