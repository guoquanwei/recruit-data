const { connectDatabase, closeDatabase } = require('../config/database');
const { importActiveEmployees, importResignedEmployees } = require('../service/employees/importer');
const { getEmployeeList } = require('../service/employees/service');
const { importInterviewRecords } = require('../service/interviews/importer');
const { getInterviewFunnel } = require('../service/interviews/service');
const { importMonthlyTargets } = require('../service/targets/importer');
const { getTargetProgress } = require('../service/targets/service');

function assertSuccess(label, result) {
  if (result.status !== 'success') {
    throw new Error(`${label} failed: ${result.errorSummary}`);
  }

  console.log(`${label}: ${result.successCount} rows`);
}

async function main() {
  connectDatabase();

  try {
    assertSuccess('active employees', await importActiveEmployees('在职员工信息_20260627.xlsx'));
    assertSuccess('resigned employees', await importResignedEmployees('离职员工信息_20260627.xlsx'));
    assertSuccess('monthly targets', await importMonthlyTargets('docs/2026年月度招聘目标/人才开发目标拆解-5月-0622.xlsx'));
    assertSuccess('interview records', await importInterviewRecords('docs/面试记录_0625.xlsx', 'full_overwrite'));

    const recruiters = getEmployeeList({}, 'recruiter').total;
    const frontline = getEmployeeList({}, 'frontline').total;
    const progress = getTargetProgress({ yearMonth: '2026-05' }).overall;
    const funnel = getInterviewFunnel();

    if (recruiters <= 0 || frontline <= 0) {
      throw new Error('employee list verification failed');
    }

    if (progress.monthlyTarget <= 0) {
      throw new Error('target progress verification failed');
    }

    if (funnel.feedbackResults.length === 0) {
      throw new Error('interview funnel verification failed');
    }

    console.log(`recruiters: ${recruiters}`);
    console.log(`frontline employees: ${frontline}`);
    console.log(`target progress: ${JSON.stringify(progress)}`);
    console.log(`feedback results: ${JSON.stringify(funnel.feedbackResults)}`);
  } finally {
    closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
