const { listAllEmployees } = require('../employees/repository');
const { maskPhone, toText } = require('../shared/format');
const { getTargetProgress } = require('../targets/service');

function calculateWorkDaysInMonth(employee, yearMonth) {
  if (!employee.entryDate || !employee.entryDate.startsWith(yearMonth)) {
    return 0;
  }

  return 1;
}

function getTrainingDetails(query = {}) {
  const yearMonth = toText(query.yearMonth);
  return listAllEmployees()
    .filter((employee) => !yearMonth || employee.trainingDate.startsWith(yearMonth))
    .map((employee) => ({
      base: employee.base,
      employeeNo: employee.employeeNo,
      name: employee.name,
      maskedPhone: maskPhone(employee.phone),
      channelType: employee.channelType,
      channelName: employee.channelName,
      trainingDate: employee.trainingDate,
      employeeStatus: employee.employeeStatus,
      resignedDate: employee.resignedDate,
      workDaysInMonth: calculateWorkDaysInMonth(employee, yearMonth)
    }));
}

function getSelfSourcingEfficiency(query = {}) {
  const yearMonth = toText(query.yearMonth);
  const employees = listAllEmployees();
  const recruiters = employees.filter((employee) => employee.position === '招聘专员');
  const selfSourcingEmployees = employees.filter((employee) => (
    employee.channelType === '自主社招'
      && (!yearMonth || employee.trainingDate.startsWith(yearMonth))
  ));
  const summary = {
    probation: { stage: '试用期', recruiterCount: 0, trainingCount: 0, sevenDayCount: 0 },
    formal: { stage: '正式期', recruiterCount: 0, trainingCount: 0, sevenDayCount: 0 },
    overall: { stage: '整体', recruiterCount: recruiters.length, trainingCount: selfSourcingEmployees.length, sevenDayCount: 0 }
  };

  recruiters.forEach((recruiter) => {
    const entryYearMonth = recruiter.entryDate ? recruiter.entryDate.slice(0, 7) : '';
    const stage = entryYearMonth && yearMonth && entryYearMonth <= yearMonth ? 'formal' : 'probation';
    summary[stage].recruiterCount += 1;
  });

  selfSourcingEmployees.forEach((employee) => {
    const recruiterName = toText(employee.channelName).split('+')[0];
    const recruiter = recruiters.find((item) => item.name === recruiterName);
    const stage = recruiter && recruiter.entryDate && yearMonth && recruiter.entryDate.slice(0, 7) <= yearMonth ? 'formal' : 'probation';
    summary[stage].trainingCount += 1;
    summary.overall.sevenDayCount += 1;
    summary[stage].sevenDayCount += 1;
  });

  return Object.values(summary).map((item) => ({
    ...item,
    efficiency: item.recruiterCount > 0 ? (item.trainingCount / item.recruiterCount).toFixed(1) : '0.0'
  }));
}

function getDashboardOverview(query = {}) {
  const progress = getTargetProgress(query);
  const yearMonth = progress.yearMonth;
  const details = getTrainingDetails({ yearMonth });
  const selfSourcingCount = details.filter((item) => item.channelType === '自主社招').length;
  const selfSourcingEfficiency = getSelfSourcingEfficiency({ yearMonth });
  const overallEfficiency = selfSourcingEfficiency.find((item) => item.stage === '整体');

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
    selfSourcingEfficiency
  };
}

module.exports = {
  getDashboardOverview,
  getTrainingDetails,
  getSelfSourcingEfficiency
};
