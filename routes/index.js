const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const runtime = require('../config/runtime');
const { importActiveEmployees, importResignedEmployees } = require('../service/employees/importer');
const { getEmployeeExportRows, getEmployeeList } = require('../service/employees/service');
const { sendCsv } = require('../service/export/csv');
const { importInterviewRecords } = require('../service/interviews/importer');
const { getInterviewExportRows, getInterviewFunnel, getInterviewList } = require('../service/interviews/service');
const { getDashboardOverview } = require('../service/dashboard/service');
const { importMonthlyTargets } = require('../service/targets/importer');
const { getTargetExportRows, getTargetList, getTargetProgress } = require('../service/targets/service');

const router = express.Router();
const uploadDir = path.join(runtime.appRoot, 'data', 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

function renderPage(res, view, data) {
  res.render(view, {
    notice: '',
    error: '',
    ...data
  });
}

function redirectWithResult(res, pathName, result) {
  const params = new URLSearchParams();
  if (result.status === 'success') {
    params.set('notice', `导入成功：${result.successCount || 0} 行`);
  } else {
    params.set('error', result.errorSummary || '导入失败');
  }
  res.redirect(`${pathName}?${params.toString()}`);
}

function cleanupUploadedFile(file) {
  if (!file?.path) {
    return;
  }

  fs.rm(file.path, { force: true }, (error) => {
    if (error) {
      console.warn(`上传临时文件删除失败：${file.path}`, error);
    }
  });
}

function employeeExportColumns(frontline = false) {
  const columns = [
    { header: '工号', value: (row) => row.employeeNo },
    { header: '姓名', value: (row) => row.name },
    { header: '在职状态', value: (row) => row.employeeStatus },
    { header: '所属基地', value: (row) => row.base },
    { header: '职位', value: (row) => row.position },
    { header: '招聘渠道类型', value: (row) => row.channelType },
    { header: '招聘渠道名称', value: (row) => row.channelName },
    { header: '办公地点', value: (row) => row.officeLocation },
    { header: '入培日期', value: (row) => row.trainingDate },
    { header: '离职日期', value: (row) => row.resignedDate },
    { header: '手机号', value: (row) => row.maskedPhone }
  ];

  if (!frontline) {
    return columns;
  }

  return [columns[3], columns[0], columns[1], columns[2], ...columns.slice(4)];
}

function targetExportColumns() {
  return [
    { header: '月份', value: (row) => row.yearMonth },
    { header: '基地', value: (row) => row.base },
    { header: '渠道', value: (row) => row.channel },
    { header: '订单类型', value: (row) => row.orderType },
    { header: '月度目标', value: (row) => row.progress.monthlyTarget },
    { header: '截止目标', value: (row) => row.progress.cutoffTarget },
    { header: '实际入培', value: (row) => row.progress.actualTraining },
    { header: 'GAP', value: (row) => row.progress.gap },
    { header: '达成率', value: (row) => row.progress.achievementRateText }
  ];
}

function interviewExportColumns() {
  return [
    { header: '基地', value: (row) => row.base },
    { header: '职位名称', value: (row) => row.positionName },
    { header: '候选人', value: (row) => row.candidateName },
    { header: '性别', value: (row) => row.gender },
    { header: '电话', value: (row) => row.maskedPhone },
    { header: '反馈日期', value: (row) => row.feedbackDate },
    { header: '反馈结果', value: (row) => row.feedbackResult },
    { header: '面试官', value: (row) => row.interviewer },
    { header: '招聘渠道', value: (row) => row.channelType },
    { header: '渠道名称', value: (row) => row.channelName },
    { header: '内推人', value: (row) => row.referrer },
    { header: '综合评价', value: (row) => row.evaluation }
  ];
}

router.get('/', (req, res) => {
  res.redirect('/dashboard/overview');
});

router.get('/employees/import', (req, res) => {
  renderPage(res, 'pages/employees/import', {
    active: 'employees-import',
    moduleActive: 'employees',
    pageTitle: '全量数据导入',
    notice: req.query.notice,
    error: req.query.error
  });
});

router.post('/employees/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.redirect('/employees/import?error=请选择要导入的文件');
    return;
  }
  const type = req.body.type;
  const result = type === 'resigned'
    ? await importResignedEmployees(req.file.path)
    : await importActiveEmployees(req.file.path);
  cleanupUploadedFile(req.file);
  redirectWithResult(res, '/employees/import', result);
});

