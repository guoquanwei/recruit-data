const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { connectDatabase, closeDatabase } = require('../config/database');
const { importActiveEmployees, importResignedEmployees } = require('../service/employees/importer');
const { buildEmployeeImportTemplateWorkbook } = require('../service/employees/importTemplate');
const { getEmployeeList } = require('../service/employees/service');
const { importInterviewRecords } = require('../service/interviews/importer');
const { buildInterviewImportTemplateWorkbook } = require('../service/interviews/importTemplate');
const { getInterviewFunnel } = require('../service/interviews/service');
const { importMonthlyTargets } = require('../service/targets/importer');
const { buildTargetImportTemplateWorkbook } = require('../service/targets/importTemplate');
const { getTargetProgress } = require('../service/targets/service');
const { getSystemDataFile } = require('../service/systemData');

function assertSuccess(label, result) {
  if (result.status !== 'success') {
    throw new Error(`${label} failed: ${result.errorSummary}`);
  }

  console.log(`${label}: ${result.successCount} rows`);
}

async function resolveWorkbookPath(preferredPath, fallbackName, workbookFactory, tempDir) {
  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  const fallbackPath = path.join(tempDir, fallbackName);
  await workbookFactory().xlsx.writeFile(fallbackPath);
  return fallbackPath;
}

async function main() {
  await connectDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recruit-data-samples-'));

  try {
    const activePath = await resolveWorkbookPath(
      getSystemDataFile('active-employees').absolutePath,
      'active-employees.xlsx',
      () => buildEmployeeImportTemplateWorkbook('active'),
      tempDir
    );
    const resignedPath = await resolveWorkbookPath(
      getSystemDataFile('resigned-employees').absolutePath,
      'resigned-employees.xlsx',
      () => buildEmployeeImportTemplateWorkbook('resigned'),
      tempDir
    );
    const targetsPath = await resolveWorkbookPath(
      getSystemDataFile('target-2026-05').absolutePath,
      'monthly-targets.xlsx',
      buildTargetImportTemplateWorkbook,
      tempDir
    );
    const interviewsPath = await resolveWorkbookPath(
      getSystemDataFile('interviews').absolutePath,
      'interviews.xlsx',
      buildInterviewImportTemplateWorkbook,
      tempDir
    );

    assertSuccess('active employees', await importActiveEmployees(activePath));
    assertSuccess('resigned employees', await importResignedEmployees(resignedPath));
    const targetResult = await importMonthlyTargets(targetsPath);
    assertSuccess('monthly targets', targetResult);
    assertSuccess('interview records', await importInterviewRecords(interviewsPath, 'full_overwrite'));

    const recruiters = (await getEmployeeList({}, 'recruiter')).total;
    const frontline = (await getEmployeeList({}, 'frontline')).total;
    const progress = (await getTargetProgress({ yearMonth: targetResult.yearMonth })).overall;
    const funnel = await getInterviewFunnel();

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
    fs.rmSync(tempDir, { recursive: true, force: true });
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
