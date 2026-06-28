const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const runtime = require('../config/runtime');
const { importActiveEmployees, importResignedEmployees } = require('../service/employees/importer');
const { getEmployeeList } = require('../service/employees/service');
const { importInterviewRecords } = require('../service/interviews/importer');
const { getInterviewFunnel, getInterviewList } = require('../service/interviews/service');
const { getDashboardOverview } = require('../service/dashboard/service');
const { importMonthlyTargets } = require('../service/targets/importer');
const { getTargetList, getTargetProgress } = require('../service/targets/service');

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

router.post('/targets/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.redirect('/targets?error=请选择要导入的文件');
    return;
  }
  redirectWithResult(res, '/targets', await importMonthlyTargets(req.file.path));
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
  redirectWithResult(res, '/interviews/import', await importInterviewRecords(req.file.path, req.body.mode));
});

router.get('/interviews', (req, res) => {
  renderPage(res, 'pages/interviews/list', {
    active: 'interviews-list',
    moduleActive: 'interviews',
    pageTitle: '面试记录列表',
    result: getInterviewList(req.query)
  });
});

router.get('/interviews/funnel', (req, res) => {
  renderPage(res, 'pages/interviews/funnel', {
    active: 'interviews-funnel',
    moduleActive: 'interviews',
    pageTitle: '招聘漏斗分析',
    funnel: getInterviewFunnel()
  });
});

router.get('/dashboard/overview', (req, res) => {
  renderPage(res, 'pages/dashboard/overview', {
    active: 'dashboard-overview',
    moduleActive: 'dashboard',
    pageTitle: '招聘负责人看板',
    dashboard: getDashboardOverview(req.query)
  });
});

router.get('/dashboard/base-risk', (req, res) => {
  renderPage(res, 'pages/dashboard/base-risk', {
    active: 'dashboard-base-risk',
    moduleActive: 'dashboard',
    pageTitle: '基地风险分析',
    dashboard: getDashboardOverview(req.query)
  });
});

router.get('/dashboard/self-sourcing', (req, res) => {
  renderPage(res, 'pages/dashboard/self-sourcing', {
    active: 'dashboard-self-sourcing',
    moduleActive: 'dashboard',
    pageTitle: '自主社招人效',
    dashboard: getDashboardOverview(req.query)
  });
});

router.get('/candidates', (req, res) => res.redirect('/employees/frontline'));
router.get('/progress', (req, res) => res.redirect('/targets/progress'));
router.get('/channels', (req, res) => res.redirect('/dashboard/overview'));
router.get('/settings', (req, res) => res.redirect('/employees/import'));

module.exports = router;