router.get('/employees/recruiters', (req, res) => {
  renderPage(res, 'pages/employees/list', {
    active: 'employees-recruiters',
    moduleActive: 'employees',
    pageTitle: '招聘专员列表',
    heading: '招聘专员列表',
    role: 'recruiter',
    result: getEmployeeList(req.query, 'recruiter')
  });
});

router.get('/employees/recruiters/export', (req, res) => {
  sendCsv(res, '招聘专员列表.csv', employeeExportColumns(), getEmployeeExportRows(req.query, 'recruiter'));
});

router.get('/employees/frontline', (req, res) => {
  renderPage(res, 'pages/employees/list', {
    active: 'employees-frontline',
    moduleActive: 'employees',
    pageTitle: '一线员工列表',
    heading: '一线员工列表',
    role: 'frontline',
    result: getEmployeeList(req.query, 'frontline')
  });
});

router.get('/employees/frontline/export', (req, res) => {
  sendCsv(res, '一线员工列表.csv', employeeExportColumns(true), getEmployeeExportRows(req.query, 'frontline'));
});

router.post('/targets/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.redirect('/targets?error=请选择要导入的文件');
    return;
  }
  const result = await importMonthlyTargets(req.file.path);
  cleanupUploadedFile(req.file);
  redirectWithResult(res, '/targets', result);
});

router.get('/targets', (req, res) => {
  renderPage(res, 'pages/targets/list', {
    active: 'targets-list',
    moduleActive: 'targets',
    pageTitle: '目标列表',
    result: getTargetList(req.query),
    notice: req.query.notice,
    error: req.query.error
  });
});

router.get('/targets/export', (req, res) => {
  sendCsv(res, '目标列表.csv', targetExportColumns(), getTargetExportRows(req.query));
});

router.get('/targets/progress', (req, res) => {
  renderPage(res, 'pages/targets/progress', {
    active: 'targets-progress',
    moduleActive: 'targets',
    pageTitle: '目标达成进度',
    progress: getTargetProgress(req.query)
  });
});

router.get('/interviews/import', (req, res) => {
  renderPage(res, 'pages/interviews/import', {
    active: 'interviews-import',
    moduleActive: 'interviews',
    pageTitle: '面试记录导入',
    notice: req.query.notice,
    error: req.query.error
  });
});

router.post('/interviews/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.redirect('/interviews/import?error=请选择要导入的文件');
    return;
  }
  const result = await importInterviewRecords(req.file.path, req.body.mode);
  cleanupUploadedFile(req.file);
  redirectWithResult(res, '/interviews/import', result);
});

router.get('/interviews', (req, res) => {
  renderPage(res, 'pages/interviews/list', {
    active: 'interviews-list',
    moduleActive: 'interviews',
    pageTitle: '面试记录列表',
    result: getInterviewList(req.query)
  });
});

router.get('/interviews/export', (req, res) => {
  sendCsv(res, '面试记录列表.csv', interviewExportColumns(), getInterviewExportRows(req.query));
});

router.get('/interviews/funnel', (req, res) => {
  renderPage(res, 'pages/interviews/funnel', {
    active: 'interviews-funnel',
    moduleActive: 'interviews',
    pageTitle: '招聘漏斗分析',
    funnel: getInterviewFunnel(req.query)
  });
});

router.get('/dashboard/overview', (req, res) => {
  renderPage(res, 'pages/dashboard/overview', {
    active: 'dashboard-overview',
    moduleActive: 'dashboard',
    pageTitle: '人才开发运营看板',
    dashboard: getDashboardOverview(req.query)
  });
});

router.get('/dashboard/base-risk', (req, res) => {
  renderPage(res, 'pages/dashboard/base-risk', {
    active: 'dashboard-base-risk',
    moduleActive: 'dashboard',
    pageTitle: '基地风险分析',
    dashboard: getDashboardOverview({ ...req.query, tab: 'base' })
  });
});

router.get('/dashboard/self-sourcing', (req, res) => {
  renderPage(res, 'pages/dashboard/self-sourcing', {
    active: 'dashboard-self-sourcing',
    moduleActive: 'dashboard',
    pageTitle: '自主社招人效',
    dashboard: getDashboardOverview({ ...req.query, tab: 'self' })
  });
});

router.get('/candidates', (req, res) => res.redirect('/employees/frontline'));
router.get('/progress', (req, res) => res.redirect('/targets/progress'));
router.get('/channels', (req, res) => res.redirect('/dashboard/overview'));
router.get('/settings', (req, res) => res.redirect('/employees/import'));

module.exports = router;
