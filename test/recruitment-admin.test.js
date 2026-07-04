const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../server');
const { makeUniqueHeaders } = require('../service/imports/excel');
const { buildCsv } = require('../service/export/csv');
const { getEmployeeImportTemplateConfig, buildEmployeeImportTemplateWorkbook } = require('../service/employees/importTemplate');
const { getTargetImportTemplateConfig, buildTargetImportTemplateWorkbook } = require('../service/targets/importTemplate');
const { getInterviewImportTemplateConfig, buildInterviewImportTemplateWorkbook } = require('../service/interviews/importTemplate');
const { importInterviewRecords } = require('../service/interviews/importer');
const { buildEmployeeFilters, formatBaseOptions, replaceEmployeesBySource } = require('../service/employees/repository');
const { buildInterviewFilters, insertInterviewRecords } = require('../service/interviews/repository');
const { formatDistinctTargetFilterOptions, replaceTargetsByMonth } = require('../service/targets/repository');
const { maskPhone, parsePage, formatPercent } = require('../service/shared/format');
const { inferBase, isRecruiterEmployee, normalizeActiveEmployee, normalizeResignedEmployee } = require('../service/employees/normalize');
const { calculateTargetProgress } = require('../service/targets/progress');
const { getCutoffDate, includeActualOnlyTargets, summarizeTargetPlan, summarizeTargets } = require('../service/targets/service');
const { buildBatchDrilldown, buildBatchMatrix, buildDashboardMatrix, buildOverviewInsights, buildPositionChannelBoard, buildSelfSourcingEfficiency, buildSelfSourcingRecruiterOptions, buildSelfSourcingRecruiterRows, filterSelfSourcingTrainingDetails, getTrainingDetails, normalizeOverviewTab } = require('../service/dashboard/service');
const { inferInterviewBase, normalizeInterviewRecord, resolveInterviewOverwriteDates } = require('../service/interviews/normalize');
const { buildFunnelRows, buildMonthlyFunnelRows } = require('../service/interviews/service');
const { initializeAiModelConfig, getAiModelConfig, maskAiModelConfig } = require('../config/ai');

function loadRuntimeWithEnv(env) {
  const runtimePath = require.resolve('../config/runtime');
  const previousEnv = { ...process.env };
  delete require.cache[runtimePath];
  Object.assign(process.env, env);

  try {
    return require('../config/runtime');
  } finally {
    process.env = previousEnv;
    delete require.cache[runtimePath];
  }
}

async function requestApp(pathName) {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathName}`);
    const text = await response.text();
    return { response, text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('shared formatting masks phone numbers and parses pagination defaults', () => {
  assert.equal(maskPhone('13915993720'), '139****3720');
  assert.equal(maskPhone(''), '');
  assert.deepEqual(parsePage({}), { page: 1, pageSize: 10, limit: 10, offset: 0 });
  assert.equal(formatPercent(0.875), '87.50%');
  assert.equal(formatPercent(null), '0.00%');
});

test('runtime exposes PostgreSQL database url and removes SQLite config', () => {
  const runtime = loadRuntimeWithEnv({
    DATABASE_URL: 'postgresql://team_030_user:secret@localhost:5432/team_030',
    PORT: '4000'
  });

  assert.equal(runtime.port, 4000);
  assert.equal(runtime.databaseUrl, 'postgresql://team_030_user:secret@localhost:5432/team_030');
  assert.equal(Object.hasOwn(runtime, 'sqlite'), false);
});

test('AI model config loads active provider into process globals and masks api key', async () => {
  const database = {
    async query(sql, params) {
      assert.match(sql, /FROM ai_model_configs/);
      assert.deepEqual(params, ['doubao']);
      return {
        rows: [{
          provider: 'doubao',
          base_url: 'https://ark.cn-beijing.volces.com/api/v3',
          api_key: 'secret-key-value',
          endpoint: 'ep-test'
        }]
      };
    }
  };

  const config = await initializeAiModelConfig(database, 'doubao');

  assert.deepEqual(config, {
    provider: 'doubao',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'secret-key-value',
    endpoint: 'ep-test'
  });
  assert.equal(getAiModelConfig().endpoint, 'ep-test');
  assert.equal(global.aiModelConfig.endpoint, 'ep-test');
  assert.equal(maskAiModelConfig(config).apiKey, 'se************ue');
});

test('excel helper keeps duplicate headers addressable like spreadsheet tools', () => {
  assert.deepEqual(
    makeUniqueHeaders(['部门', '职位', '姓名', '部门', '职位']),
    ['部门', '职位', '姓名', '部门.1', '职位.1']
  );
});

test('employee import templates match required sheet names and column headers', async () => {
  const activeConfig = getEmployeeImportTemplateConfig('active');
  assert.equal(activeConfig.sheetName, '在职员工信息');
  assert.deepEqual(activeConfig.headers.slice(0, 10), [
    '工号',
    '姓名',
    '入培时间',
    '手机号码',
    '招聘渠道',
    '渠道名称',
    '办公地点',
    '部门',
    '职位',
    '员工状态'
  ]);

  const resignedConfig = getEmployeeImportTemplateConfig('resigned');
  assert.equal(resignedConfig.sheetName, '离职员工信息');
  assert.deepEqual(resignedConfig.headers.slice(0, 10), [
    '工号',
    '姓名',
    '入培时间',
    '手机号码',
    '招聘渠道',
    '渠道名称',
    '办公地点',
    '离职前部门',
    '离职前职位',
    '离职日期'
  ]);

  const workbook = buildEmployeeImportTemplateWorkbook('resigned');
  const sheet = workbook.getWorksheet('离职员工信息');
  assert.ok(sheet);
  assert.equal(sheet.getRow(1).getCell(1).value, '工号');
  assert.equal(sheet.getRow(2).getCell(10).value, '2026-06-30');
});

test('target and interview import templates match required sheets and columns', () => {
  const targetConfig = getTargetImportTemplateConfig();
  assert.equal(targetConfig.sheetName, '整体目标');
  assert.deepEqual(targetConfig.headers.slice(0, 8), [
    '年月份',
    '基地',
    '渠道',
    '招聘订单类型',
    '7天留存率目标',
    '15天留存率目标',
    '30天留存率目标',
    '招聘目标'
  ]);
  assert.equal(buildTargetImportTemplateWorkbook().getWorksheet('整体目标').getRow(2).getCell(1).value, '2026-06');

  const interviewConfig = getInterviewImportTemplateConfig();
  assert.equal(interviewConfig.sheetName, '面试记录');
  assert.deepEqual(interviewConfig.headers.slice(0, 7), [
    '职位名称',
    '候选人名称',
    '电话',
    '面试官填写反馈时间',
    '面试官反馈结果',
    '面试官',
    '猎头公司标签'
  ]);
  assert.equal(buildInterviewImportTemplateWorkbook().getWorksheet('面试记录').getRow(2).getCell(4).value, '2026-06-01');
});

test('interview import rejects daily append mode', async () => {
  await assert.rejects(
    () => importInterviewRecords('unused.xlsx', 'daily_append'),
    /不支持的面试记录导入模式/
  );
});

test('target import is rendered on its own page', async () => {
  const importPage = await requestApp('/targets/import');
  assert.equal(importPage.response.status, 200);
  assert.match(importPage.text, /招聘目标导入/);
  assert.match(importPage.text, /下载 Excel 模板/);
  assert.match(importPage.text, /字段规范说明/);

  const listPage = await requestApp('/targets');
  assert.doesNotMatch(listPage.text, /导入月度招聘目标 Excel/);
  assert.doesNotMatch(listPage.text, /btn[^"]*"[^>]*href="\/targets\/import"[^>]*>导入招聘目标/);
  assert.match(listPage.text, /需求总数/);
  assert.match(listPage.text, /自主社招目标/);
  assert.match(listPage.text, /内部推荐目标/);
  assert.match(listPage.text, /渠道社招目标/);
  assert.match(listPage.text, /渠道校招目标/);
  assert.match(listPage.text, /基地开班批次汇总/);
  assert.doesNotMatch(listPage.text, /<th>截止目标<\/th>/);
});

test('self sourcing page omits personal risk diagnosis column', async () => {
  const page = await requestApp('/dashboard/self-sourcing?yearMonth=2026-05');
  assert.equal(page.response.status, 200);
  assert.match(page.text, /月度7天人效/);
  assert.match(page.text, /detail-modal-table/);
  assert.doesNotMatch(page.text, /个人风险诊断/);
});

test('base risk funnel prototype renders as an isolated prototype page', async () => {
  const page = await requestApp('/prototype/base-risk-funnel');
  assert.equal(page.response.status, 200);
  assert.match(page.text, /岗位月目标/);
  assert.match(page.text, /风险批次/);
  assert.match(page.text, /5月12日批次/);
  assert.match(page.text, /GAP -8/);
  assert.match(page.text, /5月20日批次/);
  assert.match(page.text, /5月26日批次/);
  assert.match(page.text, /漏斗诊断与提升方案/);
  assert.match(page.text, /自主社招提升方案/);
  assert.doesNotMatch(page.text, /渠道社招保持现状/);
  assert.doesNotMatch(page.text, /内推保持现状/);
  assert.match(page.text, /"actionPlans"/);
  assert.match(page.text, /"mainRiskText"/);
  assert.match(page.text, /5月5日 - 5月11日每天至少完成 5 人有效到面/);

  const may20Page = await requestApp('/prototype/base-risk-funnel?selectedBatchDay=20');
  assert.equal(may20Page.response.status, 200);
  assert.match(may20Page.text, /5月13日 - 5月19日每天至少完成 2 人有效到面/);
  const may20Payload = JSON.parse(may20Page.text.match(/id="positionBatchPayload"[^>]*>([^<]+)/)[1]);
  const may20BatchPlan = may20Payload.batches.find((batch) => batch.day === 20).actionPlans
    .find((plan) => plan.title.includes('自主社招'));
  assert.match(may20BatchPlan.actions[0], /5月13日 - 5月19日/);
  const may12BatchPlan = may20Payload.batches.find((batch) => batch.day === 12).actionPlans
    .find((plan) => plan.title.includes('自主社招'));
  assert.match(may12BatchPlan.actions[0], /5月5日 - 5月11日/);

  const rpoPage = await requestApp('/prototype/base-risk-funnel?selectedBatchDay=20&channel=rpo');
  assert.equal(rpoPage.response.status, 200);
  assert.match(rpoPage.text, /渠道社招/);
  assert.match(rpoPage.text, /建议新增 1 家 RPO 供应商/);

  const achievedPage = await requestApp('/prototype/base-risk-funnel?batch=26');
  assert.equal(achievedPage.response.status, 200);
  assert.match(achievedPage.text, /目标已达成，当前不需要额外提升方案/);
});

test('csv export escapes values and includes utf8 bom', () => {
  const csv = buildCsv([
    { header: '姓名', value: (row) => row.name },
    { header: '备注', value: (row) => row.note }
  ], [
    { name: '张三', note: '包含,逗号' },
    { name: '李\"四', note: '换行\n内容' }
  ]);

  assert.equal(csv.startsWith('\uFEFF姓名,备注'), true);
  assert.equal(csv.includes('"包含,逗号"'), true);
  assert.equal(csv.includes('"李""四"'), true);
  assert.equal(csv.includes('"换行\n内容"'), true);
});

test('interview repository inserts every normalized interview field', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
  };
  const records = [{
    base: '石家庄基地',
    positionName: '客服专员',
    candidateName: '张三',
    gender: '男',
    phone: '13900000000',
    feedbackDate: '2026-06-25',
    feedbackResult: '通过',
    interviewer: '李四',
    channelType: '自主社招',
    channelName: '李四+JZ001',
    channelTag: '自主社招',
    contractName: '李四+JZ001',
    referrer: '',
    evaluation: '沟通表达良好'
  }];

  assert.equal(await insertInterviewRecords(database, records), 1);

  assert.match(calls[0].sql, /channel_name/);
  assert.match(calls[0].sql, /evaluation/);
  assert.equal(calls[0].params[9], '李四+JZ001');
  assert.equal(calls[0].params[13], '沟通表达良好');
});

test('repositories batch insert import rows to reduce database round trips', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
  };
  const employees = [
    normalizeActiveEmployee({
      工号: 'JZ101',
      姓名: '员工一',
      入培时间: '2026/06/01',
      入职日期: '2026/06/02',
      手机号码: '13900000101',
      招聘渠道: '自主社招',
      渠道名称: '张三+JZ101',
      办公地点: 'HB01-石家庄广安大厦',
      部门: '伽睿集团 / NEO-OPS / 河北基地 / 联通河北',
      职位: '客服专员',
      员工状态: '在职'
    }),
    normalizeActiveEmployee({
      工号: 'JZ102',
      姓名: '员工二',
      入培时间: '2026/06/03',
      入职日期: '2026/06/04',
      手机号码: '13900000102',
      招聘渠道: '内推',
      渠道名称: '李四',
      办公地点: 'TJ-天津基地',
      部门: '伽睿集团 / NEO-OPS / 天津基地 / 联通天津',
      职位: '客服专员',
      员工状态: '在职'
    })
  ];

  assert.equal(await replaceEmployeesBySource(database, 'active', employees), 2);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /VALUES\s*\(\$1, \$2/);
  assert.match(calls[1].sql, /\$17, \$18/);
  assert.equal(calls[1].params.length, 32);

  calls.length = 0;
  assert.equal(await replaceTargetsByMonth(database, '2026-06', [
    {
      yearMonth: '2026-06',
      base: '联通河北',
      channel: '自主社招',
      orderType: '客服专员',
      retention7Rate: 0.7,
      retention15Rate: 0.6,
      retention30Rate: 0.5,
      monthlyTarget: 10,
      dailyTargets: { '1': 1 }
    },
    {
      yearMonth: '2026-06',
      base: '联通天津',
      channel: '内推',
      orderType: '客服专员',
      retention7Rate: 0.7,
      retention15Rate: 0.6,
      retention30Rate: 0.5,
      monthlyTarget: 5,
      dailyTargets: { '1': 1 }
    }
  ]), 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.length, 18);

  calls.length = 0;
  assert.equal(await insertInterviewRecords(database, [
    {
      base: '联通河北',
      positionName: '客服专员',
      candidateName: '候选人一',
      gender: '男',
      phone: '13900000201',
      feedbackDate: '2026-06-01',
      feedbackResult: '推荐',
      interviewer: '面试官',
      channelType: '自主社招',
      channelName: '张三+JZ201',
      channelTag: '自主社招',
      contractName: '张三+JZ201',
      referrer: '',
      evaluation: ''
    },
    {
      base: '联通河北',
      positionName: '客服专员',
      candidateName: '候选人二',
      gender: '女',
      phone: '13900000202',
      feedbackDate: '2026-06-01',
      feedbackResult: '不推荐',
      interviewer: '面试官',
      channelType: '内推',
      channelName: '李四',
      channelTag: '内推',
      contractName: '李四',
      referrer: '',
      evaluation: ''
    }
  ]), 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.length, 28);
});

test('employee normalization maps active and resigned source columns to one model', () => {
  const active = normalizeActiveEmployee({
    工号: 'JZ001',
    姓名: '张三',
    入培时间: '2026/06/01',
    入职日期: '2026/06/02',
    手机号码: '13915993720',
    招聘渠道: '自主社招',
    渠道名称: '李四+JZ002',
    办公地点: 'HB01-石家庄广安大厦',
    部门: '伽睿集团 / NEO-OPS / 河北基地 / 联通河北',
    职位: '客服专员',
    员工状态: '在职'
  });

  assert.equal(active.sourceType, 'active');
  assert.equal(active.employeeStatus, '在职');
  assert.equal(active.department, '伽睿集团 / NEO-OPS / 河北基地 / 联通河北');
  assert.equal(active.position, '客服专员');

  const resigned = normalizeResignedEmployee({
    工号: 'JZ003',
    姓名: '王五',
    入培时间: '2026/06/03',
    入职日期: '2026/06/04',
    手机号码: '13800000000',
    招聘渠道: '内推',
    渠道名称: '赵六',
    办公地点: 'TJ-天津基地',
    离职前部门: '伽睿集团 - NEO-OPS - 天津基地 - 联通天津',
    离职前职位: '招聘专员',
    离职日期: '2026/06/20'
  });

  assert.equal(resigned.sourceType, 'resigned');
  assert.equal(resigned.employeeStatus, '离职');
  assert.equal(resigned.department, '伽睿集团 - NEO-OPS - 天津基地 - 联通天津');
  assert.equal(resigned.position, '招聘专员');
});

test('employee normalization uses entry date when training date is blank', () => {
  const active = normalizeActiveEmployee({
    工号: 'JZ010',
    姓名: '未入培员工',
    入培时间: '',
    入职日期: '2026/06/15',
    手机号码: '13900000010',
    招聘渠道: '自主社招',
    渠道名称: '张三+JZ010',
    办公地点: 'HB01-石家庄广安大厦',
    部门: '伽睿集团 / NEO-OPS / 河北基地 / 联通河北',
    职位: '客服专员',
    员工状态: '在职'
  });
  const resigned = normalizeResignedEmployee({
    工号: 'JZ011',
    姓名: '未入培离职员工',
    入培时间: '',
    入职日期: '2026/06/16',
    手机号码: '13900000011',
    招聘渠道: '内推',
    渠道名称: '李四',
    办公地点: 'TJ-天津基地',
    离职前部门: '伽睿集团 / NEO-OPS / 天津基地 / 联通天津',
    离职前职位: '客服专员',
    离职日期: '2026/06/30'
  });

  assert.equal(active.trainingDate, '2026-06-15');
  assert.equal(resigned.trainingDate, '2026-06-16');
});

test('talent development department base uses third-level department', () => {
  assert.equal(inferBase({
    department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
    officeLocation: 'HB01-石家庄广安大厦'
  }), '人才开发部');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 人才开发部 - 济南招聘组',
    officeLocation: 'SD01-济阳达沃智慧园'
  }), '人才开发部');
});

test('frontline base maps special office locations to business target names', () => {
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 河北基地 - 10015升投 - 前台 - 培训期',
    officeLocation: 'HB01-石家庄广安大厦'
  }), '10015升投');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 韶关基地 - 运营交付部 - 在线客服',
    officeLocation: 'SG01-韶关基地'
  }), '南二在线客服项目');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 北京基地 - 客户服务部 - 10010',
    officeLocation: 'BJ02-北京硅谷'
  }), '忽略');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 济南基地 - 运营交付部',
    officeLocation: 'SD02-济南实训基地'
  }), '济南基地-夏都');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 合肥基地',
    officeLocation: 'AH01-合肥基地'
  }), '合肥基地');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 成都基地 - 运营交付部',
    officeLocation: 'CD01-成都基地'
  }), '成都基地');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 长春基地 - 京东外呼项目',
    officeLocation: 'YB-宜宾基地'
  }), '宜宾基地');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 金融业务运营 - 重庆外呼项目',
    officeLocation: 'CQ-重庆外呼项目'
  }), '新业务运营中心');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - 金融业务运营 - 重庆中行项目',
    officeLocation: 'CQ-重庆中行'
  }), '新业务运营中心');
  assert.equal(inferBase({
    department: '伽睿集团 - NEO-OPS - ITO项目',
    officeLocation: 'GZ01-贵阳德福中心'
  }), 'ITO项目');
});

test('current year non-standard employee bases fall back to ITO project', () => {
  const currentYear = new Date().getFullYear();
  const currentYearEmployee = normalizeActiveEmployee({
    工号: 'JZ900',
    姓名: '测试员工',
    入培时间: `${currentYear}/06/01`,
    入职日期: `${currentYear}/06/02`,
    办公地点: 'GX01-广西基地',
    部门: '伽睿集团 - NEO-OPS - ITO运营中心 - 项目基地 - 广西基地',
    职位: '初级远程服务工程师-ITO',
    员工状态: '在职'
  });
  const historicalEmployee = normalizeResignedEmployee({
    工号: 'JZ901',
    姓名: '历史员工',
    入培时间: `${currentYear - 1}/06/01`,
    入职日期: `${currentYear - 1}/06/02`,
    办公地点: 'GX01-广西基地',
    离职前部门: '伽睿集团 - NEO-OPS - ITO运营中心 - 项目基地 - 广西基地',
    离职前职位: '初级远程服务工程师-ITO',
    离职日期: `${currentYear - 1}/06/30`
  });

  assert.equal(currentYearEmployee.base, 'ITO项目');
  assert.equal(historicalEmployee.base, 'GX01-广西基地');
});

test('employee filters support single-select enums and fuzzy channel names', () => {
  const { whereSql, params } = buildEmployeeFilters({
    base: '江苏基地-南京',
    channelName: '尹翔宇+JZ005942',
    channelType: '自主社招',
    startDate: '2026-01-01',
    endDate: '2026-06-30'
  });

  assert.match(whereSql, /base = \$1/);
  assert.match(whereSql, /channel_name LIKE \$2/);
  assert.match(whereSql, /channel_type = \$3/);
  assert.match(whereSql, /training_date >= \$4/);
  assert.match(whereSql, /training_date <= \$5/);
  assert.doesNotMatch(whereSql, /entry_date/);
  assert.deepEqual(params, [
    '江苏基地-南京',
    '%尹翔宇+JZ005942%',
    '自主社招',
    '2026-01-01',
    '2026-06-30'
  ]);
});

test('employee base filter options hide ignored and raw department paths', () => {
  assert.deepEqual(formatBaseOptions([
    '忽略',
    '成都基地',
    '伽睿集团 - NEO-OPS - 济南基地 - 运营交付部 - 培训期',
    '联通河北',
    '新业务运营中心'
  ]), ['联通河北', '成都基地', '新业务运营中心']);
});

test('recruiter role requires talent development department and recruitment position', () => {
  assert.equal(isRecruiterEmployee({
    department: '伽睿集团 / 人才开发部 / 招聘组',
    position: '招聘运营主管'
  }), true);
  assert.equal(isRecruiterEmployee({
    department: '伽睿集团 / 人才开发部',
    position: '人才开发总监'
  }), false);
  assert.equal(isRecruiterEmployee({
    department: '伽睿集团 / 人事部',
    position: '招聘专员'
  }), false);

  const { whereSql } = buildEmployeeFilters({ role: 'recruiter' });
  assert.match(whereSql, /department LIKE '%人才开发部%'/);
  assert.match(whereSql, /position LIKE '%招聘%'/);
  assert.doesNotMatch(whereSql, /position = @recruiterPosition/);
});

test('target progress sums cutoff targets and actuals through cutoff date', () => {
  const result = calculateTargetProgress({
    target: {
      yearMonth: '2026-06',
      base: '联通天津',
      channel: '自主社招',
      dailyTargets: { 1: 2, 2: 3, 10: 5 }
    },
    employees: [
      { employeeNo: 'JZ001', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-01' },
      { employeeNo: 'JZ001', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-02' },
      { employeeNo: 'JZ002', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-11' }
    ],
    cutoffDate: '2026-06-02'
  });

  assert.equal(result.monthlyTarget, 10);
  assert.equal(result.cutoffTarget, 5);
  assert.equal(result.actualTraining, 1);
  assert.equal(result.gap, -9);
  assert.equal(result.achievementRateText, '10.00%');
});

test('target progress default cutoff uses today for current month and month end for past month', () => {
  assert.equal(typeof getCutoffDate, 'function');
  assert.equal(getCutoffDate('2026-06', { today: '2026-06-15' }), '2026-06-15');
  assert.equal(getCutoffDate('2026-05', { today: '2026-06-15' }), '2026-05-31');
});

test('target plan summary calculates channel shares', () => {
  const summary = summarizeTargetPlan([
    { base: '联通河北', channel: '自主社招', monthlyTarget: 30, dailyTargets: { 6: 15, 14: 15 } },
    { base: '联通河北', channel: '内推', monthlyTarget: 10, dailyTargets: { 14: 10 } },
    { base: '江苏基地-南京', channel: '自主社招', monthlyTarget: 10, dailyTargets: { 21: 10 } }
  ], '2026-06');

  assert.equal(summary.totalTarget, 50);
  assert.equal(summary.baseCount, 2);
  assert.equal(summary.channelCount, 2);
  assert.deepEqual(summary.channels.map((item) => [item.channel, item.target, item.shareText]), [
    ['内推', 10, '20.00%'],
    ['自主社招', 40, '80.00%']
  ]);
  assert.deepEqual(summary.cards.map((item) => [item.label, item.target, item.shareText]), [
    ['需求总数', 50, '100.00%'],
    ['自主社招目标', 40, '80.00%'],
    ['内部推荐目标', 10, '20.00%'],
    ['渠道社招目标', 0, '0.00%'],
    ['渠道校招目标', 0, '0.00%']
  ]);
  assert.deepEqual(summary.batchColumns.map((item) => item.label), ['6月6日', '6月14日', '6月21日']);
  assert.deepEqual(summary.batchRows.map((item) => [
    item.base,
    item.channelLabel,
    item.monthlyTarget,
    item.showBase,
    item.baseRowSpan,
    item.batchTargets.map((target) => target || '')
  ]), [
    ['联通河北', '基地汇总', 40, true, 3, [15, 25, '']],
    ['联通河北', '内推', 10, false, 0, ['', 10, '']],
    ['联通河北', '自主社招', 30, false, 0, [15, 15, '']],
    ['江苏基地-南京', '基地汇总', 10, true, 2, ['', '', 10]],
    ['江苏基地-南京', '自主社招', 10, false, 0, ['', '', 10]]
  ]);
  assert.deepEqual(summary.bases.map((item) => [
    item.base,
    item.totalTarget,
    item.channels.map((channel) => [channel.label, channel.target])
  ]), [
    ['联通河北', 40, [['内推', 10], ['自招', 30]]],
    ['江苏基地-南京', 10, [['自招', 10]]]
  ]);
  assert.deepEqual(summary.bases[0].dateTargets.map((item) => [item.label, item.target]), [
    ['6月6日', 15],
    ['6月14日', 25]
  ]);
});

test('target plan summary uses month breakdown when month is all', () => {
  const summary = summarizeTargetPlan([
    { yearMonth: '2026-02', base: '江苏基地', channel: '自主社招', monthlyTarget: 100, dailyTargets: { 6: 100 } },
    { yearMonth: '2026-03', base: '江苏基地', channel: '自主社招', monthlyTarget: 100, dailyTargets: { 8: 100 } }
  ], '');

  assert.equal(summary.bases[0].totalTarget, 200);
  assert.deepEqual(summary.bases[0].monthTargets.map((item) => [item.label, item.target]), [
    ['2月', 100],
    ['3月', 100]
  ]);
});

test('target plan summary paginates bases by three per page', () => {
  const summary = summarizeTargetPlan([
    { base: '基地A', channel: '自主社招', monthlyTarget: 40, dailyTargets: { 1: 40 } },
    { base: '基地B', channel: '自主社招', monthlyTarget: 30, dailyTargets: { 2: 30 } },
    { base: '基地C', channel: '自主社招', monthlyTarget: 20, dailyTargets: { 3: 20 } },
    { base: '基地D', channel: '自主社招', monthlyTarget: 10, dailyTargets: { 4: 10 } },
    { base: '无目标基地', channel: '自主社招', monthlyTarget: 0, dailyTargets: {} }
  ], '2026-06', { page: 2 });

  assert.equal(summary.totalBases, 4);
  assert.deepEqual(summary.batchColumns.map((column) => column.label), ['6月4日']);
  assert.deepEqual(summary.bases.map((base) => base.base), ['基地D']);
  assert.deepEqual(summary.batchRows.map((row) => [row.base, row.showBase, row.baseRowSpan]), [
    ['基地D', true, 2],
    ['基地D', false, 0]
  ]);
  assert.deepEqual(summary.page, { page: 2, pageSize: 3, limit: 3, offset: 3 });
});

test('target filter options use bases from selected month only', () => {
  const options = formatDistinctTargetFilterOptions([
    { yearMonth: '2026-05', base: '江苏基地', channel: '自主社招' },
    { yearMonth: '2026-05', base: '北京基地', channel: '内推' },
    { yearMonth: '2026-06', base: '10015升投', channel: '自主社招' },
    { yearMonth: '2026-06', base: '京东外呼项目', channel: '渠道社招' }
  ], { yearMonth: '2026-06' });

  assert.deepEqual(options.bases, ['10015升投', '京东外呼项目']);
  assert.deepEqual(options.channels, ['渠道社招', '自主社招']);
});

test('target progress summary exposes self sourcing actual share', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '联通天津', channel: '自主社招', dailyTargets: { 1: 1 } },
    { yearMonth: '2026-06', base: '联通天津', channel: '内推', dailyTargets: { 1: 1 } }
  ], [
    { employeeNo: 'JZ001', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-01' },
    { employeeNo: 'JZ002', base: '联通天津', channelType: '内推', trainingDate: '2026-06-01' }
  ], '2026-06-30');

  assert.equal(summary.overall.selfSourcingShareText, '50.00%');
  assert.equal(summary.detailGroups[0].base, '整体达成');
  assert.equal(summary.detailGroups[0].isOverall, true);
  assert.deepEqual(summary.bases[0].channelRows.map((row) => [row.channel, row.monthlyTarget, row.actualTraining, row.targetShareText, row.actualShareText]), [
    ['内推', 1, 1, '50.00%', '50.00%'],
    ['自主社招', 1, 1, '50.00%', '50.00%'],
    ['合计', 2, 2, '100.00%', '100.00%']
  ]);
  assert.deepEqual(summary.bases[0].batchDetails.map((row) => [
    row.batchLabel,
    row.channel,
    row.batchTarget,
    row.actualTraining,
    row.gap,
    row.achievementRateText,
    row.showBatch,
    row.batchRowSpan,
    row.isBatchSummary
  ]), [
    ['6月1日', '内推', 1, 1, 0, '100.00%', true, 3, false],
    ['6月1日', '自主社招', 1, 1, 0, '100.00%', false, 0, false],
    ['6月1日', '批次汇总', 2, 2, 0, '100.00%', false, 0, true]
  ]);
  assert.equal(summary.bases[0].riskStatus, 'green');
  assert.equal(summary.bases[0].riskText, '绿灯');
});

test('target progress includes actual-only channels only for targeted bases', () => {
  const targets = [
    { yearMonth: '2026-05', base: '湖南基地-空港', channel: '自主社招', dailyTargets: { 1: 1 } }
  ];
  const employees = [
    { employeeNo: 'JZ001', base: '湖南基地-空港', channelType: '自主社招', trainingDate: '2026-05-01' },
    { employeeNo: 'JZ002', base: '湖南基地-空港', channelType: '渠道社招', trainingDate: '2026-05-01' }
  ];
  const completedTargets = includeActualOnlyTargets({ targets, employees, yearMonth: '2026-05' });
  const summary = summarizeTargets(targets, employees, '2026-05-31');

  assert.equal(completedTargets.length, 2);
  assert.equal(summary.overall.actualTraining, 2);
  assert.deepEqual(summary.bases.map((base) => [base.base, base.monthlyTarget, base.actualTraining]), [
    ['湖南基地-空港', 1, 2]
  ]);
  assert.equal(summary.bases[0].riskStatus, 'green');
  assert.deepEqual(summary.bases[0].channelRows.map((row) => [row.channel, row.monthlyTarget, row.actualTraining]), [
    ['渠道社招', 0, 1],
    ['自主社招', 1, 1],
    ['合计', 1, 2]
  ]);
});

test('target progress summary follows base filter', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '联通天津', channel: '内推', dailyTargets: { 10: 8 } }
  ], [
    { employeeNo: 'HA001', base: '江苏基地-淮安', channelType: '自主社招', trainingDate: '2026-06-09' },
    { employeeNo: 'HA002', base: '江苏基地-淮安', channelType: '渠道社招', trainingDate: '2026-06-09' },
    { employeeNo: 'TJ001', base: '联通天津', channelType: '内推', trainingDate: '2026-06-09' }
  ], '2026-06-30', { base: '江苏基地-淮安' });

  assert.equal(summary.overall.monthlyTarget, 10);
  assert.equal(summary.overall.actualTraining, 2);
  assert.deepEqual(summary.bases.map((base) => base.base), ['江苏基地-淮安']);
  assert.deepEqual(summary.channels
    .filter((channel) => channel.monthlyTarget > 0 || channel.actualTraining > 0)
    .map((channel) => [channel.channel, channel.monthlyTarget, channel.actualTraining]), [
    ['渠道社招', 0, 1],
    ['自主社招', 10, 1]
  ]);
});

test('target progress sorts actual-only bases after targeted bases', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '有目标低达成基地', channel: '自主社招', dailyTargets: { 1: 10 } }
  ], [
    { employeeNo: 'T1', base: '有目标低达成基地', channelType: '自主社招', trainingDate: '2026-06-01' },
    { employeeNo: 'A1', base: '无目标有达成基地', channelType: '渠道社招', trainingDate: '2026-06-01' }
  ], '2026-06-30');

  assert.deepEqual(summary.bases.map((base) => base.base), ['有目标低达成基地']);
});

test('target progress page exposes base batch detail modal payload', async () => {
  const page = await requestApp('/targets/progress?yearMonth=2026-05');

  assert.equal(page.response.status, 200);
  assert.match(page.text, /<div class="form-label">月份/);
  assert.match(page.text, /<div class="form-label">基地/);
  assert.doesNotMatch(page.text, /progress-filter-bar/);
  assert.doesNotMatch(page.text, /<th>风险指标<\/th>/);
  assert.match(page.text, /基地目标与达成对比/);
  assert.match(page.text, /实际达成渠道占比/);
  assert.match(page.text, /目标达成明细/);
  assert.match(page.text, /progress-chart-card/);
  assert.match(page.text, /progress-donut-card/);
  assert.match(page.text, /risk-light-/);
  assert.match(page.text, /achievement-progress/);
  assert.match(page.text, /achievement-progress-green/);
  assert.match(page.text, /frozen-table-wrapper/);
  assert.match(page.text, /data-target-base-detail=/);
  assert.match(page.text, /targetProgressDetailModal/);
  assert.match(page.text, /targetProgressDetailPayload/);
  assert.match(page.text, /基地批次渠道达成明细/);
});

test('dashboard training details follow base filter', () => {
  const details = getTrainingDetails({
    yearMonth: '2026-06',
    cutoffDate: '2026-06-30',
    base: '江苏基地-淮安'
  }, [
    { employeeNo: 'HA001', base: '江苏基地-淮安', channelType: '自主社招', trainingDate: '2026-06-09' },
    { employeeNo: 'TJ001', base: '联通天津', channelType: '内推', trainingDate: '2026-06-09' }
  ]);

  assert.deepEqual(details.map((item) => item.employeeNo), ['HA001']);
});

test('dashboard matrix exposes base channel status cells', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '联通天津', channel: '自主社招', dailyTargets: { 10: 1, 20: 1 } },
    { yearMonth: '2026-06', base: '联通天津', channel: '内推', dailyTargets: { 10: 2 } }
  ], [
    { employeeNo: 'JZ001', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-09' },
    { employeeNo: 'JZ002', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-15' },
    { employeeNo: 'JZ003', base: '联通天津', channelType: '内推', trainingDate: '2026-06-11' }
  ], '2026-06-20');

  const matrix = buildDashboardMatrix(summary, {});
  const baseRow = matrix.rows.find((row) => row.base === '联通天津');

  assert.deepEqual(matrix.channels, ['内推', '自主社招']);
  assert.equal(baseRow.cells.自主社招.status, 'achieved');
  assert.equal(baseRow.cells.自主社招.monthlyTarget, 2);
  assert.equal(baseRow.cells.自主社招.actualTraining, 2);
  assert.equal(baseRow.cells.自主社招.gap, 0);
  assert.equal(baseRow.cells.内推.status, 'risk');
});

test('dashboard batch drilldown groups funnel by batch feedback window', () => {
  const batches = buildBatchDrilldown({
    yearMonth: '2026-06',
    base: '联通天津',
    channel: '自主社招',
    targets: [
      { yearMonth: '2026-06', base: '联通天津', channel: '自主社招', dailyTargets: { 10: 1, 20: 1 } }
    ],
    employees: [
      { employeeNo: 'JZ001', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-09' },
      { employeeNo: 'JZ002', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-15' },
      { employeeNo: 'JZ003', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-22' }
    ],
    interviews: [
      { base: '联通天津', channelType: '自主社招', feedbackDate: '2026-06-05', feedbackResult: '推荐' },
      { base: '联通天津', channelType: '自主社招', feedbackDate: '2026-06-06', feedbackResult: '不推荐' },
      { base: '联通天津', channelType: '自主社招', feedbackDate: '2026-06-15', feedbackResult: '强烈推荐' },
      { base: '联通天津', channelType: '内推', feedbackDate: '2026-06-15', feedbackResult: '推荐' }
    ]
  });

  assert.deepEqual(batches.map((batch) => [
    batch.label,
    batch.windowStart,
    batch.windowEnd,
    batch.target,
    batch.actualTraining,
    batch.gap,
    batch.status,
    batch.funnel.arrivedCount,
    batch.funnel.passedCount,
    batch.funnel.trainingCount
  ]), [
    ['6月10日批次', '2026-06-01', '2026-06-10', 1, 1, 0, 'achieved', 2, 1, 1],
    ['6月20日批次', '2026-06-11', '2026-06-20', 1, 1, 0, 'achieved', 1, 1, 1]
  ]);
});

test('dashboard batch drilldown diagnoses gap by funnel stage', () => {
  const batches = buildBatchDrilldown({
    yearMonth: '2026-06',
    base: '江苏基地-淮安',
    channel: '自主社招',
    targets: [
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 20: 10 } }
    ],
    employees: Array.from({ length: 6 }, (_, index) => ({
      employeeNo: `JZ${index}`,
      base: '江苏基地-淮安',
      channelType: '自主社招',
      trainingDate: '2026-06-18'
    })),
    interviews: [
      ...Array.from({ length: 12 }, (_, index) => ({
        base: '江苏基地-淮安',
        channelType: '自主社招',
        feedbackDate: '2026-06-12',
        feedbackResult: index < 6 ? '推荐' : '强烈推荐'
      })),
      ...Array.from({ length: 18 }, () => ({
        base: '江苏基地-淮安',
        channelType: '自主社招',
        feedbackDate: '2026-06-12',
        feedbackResult: '不推荐'
      }))
    ],
    asOfDate: '2026-06-21'
  });

  assert.equal(batches[0].gap, -4);
  assert.equal(batches[0].diagnosis.reason, '通过后入职转化不足');
  assert.equal(batches[0].diagnosis.suggestion, '优先催入职确认 / 补 offer / 加候选人备份');
  assert.deepEqual(batches[0].diagnosis.stages.map((stage) => [
    stage.name,
    stage.actual,
    stage.expected,
    stage.status
  ]), [
    ['到面环节', 30, 25, 'normal'],
    ['面通环节', 12, 15, 'insufficient'],
    ['入职环节', 6, 10, 'insufficient']
  ]);
});

test('dashboard batch matrix uses base channel rows and batch columns', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '联通天津', channel: '自主社招', dailyTargets: { 10: 2, 20: 2 } },
    { yearMonth: '2026-06', base: '联通天津', channel: '内推', dailyTargets: { 10: 2 } }
  ], [
    { employeeNo: 'JZ001', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-09' },
    { employeeNo: 'JZ002', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-15' },
    { employeeNo: 'JZ003', base: '联通天津', channelType: '内推', trainingDate: '2026-06-11' }
  ], '2026-06-20');
  const matrix = buildDashboardMatrix(summary, {});
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '联通天津', channel: '自主社招', dailyTargets: { 10: 2, 20: 2 } },
      { yearMonth: '2026-06', base: '联通天津', channel: '内推', dailyTargets: { 10: 2 } }
    ],
    employees: [
      { employeeNo: 'JZ001', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-09' },
      { employeeNo: 'JZ002', base: '联通天津', channelType: '自主社招', trainingDate: '2026-06-15' },
      { employeeNo: 'JZ003', base: '联通天津', channelType: '内推', trainingDate: '2026-06-11' }
    ],
    interviews: [],
    asOfDate: '2026-06-20'
  });

  assert.deepEqual(batchMatrix.columns.map((column) => column.label), ['6月10日批次', '6月20日批次', '合计']);
  assert.deepEqual(batchMatrix.summary, { risk: 2, warning: 1, achieved: 1, empty: 0 });
  assert.deepEqual(batchMatrix.rows.map((row) => [row.label, row.cells[10].status, row.cells[10].displayText, row.total.status]), [
    ['联通天津 / 内推', 'risk', '0.0%', 'risk'],
    ['联通天津 / 自主社招', 'risk', '50.0%', 'risk']
  ]);
  assert.deepEqual(batchMatrix.riskItems.map((item) => [item.label, item.status, item.gap]), [
    ['联通天津 / 内推 / 6月10日批次', 'risk', -2],
    ['联通天津 / 自主社招 / 6月10日批次', 'risk', -1],
    ['联通天津 / 自主社招 / 6月20日批次', 'warning', -1]
  ]);
});

test('dashboard funnel diagnosis excludes return and campus channels', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '回流', dailyTargets: { 10: 2 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道校招', dailyTargets: { 10: 2 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '内推', dailyTargets: { 10: 2 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 2 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 2 } }
  ], [
    { employeeNo: 'JZ001', base: '江苏基地-淮安', channelType: '回流', trainingDate: '2026-06-09' },
    { employeeNo: 'JZ002', base: '江苏基地-淮安', channelType: '渠道校招', trainingDate: '2026-06-09' },
    { employeeNo: 'JZ003', base: '江苏基地-淮安', channelType: '内推', trainingDate: '2026-06-09' }
  ], '2026-06-20');
  const matrix = buildDashboardMatrix(summary, { base: '江苏基地-淮安' });
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '回流', dailyTargets: { 10: 2 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道校招', dailyTargets: { 10: 2 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '内推', dailyTargets: { 10: 2 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 2 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 2 } }
    ],
    employees: [
      { employeeNo: 'JZ001', base: '江苏基地-淮安', channelType: '回流', trainingDate: '2026-06-09' },
      { employeeNo: 'JZ002', base: '江苏基地-淮安', channelType: '渠道校招', trainingDate: '2026-06-09' },
      { employeeNo: 'JZ003', base: '江苏基地-淮安', channelType: '内推', trainingDate: '2026-06-09' }
    ],
    interviews: [],
    asOfDate: '2026-06-20'
  });
  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '江苏基地-淮安'
  });

  assert.deepEqual(batchMatrix.rows.map((row) => row.channel), ['回流', '内推', '渠道社招', '渠道校招', '自主社招']);
  assert.equal(batchMatrix.riskItems.some((item) => item.channel === '回流' || item.channel === '渠道校招'), false);
  assert.deepEqual(board.channels.map((item) => item.channel), ['回流', '内推', '渠道社招', '渠道校招', '自主社招']);
  assert.deepEqual(board.selectedBatch.channels.map((item) => item.channel), ['回流', '内推', '渠道社招', '渠道校招', '自主社招']);
});

test('dashboard position channel board summarizes one base across channels and batches', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '回流', dailyTargets: { 10: 2 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '内推', dailyTargets: { 10: 3 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 4, 20: 2 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 5, 20: 4 } },
    { yearMonth: '2026-06', base: '联通天津', channel: '自主社招', dailyTargets: { 10: 10 } }
  ], [
    { employeeNo: 'JZ001', base: '江苏基地-淮安', channelType: '回流', trainingDate: '2026-06-09' },
    { employeeNo: 'JZ002', base: '江苏基地-淮安', channelType: '内推', trainingDate: '2026-06-09' },
    { employeeNo: 'JZ003', base: '江苏基地-淮安', channelType: '渠道社招', trainingDate: '2026-06-09' },
    { employeeNo: 'JZ004', base: '江苏基地-淮安', channelType: '自主社招', trainingDate: '2026-06-18' }
  ], '2026-06-20');
  const matrix = buildDashboardMatrix(summary, { base: '江苏基地-淮安' });
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '回流', dailyTargets: { 10: 2 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '内推', dailyTargets: { 10: 3 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 4, 20: 2 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 5, 20: 4 } }
    ],
    employees: [
      { employeeNo: 'JZ001', base: '江苏基地-淮安', channelType: '回流', trainingDate: '2026-06-09' },
      { employeeNo: 'JZ002', base: '江苏基地-淮安', channelType: '内推', trainingDate: '2026-06-09' },
      { employeeNo: 'JZ003', base: '江苏基地-淮安', channelType: '渠道社招', trainingDate: '2026-06-09' },
      { employeeNo: 'JZ004', base: '江苏基地-淮安', channelType: '自主社招', trainingDate: '2026-06-18' }
    ],
    interviews: [
      { base: '江苏基地-淮安', channelType: '回流', feedbackDate: '2026-06-05', feedbackResult: '推荐' },
      { base: '江苏基地-淮安', channelType: '内推', feedbackDate: '2026-06-03', feedbackResult: '推荐' },
      { base: '江苏基地-淮安', channelType: '内推', feedbackDate: '2026-06-08', feedbackResult: '不推荐' },
      { base: '江苏基地-淮安', channelType: '渠道社招', feedbackDate: '2026-06-04', feedbackResult: '推荐' },
      { base: '江苏基地-淮安', channelType: '渠道社招', feedbackDate: '2026-06-07', feedbackResult: '强烈推荐' },
      { base: '江苏基地-淮安', channelType: '渠道社招', feedbackDate: '2026-06-09', feedbackResult: '不推荐' },
      { base: '江苏基地-淮安', channelType: '自主社招', feedbackDate: '2026-06-02', feedbackResult: '推荐' },
      { base: '江苏基地-淮安', channelType: '自主社招', feedbackDate: '2026-06-05', feedbackResult: '不推荐' },
      { base: '江苏基地-淮安', channelType: '自主社招', feedbackDate: '2026-06-07', feedbackResult: '不推荐' },
      { base: '江苏基地-淮安', channelType: '自主社招', feedbackDate: '2026-06-10', feedbackResult: '不推荐' },
      { base: '江苏基地-淮安', channelType: '渠道社招', feedbackDate: '2026-06-15', feedbackResult: '不推荐' },
      { base: '江苏基地-淮安', channelType: '自主社招', feedbackDate: '2026-06-12', feedbackResult: '推荐' },
      { base: '江苏基地-淮安', channelType: '自主社招', feedbackDate: '2026-06-19', feedbackResult: '不推荐' },
      { base: '江苏基地-淮安', channelType: '自主社招', feedbackDate: '2026-06-21', feedbackResult: '推荐' }
    ],
    asOfDate: '2026-06-20'
  });

  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '江苏基地-淮安'
  });

  assert.equal(board.base, '江苏基地-淮安');
  assert.equal(board.total.monthlyTarget, 20);
  assert.equal(board.total.actualTraining, 4);
  assert.equal(board.total.gap, -16);
  assert.deepEqual(board.channels.map((item) => [item.channel, item.monthlyTarget, item.actualTraining, item.gap]), [
    ['回流', 2, 1, -1],
    ['内推', 3, 1, -2],
    ['渠道社招', 6, 1, -5],
    ['自主社招', 9, 1, -8]
  ]);
  assert.deepEqual(board.batchRisks.map((item) => [item.label, item.target, item.actualTraining, item.gap]), [
    ['6月10日批次', 14, 3, -11],
    ['6月20日批次', 6, 1, -5]
  ]);
  assert.equal(board.batchRisks.reduce((sum, batch) => sum + batch.gap, 0), board.total.gap);
  assert.deepEqual(board.batchRisks[1].channels.map((item) => [item.channel, item.target, item.actualTraining, item.gap]), [
    ['回流', 0, 0, 0],
    ['内推', 0, 0, 0],
    ['渠道社招', 2, 0, -2],
    ['自主社招', 4, 1, -3]
  ]);
  assert.equal(board.selectedBatch.day, 10);
  assert.deepEqual(board.selectedBatch.channels.map((item) => [item.channel, item.target, item.actualTraining, item.gap]), [
    ['回流', 2, 1, -1],
    ['内推', 3, 1, -2],
    ['渠道社招', 4, 1, -3],
    ['自主社招', 5, 0, -5]
  ]);
  assert.deepEqual(board.funnelRows.map((row) => [
    row.channel,
    row.arrivedCount,
    row.passedCount,
    row.trainingCount,
    row.passRateText,
    row.trainingRateText
  ]), [
    ['回流', 1, 1, 1, '100.00%', '100.00%'],
    ['内推', 2, 1, 1, '50.00%', '100.00%'],
    ['渠道社招', 3, 2, 1, '66.67%', '50.00%'],
    ['自主社招', 4, 1, 0, '25.00%', '0.00%']
  ]);

  const secondBatchBoard = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '江苏基地-淮安',
    selectedBatchDay: 20
  });

  assert.deepEqual(secondBatchBoard.funnelRows.map((row) => [
    row.channel,
    row.arrivedCount,
    row.passedCount,
    row.trainingCount,
    row.passRateText,
    row.trainingRateText
  ]), [
    ['回流', 0, 0, 0, '0.00%', '0.00%'],
    ['内推', 0, 0, 0, '0.00%', '0.00%'],
    ['渠道社招', 1, 0, 0, '0.00%', '0.00%'],
    ['自主社招', 2, 1, 1, '50.00%', '100.00%']
  ]);
  assert.match(board.actionPlans.find((item) => item.title === '自主社招提升方案').actions[0], /6月1日 - 6月9日/);
  assert.match(secondBatchBoard.actionPlans.find((item) => item.title === '自主社招提升方案').actions[0], /6月11日 - 6月19日/);
});

test('dashboard position channel board exposes funnel rows and channel action plans', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '内推', dailyTargets: { 10: 15 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 60 } },
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 75 } }
  ], [
    ...Array.from({ length: 5 }, (_, index) => ({
      employeeNo: `NT${index}`,
      base: '江苏基地-淮安',
      channelType: '内推',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 62 }, (_, index) => ({
      employeeNo: `QD${index}`,
      base: '江苏基地-淮安',
      channelType: '渠道社招',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 34 }, (_, index) => ({
      employeeNo: `ZZ${index}`,
      base: '江苏基地-淮安',
      channelType: '自主社招',
      trainingDate: '2026-06-09'
    }))
  ], '2026-06-30');
  const matrix = buildDashboardMatrix(summary, { base: '江苏基地-淮安' });
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '内推', dailyTargets: { 10: 15 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 60 } },
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 75 } }
    ],
    employees: [],
    interviews: [],
    asOfDate: '2026-06-30'
  });

  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '江苏基地-淮安'
  });

  assert.deepEqual(board.funnelRows.map((row) => [
    row.channel,
    row.arrivedCount,
    row.passedCount,
    row.trainingCount,
    row.passRateText,
    row.trainingRateText
  ]), [
    ['内推', 0, 0, 0, '0.00%', '0.00%'],
    ['渠道社招', 0, 0, 0, '0.00%', '0.00%'],
    ['自主社招', 0, 0, 0, '0.00%', '0.00%']
  ]);
  assert.deepEqual(board.actionPlans.map((item) => item.title), [
    '内推提升方案',
    '渠道社招提升方案',
    '自主社招提升方案'
  ]);
  assert.deepEqual(board.actionPlans.map((item) => item.owner), [
    '基地负责人',
    'RPO 供应商池',
    '自招团队'
  ]);
  assert.match(board.actionPlans[1].actions[0], /6月1日 - 6月9日/);
  assert.match(board.actionPlans[2].actions[0], /6月1日 - 6月9日/);
  assert.match(board.actionPlans[2].actions.join('；'), /有效邀约/);
  assert.equal(board.actionPlans.every((item) => item.actions.length <= 3), true);
});

test('dashboard position channel board action plans follow selected channel scope', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 60 } }
  ], [
    ...Array.from({ length: 38 }, (_, index) => ({
      employeeNo: `QD${index}`,
      base: '江苏基地-淮安',
      channelType: '渠道社招',
      trainingDate: '2026-06-09'
    }))
  ], '2026-06-30');
  const matrix = buildDashboardMatrix(summary, { base: '江苏基地-淮安', channel: '渠道社招' });
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 60 } }
    ],
    employees: [],
    interviews: [],
    filters: { channel: '渠道社招' },
    asOfDate: '2026-06-30'
  });

  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '江苏基地-淮安'
  });

  assert.deepEqual(board.actionPlans.map((item) => item.title), ['渠道社招提升方案']);
  assert.match(board.actionPlans[0].diagnosis, /渠道社招整体到面不足/);
  assert.match(board.actionPlans[0].actions[0], /6月1日 - 6月9日/);
  assert.match(board.actionPlans[0].actions.join('；'), /RPO 供应商/);
});

test('dashboard position channel board shows healthy diagnosis when base is achieved', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '济阳基地', channel: '自主社招', dailyTargets: { 10: 10 } }
  ], [
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: `ZY-ZZ${index}`,
      base: '济阳基地',
      channelType: '自主社招',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      employeeNo: `ZY-QD${index}`,
      base: '济阳基地',
      channelType: '渠道社招',
      trainingDate: '2026-06-09'
    }))
  ], '2026-06-30');
  const matrix = buildDashboardMatrix(summary, { base: '济阳基地' });
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '济阳基地', channel: '自主社招', dailyTargets: { 10: 10 } }
    ],
    employees: [],
    interviews: [],
    asOfDate: '2026-06-30'
  });

  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '济阳基地'
  });

  assert.equal(board.total.status, 'achieved');
  assert.equal(board.healthStatus, 'healthy');
  assert.match(board.mainRiskText, /各项环节均在健康值/);
  assert.deepEqual(board.actionPlans.map((item) => item.title), ['基地达成健康']);
  assert.doesNotMatch(board.actionPlans[0].diagnosis, /风险|缺口|GAP/);
  assert.doesNotMatch(board.actionPlans[0].communicationScript, /补齐|供应商压降|风险/);
});

test('dashboard position channel board marks achieved batch as healthy even when one channel is short', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-05', base: '济南基地-济阳', channel: '内推', dailyTargets: { 26: 1 } },
    { yearMonth: '2026-05', base: '济南基地-济阳', channel: '渠道社招', dailyTargets: { 26: 3 } },
    { yearMonth: '2026-05', base: '济南基地-济阳', channel: '自主社招', dailyTargets: { 26: 2 } }
  ], [
    ...Array.from({ length: 5 }, (_, index) => ({
      employeeNo: `HL${index}`,
      base: '济南基地-济阳',
      channelType: '回流',
      trainingDate: '2026-05-20'
    })),
    { employeeNo: 'NT1', base: '济南基地-济阳', channelType: '内推', trainingDate: '2026-05-20' },
    ...Array.from({ length: 3 }, (_, index) => ({
      employeeNo: `QD${index}`,
      base: '济南基地-济阳',
      channelType: '渠道社招',
      trainingDate: '2026-05-20'
    })),
    { employeeNo: 'ZZ1', base: '济南基地-济阳', channelType: '自主社招', trainingDate: '2026-05-20' }
  ], '2026-05-31');
  const matrix = buildDashboardMatrix(summary, { base: '济南基地-济阳' });
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-05',
    matrix,
    targets: [
      { yearMonth: '2026-05', base: '济南基地-济阳', channel: '内推', dailyTargets: { 26: 1 } },
      { yearMonth: '2026-05', base: '济南基地-济阳', channel: '渠道社招', dailyTargets: { 26: 3 } },
      { yearMonth: '2026-05', base: '济南基地-济阳', channel: '自主社招', dailyTargets: { 26: 2 } }
    ],
    employees: [
      ...Array.from({ length: 5 }, (_, index) => ({
        employeeNo: `HL${index}`,
        base: '济南基地-济阳',
        channelType: '回流',
        trainingDate: '2026-05-20'
      })),
      { employeeNo: 'NT1', base: '济南基地-济阳', channelType: '内推', trainingDate: '2026-05-20' },
      ...Array.from({ length: 3 }, (_, index) => ({
        employeeNo: `QD${index}`,
        base: '济南基地-济阳',
        channelType: '渠道社招',
        trainingDate: '2026-05-20'
      })),
      { employeeNo: 'ZZ1', base: '济南基地-济阳', channelType: '自主社招', trainingDate: '2026-05-20' }
    ],
    interviews: [],
    asOfDate: '2026-05-31'
  });

  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '济南基地-济阳',
    selectedBatchDay: 26
  });
  const batch = board.batchRisks.find((item) => item.day === 26);

  assert.equal(batch.target, 6);
  assert.equal(batch.actualTraining, 10);
  assert.equal(batch.gap, 4);
  assert.equal(batch.status, 'achieved');
  assert.equal(batch.statusText, '达成');
  assert.equal(board.funnelRows.find((row) => row.channel === '自主社招').status, 'warning');
  assert.equal(board.funnelRows.find((row) => row.channel === '自主社招').statusText, '需关注');
  assert.equal(board.funnelRows.find((row) => row.channel === '渠道社招').status, 'achieved');
});

test('dashboard position channel board treats actual-only channels as healthy', () => {
  const employees = [
    ...Array.from({ length: 10 }, (_, index) => ({
      employeeNo: `SELF${index}`,
      base: '湖南基地-空港',
      channelType: '自主社招',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      employeeNo: `SOCIAL${index}`,
      base: '湖南基地-空港',
      channelType: '渠道社招',
      trainingDate: '2026-06-09'
    }))
  ];
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '湖南基地-空港', channel: '自主社招', dailyTargets: { 10: 10 } }
  ], employees, '2026-06-30');
  const matrix = buildDashboardMatrix(summary, { base: '湖南基地-空港' });
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '湖南基地-空港', channel: '自主社招', dailyTargets: { 10: 10 } }
    ],
    employees,
    interviews: [],
    asOfDate: '2026-06-30'
  });

  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: '湖南基地-空港'
  });
  const socialChannel = board.channels.find((channel) => channel.channel === '渠道社招');
  const socialFunnel = board.funnelRows.find((row) => row.channel === '渠道社招');

  assert.equal(socialChannel.status, 'achieved');
  assert.equal(socialChannel.statusText, '健康');
  assert.equal(socialFunnel.status, 'achieved');
  assert.equal(socialFunnel.statusText, '健康');
});

test('dashboard position board keeps batch overview embedded and vertical', () => {
  const template = fs.readFileSync(
    path.join(__dirname, '../views/pages/dashboard/partials/position-risk-board.ejs'),
    'utf8'
  );
  const css = fs.readFileSync(path.join(__dirname, '../public/css/main.css'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8');

  assert.doesNotMatch(template, /批次概览已前移到上方达成卡片|批次漏斗概览已展示在上方左侧区域/);
  assert.match(template, /batch-channel-breakdown/);
  assert.match(template, /positionBatchPayload/);
  assert.match(template, /data-position-batch-card/);
  assert.match(template, /data-channel-action-grid/);
  assert.match(template, /data-position-main-risk-text/);
  assert.match(css, /\.embedded-batch-grid\s*{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.batch-channel-breakdown\s*{/);
  assert.match(css, /\.embedded-batch-grid \.batch-channel-row b\s*{[^}]*font-size:\s*12px/s);
  assert.match(css, /\.position-goal-card,\s*\.position-diagnosis-card\s*{[^}]*height:\s*100%/s);
  assert.match(script, /data-position-batch-card/);
  assert.match(script, /event\.preventDefault\(\)/);
  assert.match(script, /renderPositionBatchPanel/);
  assert.match(script, /renderPositionBatchActionPlans/);
  assert.match(script, /data-channel-action-grid/);
});

test('dashboard position channel board switches to base achievement overview when base is all', () => {
  const summary = summarizeTargets([
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '联通天津', channel: '内推', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '湖南基地-空港', channel: '渠道社招', dailyTargets: { 10: 10 } }
  ], [
    ...Array.from({ length: 10 }, (_, index) => ({
      employeeNo: `HA${index}`,
      base: '江苏基地-淮安',
      channelType: '自主社招',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: `TJ${index}`,
      base: '联通天津',
      channelType: '内推',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      employeeNo: `KG${index}`,
      base: '湖南基地-空港',
      channelType: '渠道社招',
      trainingDate: '2026-06-09'
    }))
  ], '2026-06-20');
  const matrix = buildDashboardMatrix(summary, {});
  const batchMatrix = buildBatchMatrix({
    yearMonth: '2026-06',
    matrix,
    targets: [
      { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '自主社招', dailyTargets: { 10: 10 } },
      { yearMonth: '2026-06', base: '联通天津', channel: '内推', dailyTargets: { 10: 10 } },
      { yearMonth: '2026-06', base: '湖南基地-空港', channel: '渠道社招', dailyTargets: { 10: 10 } }
    ],
    employees: [],
    interviews: [],
    asOfDate: '2026-06-20'
  });

  const board = buildPositionChannelBoard({
    progress: summary,
    batchMatrix,
    selectedBase: ''
  });

  assert.equal(board.mode, 'baseOverview');
  assert.equal(board.title, '全部基地达成情况');
  assert.equal(board.total.monthlyTarget, 30);
  assert.equal(board.total.actualTraining, 23);
  assert.deepEqual(board.baseAchievements.map((item) => [item.base, item.actualTraining, item.achievementRateText, item.status]), [
    ['湖南基地-空港', 5, '50.00%', 'risk'],
    ['联通天津', 8, '80.00%', 'risk'],
    ['江苏基地-淮安', 10, '100.00%', 'achieved']
  ]);
  assert.equal(board.riskBaseCount, 2);
});

test('dashboard overview insights expose executive cards, channel shares and vendor top three', () => {
  const progress = summarizeTargets([
    { yearMonth: '2026-06', base: '江苏基地-淮安', channel: '渠道社招', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '长春热线项目', channel: '渠道社招', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '南二在线客服项目', channel: '渠道社招', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '联通天津', channel: '自主社招', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '联通河北', channel: '内推', dailyTargets: { 10: 5 } }
  ], [
    ...Array.from({ length: 3 }, (_, index) => ({
      employeeNo: `ZS-H${index}`,
      base: '江苏基地-淮安',
      channelType: '渠道社招',
      channelName: '哲善人力',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      employeeNo: `ZS-C${index}`,
      base: '长春热线项目',
      channelType: '渠道社招',
      channelName: '哲善人力',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      employeeNo: `ZS-N${index}`,
      base: '南二在线客服项目',
      channelType: '渠道社招',
      channelName: '哲善人力',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      employeeNo: `ZN${index}`,
      base: '江苏基地-淮安',
      channelType: '渠道社招',
      channelName: '择能人力',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      employeeNo: `DY${index}`,
      base: '联通河北',
      channelType: '渠道社招',
      channelName: '大隐人力',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: `SELF${index}`,
      base: '联通天津',
      channelType: '自主社招',
      channelName: '张三+JZ001',
      trainingDate: '2026-06-09'
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      employeeNo: `NT${index}`,
      base: '联通河北',
      channelType: '内推',
      channelName: '员工推荐',
      trainingDate: '2026-06-09'
    }))
  ], '2026-06-30');
  const trainingDetails = [
    ...Array.from({ length: 3 }, (_, index) => ({ base: '江苏基地-淮安', channelType: '渠道社招', channelName: '哲善人力', employeeNo: `ZS-H${index}` })),
    ...Array.from({ length: 3 }, (_, index) => ({ base: '长春热线项目', channelType: '渠道社招', channelName: '哲善人力', employeeNo: `ZS-C${index}` })),
    ...Array.from({ length: 4 }, (_, index) => ({ base: '南二在线客服项目', channelType: '渠道社招', channelName: '哲善人力', employeeNo: `ZS-N${index}` })),
    ...Array.from({ length: 5 }, (_, index) => ({ base: '江苏基地-淮安', channelType: '渠道社招', channelName: '择能人力', employeeNo: `ZN${index}` })),
    ...Array.from({ length: 4 }, (_, index) => ({ base: '联通河北', channelType: '渠道社招', channelName: '大隐人力', employeeNo: `DY${index}` })),
    ...Array.from({ length: 8 }, (_, index) => ({ base: '联通天津', channelType: '自主社招', channelName: '张三+JZ001', employeeNo: `SELF${index}` })),
    ...Array.from({ length: 3 }, (_, index) => ({ base: '联通河北', channelType: '内推', channelName: '员工推荐', employeeNo: `NT${index}` }))
  ];
  const insights = buildOverviewInsights({
    progress,
    trainingDetails,
    selfSourcingEfficiency: [
      { stage: '试用期', recruiterCount: 2, trainingCount: 2, efficiency: '1.0' },
      { stage: '正式期', recruiterCount: 3, trainingCount: 6, efficiency: '2.0' },
      { stage: '整体', recruiterCount: 5, trainingCount: 8, efficiency: '1.6' }
    ]
  });

  assert.equal(insights.cards.targetAchievementRateText, '66.67%');
  assert.equal(insights.cards.selfSourcingShareText, '26.67%');
  assert.equal(insights.cards.selfSourcingEfficiency, '1.6');
  assert.equal(insights.cards.recruiterTeamSize, 5);
  assert.equal(insights.overallRisk.status, 'risk');
  assert.deepEqual(insights.baseAchievements.map((item) => [item.base, item.actualTraining, item.achievementRateText, item.status]), [
    ['长春热线项目', 3, '30.00%', 'risk'],
    ['南二在线客服项目', 4, '40.00%', 'risk'],
    ['江苏基地-淮安', 8, '80.00%', 'risk'],
    ['联通天津', 8, '80.00%', 'risk'],
    ['联通河北', 7, '140.00%', 'achieved']
  ]);
  assert.deepEqual(insights.channelShares.map((item) => [item.channel, item.actualTraining]), [
    ['回流', 0],
    ['内推', 3],
    ['渠道社招', 19],
    ['渠道校招', 0],
    ['自主社招', 8]
  ]);
  assert.deepEqual(insights.socialChannelTop3.map((item) => [item.channelName, item.total, item.baseBreakdownText]), [
    ['哲善人力', 10, '南二在线客服项目4、江苏基地-淮安3、长春热线项目3'],
    ['择能人力', 5, '江苏基地-淮安5'],
    ['大隐人力', 4, '联通河北4']
  ]);
  assert.deepEqual(insights.selfSourcingEfficiency.map((item) => [item.stage, item.efficiency, item.recruiterCount]), [
    ['整体', '1.6', 5],
    ['试用期', '1.0', 2],
    ['正式期', '2.0', 3]
  ]);
});

test('dashboard overview base achievements sort by achievement rate and keep actual-only bases last', () => {
  const progress = summarizeTargets([
    { yearMonth: '2026-06', base: '低达成基地', channel: '自主社招', dailyTargets: { 10: 10 } },
    { yearMonth: '2026-06', base: '高达成基地', channel: '内推', dailyTargets: { 10: 10 } }
  ], [
    { employeeNo: 'LOW1', base: '低达成基地', channelType: '自主社招', trainingDate: '2026-06-09' },
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: `HIGH${index}`,
      base: '高达成基地',
      channelType: '内推',
      trainingDate: '2026-06-09'
    })),
    { employeeNo: 'ONLY1', base: '无目标达成基地', channelType: '渠道社招', trainingDate: '2026-06-09' }
  ], '2026-06-30');

  const insights = buildOverviewInsights({
    progress,
    trainingDetails: [],
    selfSourcingEfficiency: []
  });

  assert.deepEqual(insights.baseAchievements.map((item) => [item.base, item.monthlyTarget, item.actualTraining, item.achievementRateText]), [
    ['低达成基地', 10, 1, '10.00%'],
    ['高达成基地', 10, 8, '80.00%'],
    ['无目标达成基地', 0, 1, '0.00%']
  ]);
});

test('dashboard overview tab normalizes unknown tab to overview', () => {
  assert.equal(normalizeOverviewTab('base'), 'base');
  assert.equal(normalizeOverviewTab('channel'), 'channel');
  assert.equal(normalizeOverviewTab('self'), 'self');
  assert.equal(normalizeOverviewTab('unknown'), 'overview');
  assert.equal(normalizeOverviewTab(''), 'overview');
});

test('self sourcing efficiency uses monthly active recruiter scale by stage', () => {
  const result = buildSelfSourcingEfficiency({
    yearMonth: '2026-06',
    asOfDate: '2026-06-30',
    employees: [
      {
        name: '正式招聘',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2025-11-01',
        entryDate: '2025-11-01',
        resignedDate: ''
      },
      {
        name: '试用招聘',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2026-02-01',
        entryDate: '2026-02-01',
        resignedDate: ''
      },
      {
        name: '离职招聘',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'resigned',
        employeeStatus: '离职',
        trainingDate: '2026-01-01',
        entryDate: '2026-01-01',
        resignedDate: '2026-05-31'
      },
      {
        name: '月内离职招聘',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'resigned',
        employeeStatus: '离职',
        trainingDate: '2025-09-01',
        entryDate: '2025-09-01',
        resignedDate: '2026-06-26'
      },
      {
        name: '非人才开发招聘',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 长春基地 / 招聘服务组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2024-10-18',
        entryDate: '2024-10-22',
        resignedDate: ''
      },
      {
        employeeNo: 'SELF1',
        channelType: '自主社招',
        channelName: '正式招聘+JZ001',
        trainingDate: '2026-06-10'
      },
      {
        employeeNo: 'SELF2',
        channelType: '自主社招',
        channelName: '试用招聘+JZ002',
        trainingDate: '2026-06-11'
      },
      {
        employeeNo: 'SELF3',
        channelType: '自主社招',
        channelName: '未匹配招聘+JZ003',
        trainingDate: '2026-06-12'
      },
      {
        employeeNo: 'SELF4',
        channelType: '自主社招',
        channelName: '月内离职招聘+JZ004',
        trainingDate: '2026-06-13'
      },
      {
        employeeNo: 'SELF5',
        channelType: '自主社招',
        channelName: '非人才开发招聘+JZ005',
        trainingDate: '2026-06-14'
      },
      {
        employeeNo: 'SELF6',
        channelType: '自主社招',
        channelName: '正式招聘+JZ001',
        trainingDate: '2026-06-29'
      }
    ]
  });

  assert.deepEqual(result.map((item) => [item.stage, item.recruiterCount, item.trainingCount, item.sevenDayCount, item.efficiency, item.sevenDayEfficiency]), [
    ['整体', 3, 6, 5, '2.0', '1.7'],
    ['试用期', 1, 1, 1, '1.0', '1.0'],
    ['正式期', 2, 3, 2, '1.5', '1.0']
  ]);
  assert.deepEqual(result.scales, [
    { stage: '整体', recruiterCount: 3 },
    { stage: '试用期', recruiterCount: 1 },
    { stage: '正式期', recruiterCount: 2 }
  ]);
});

test('self sourcing efficiency follows recruiter filter', () => {
  const employees = [
    {
      name: '正式招聘',
      position: '招聘专员',
      department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
      sourceType: 'active',
      employeeStatus: '在职',
      trainingDate: '2025-11-01',
      entryDate: '2025-11-01',
      resignedDate: ''
    },
    {
      name: '试用招聘',
      position: '招聘专员',
      department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
      sourceType: 'active',
      employeeStatus: '在职',
      trainingDate: '2026-02-01',
      entryDate: '2026-02-01',
      resignedDate: ''
    },
    {
      employeeNo: 'SELF1',
      channelType: '自主社招',
      channelName: '正式招聘+JZ001',
      trainingDate: '2026-06-10'
    },
    {
      employeeNo: 'SELF2',
      channelType: '自主社招',
      channelName: '试用招聘+JZ002',
      trainingDate: '2026-06-11'
    }
  ];

  const result = buildSelfSourcingEfficiency({
    yearMonth: '2026-06',
    asOfDate: '2026-06-30',
    employees,
    filters: { recruiter: '正式招聘' }
  });

  assert.deepEqual(result.map((item) => [item.stage, item.recruiterCount, item.trainingCount]), [
    ['整体', 1, 1],
    ['试用期', 0, 0],
    ['正式期', 1, 1]
  ]);
});

test('self sourcing details expose recruiter options and support recruiter filter', () => {
  const details = [
    { channelType: '自主社招', channelName: '张三+JZ001', employeeNo: 'A' },
    { channelType: '自主社招', channelName: '李四+JZ002', employeeNo: 'B' },
    { channelType: '自主社招', channelName: '张三+JZ001', employeeNo: 'C' },
    { channelType: '内推', channelName: '王五+JZ003', employeeNo: 'D' },
    { channelType: '自主社招', channelName: '', employeeNo: 'E' }
  ];

  assert.deepEqual(buildSelfSourcingRecruiterOptions(details), ['李四', '张三']);
  assert.deepEqual(
    filterSelfSourcingTrainingDetails(details, { recruiter: '张三' }).map((item) => item.employeeNo),
    ['A', 'C']
  );
  assert.deepEqual(
    filterSelfSourcingTrainingDetails(details, {}).map((item) => item.employeeNo),
    ['A', 'B', 'C', 'E']
  );
});

test('self sourcing recruiter rows summarize months through selected month', () => {
  const rows = buildSelfSourcingRecruiterRows({
    yearMonth: '2026-05',
    asOfDate: '2026-05-31',
    employees: [
      {
        employeeNo: 'R001',
        name: '张三',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2025-01-01',
        entryDate: '2025-01-01',
        resignedDate: ''
      },
      {
        employeeNo: 'R002',
        name: '李四',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2026-05-10',
        entryDate: '2026-05-10',
        resignedDate: ''
      },
      {
        employeeNo: 'R003',
        name: '王五',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'resigned',
        employeeStatus: '离职',
        trainingDate: '2026-02-01',
        entryDate: '2026-02-01',
        resignedDate: '2026-03-15'
      },
      {
        employeeNo: 'R004',
        name: '去年离职',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'resigned',
        employeeStatus: '离职',
        trainingDate: '2025-01-01',
        entryDate: '2025-01-01',
        resignedDate: '2025-12-31'
      },
      {
        employeeNo: 'R005',
        name: '当月离职',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'resigned',
        employeeStatus: '离职',
        trainingDate: '2025-01-01',
        entryDate: '2025-01-01',
        resignedDate: '2026-05-20'
      },
      { employeeNo: 'A', channelType: '自主社招', channelName: '张三+R001', trainingDate: '2026-01-10', resignedDate: '' },
      { employeeNo: 'B', channelType: '自主社招', channelName: '张三+R001', trainingDate: '2026-05-01', resignedDate: '' },
      { employeeNo: 'C', channelType: '自主社招', channelName: '张三+R001', trainingDate: '2026-05-25', resignedDate: '' },
      { employeeNo: 'D', channelType: '自主社招', channelName: '张三+R001', trainingDate: '2026-05-03', resignedDate: '2026-05-05' },
      { employeeNo: 'E', channelType: '自主社招', channelName: '李四+R002', trainingDate: '2026-05-12', resignedDate: '' },
      { employeeNo: 'G', channelType: '自主社招', channelName: '当月离职+R005', trainingDate: '2026-05-08', resignedDate: '' },
      { employeeNo: 'F', channelType: '自主社招', channelName: '未匹配招聘+R999', trainingDate: '2026-05-12', resignedDate: '' }
    ]
  });
  const zhang = rows.find((row) => row.name === '张三');

  assert.deepEqual(rows.map((row) => [row.name, row.employeeStatus]), [
    ['李四', '在职'],
    ['张三', '在职'],
    ['当月离职', '离职']
  ]);
  assert.deepEqual(zhang.months.map((month) => month.label), ['1月', '2月', '3月', '4月', '5月']);
  assert.equal(zhang.actualAchievement, 3);
  assert.equal(zhang.monthlyTrainingTarget, 20);
  assert.equal(zhang.monthlyCutoffTarget, 20);
  assert.equal(zhang.sevenDayTrainingTarget, 12);
  assert.equal(zhang.sevenDayCutoffTarget, 12);
  assert.equal(zhang.sevenDayRetainedCount, 1);
  assert.deepEqual(zhang.actualDetails.map((item) => [item.employeeNo, item.name, item.employeeStatus]), [
    ['B', '', ''],
    ['C', '', ''],
    ['D', '', '']
  ]);
  assert.deepEqual(zhang.sevenDayRetainedDetails.map((item) => item.employeeNo), ['B']);
  const lisi = rows.find((row) => row.name === '李四');
  assert.equal(lisi.monthlyTrainingTarget, 12);
  assert.equal(lisi.monthlyCutoffTarget, 12);
  assert.equal(lisi.sevenDayTrainingTarget, 8);
  assert.equal(lisi.sevenDayCutoffTarget, 8);
  assert.deepEqual(zhang.months.map((month) => month.sevenDayRetainedCount), [1, 0, 0, 0, 1]);
  assert.deepEqual(zhang.efficiencyChartMonths.map((month) => month.label), ['1月', '2月', '3月', '4月', '5月']);
  assert.deepEqual(zhang.cumulativeSevenDayDetails.map((item) => item.employeeNo), ['A', 'B']);
  assert.deepEqual(lisi.efficiencyChartMonths.map((month) => month.label), ['5月']);
  assert.deepEqual(lisi.cumulativeSevenDayDetails.map((item) => item.employeeNo), ['E']);
  assert.equal(lisi.cutoffMonthlyAverageSevenDayEfficiency, '1.0');
  assert.equal(lisi.cumulativeSevenDayEfficiency, '1.0');
  assert.equal(zhang.cutoffMonthlyAverageSevenDayEfficiency, '0.4');
  assert.equal(zhang.cumulativeSevenDayEfficiency, '2.0');
  assert.equal(zhang.riskStatus, '高风险');
  assert.doesNotMatch(zhang.riskReason, /连续3个月7天人效低于目标/);
  assert.match(zhang.riskReason, /流失偏高33%/);
  assert.equal(zhang.diagnosis.hasThreeMonthLowSevenDayEfficiency, false);
  assert.equal(zhang.diagnosis.hasHighAttrition, true);
  assert.equal(rows.some((row) => row.name === '王五'), false);
  assert.equal(rows.some((row) => row.name === '去年离职'), false);
  assert.equal(rows.some((row) => row.name === '未匹配招聘'), false);
});

test('self sourcing recruiter rows include current month funnel diagnosis', () => {
  const rows = buildSelfSourcingRecruiterRows({
    yearMonth: '2026-05',
    asOfDate: '2026-05-31',
    interviews: [
      { channelType: '自主社招', channelName: '张三+R001', feedbackResult: '推荐', phone: '13900000001', feedbackDate: '2026-05-01' },
      { channelType: '自主社招', channelName: '张三+R001', feedbackResult: '不推荐', phone: '13900000002', feedbackDate: '2026-05-02' }
    ],
    employees: [
      {
        employeeNo: 'R001',
        name: '张三',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2025-01-01',
        entryDate: '2025-01-01',
        resignedDate: ''
      },
      { employeeNo: 'A', phone: '13900000001', channelType: '自主社招', channelName: '张三+R001', trainingDate: '2026-05-10', resignedDate: '' }
    ]
  });

  const zhang = rows.find((row) => row.name === '张三');
  assert.equal(zhang.recruitmentFunnel.interviewCount, 2);
  assert.equal(zhang.recruitmentFunnel.passedCount, 1);
  assert.equal(zhang.recruitmentFunnel.trainingCount, 1);
  assert.deepEqual(zhang.recruitmentFunnel.diagnosisPath.map((item) => item.stage), ['参培达成', '7天留存']);
  assert.match(zhang.recruitmentFunnel.diagnosisPath[0].diagnosis, /参培未达标/);
  assert.match(zhang.recruitmentFunnel.diagnosisPath[0].suggestion, /提升参培率/);
  assert.match(zhang.recruitmentFunnel.diagnosisPath[1].diagnosis, /7天人效未达标/);
  assert.match(zhang.recruitmentFunnel.diagnosisPath[1].suggestion, /提升留存率/);
  assert.equal(zhang.recruitmentFunnel.diagnosisPath.every((item) => item.suggestion), true);
});

test('self sourcing recruiter diagnosis follows risk flags', () => {
  const employees = [
    {
      employeeNo: 'R001',
      name: '曹洋',
      position: '招聘专员',
      department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
      sourceType: 'active',
      employeeStatus: '在职',
      trainingDate: '2025-01-01',
      entryDate: '2025-01-01',
      resignedDate: ''
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: `MAY${index + 1}`,
      channelType: '自主社招',
      channelName: '曹洋+R001',
      trainingDate: `2026-05-${String(index + 1).padStart(2, '0')}`,
      resignedDate: ''
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: `APR${index + 1}`,
      channelType: '自主社招',
      channelName: '曹洋+R001',
      trainingDate: `2026-04-${String(index + 1).padStart(2, '0')}`,
      resignedDate: ''
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: `MAR${index + 1}`,
      channelType: '自主社招',
      channelName: '曹洋+R001',
      trainingDate: `2026-03-${String(index + 1).padStart(2, '0')}`,
      resignedDate: ''
    }))
  ];
  const rows = buildSelfSourcingRecruiterRows({
    yearMonth: '2026-05',
    asOfDate: '2026-05-31',
    employees
  });

  const caoyang = rows.find((row) => row.name === '曹洋');
  assert.equal(caoyang.sevenDayRetainedCount, 8);
  assert.equal(caoyang.sevenDayTrainingTarget, 12);
  assert.equal(caoyang.riskStatus, '需关注');
  assert.equal(caoyang.diagnosis.hasThreeMonthLowSevenDayEfficiency, true);
  assert.match(caoyang.riskReason, /连续3个月7天人效低于目标/);
  assert.deepEqual(caoyang.recruitmentFunnel.diagnosisPath.map((item) => item.stage), ['参培达成', '7天留存', '连续人效']);
  assert.match(caoyang.recruitmentFunnel.diagnosisPath[1].diagnosis, /7天人效未达标/);
  assert.match(caoyang.recruitmentFunnel.diagnosisPath[2].diagnosis, /连续3个月7天人效低于目标/);
});

test('self sourcing risk status follows seven day achievement rate', () => {
  const retainedEmployees = Array.from({ length: 10 }, (_, index) => ({
    employeeNo: `SELF${index + 1}`,
    channelType: '自主社招',
    channelName: '正式招聘+R001',
    trainingDate: `2026-05-${String(index + 1).padStart(2, '0')}`,
    resignedDate: ''
  }));
  const rows = buildSelfSourcingRecruiterRows({
    yearMonth: '2026-05',
    asOfDate: '2026-05-31',
    employees: [
      {
        employeeNo: 'R001',
        name: '正式招聘',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2025-01-01',
        entryDate: '2025-01-01',
        resignedDate: ''
      },
      ...retainedEmployees
    ]
  });

  const row = rows.find((item) => item.name === '正式招聘');
  assert.equal(row.sevenDayRetainedCount, 10);
  assert.equal(row.sevenDayCutoffTarget, 12);
  assert.equal(row.sevenDayAchievementRateText, '83.33%');
  assert.equal(row.monthlyGap, -10);
  assert.equal(row.riskStatus, '正常达标');
});

test('self sourcing achieved recruiter with high attrition is normal by seven day rate', () => {
  const retainedEmployees = Array.from({ length: 18 }, (_, index) => ({
    employeeNo: `RETAINED${index + 1}`,
    channelType: '自主社招',
    channelName: '达标招聘+R001',
    trainingDate: `2026-05-${String(index + 1).padStart(2, '0')}`,
    resignedDate: ''
  }));
  const resignedEmployees = Array.from({ length: 10 }, (_, index) => ({
    employeeNo: `RESIGNED${index + 1}`,
    channelType: '自主社招',
    channelName: '达标招聘+R001',
    trainingDate: `2026-05-${String(index + 1).padStart(2, '0')}`,
    resignedDate: `2026-05-${String(index + 2).padStart(2, '0')}`
  }));
  const rows = buildSelfSourcingRecruiterRows({
    yearMonth: '2026-05',
    asOfDate: '2026-05-31',
    employees: [
      {
        employeeNo: 'R001',
        name: '达标招聘',
        position: '招聘专员',
        department: '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组',
        sourceType: 'active',
        employeeStatus: '在职',
        trainingDate: '2025-01-01',
        entryDate: '2025-01-01',
        resignedDate: ''
      },
      ...retainedEmployees,
      ...resignedEmployees
    ]
  });

  const row = rows.find((item) => item.name === '达标招聘');
  assert.equal(row.actualAchievement, 28);
  assert.equal(row.monthlyCutoffTarget, 20);
  assert.equal(row.sevenDayRetainedCount, 18);
  assert.equal(row.sevenDayCutoffTarget, 12);
  assert.match(row.riskReason, /流失偏高/);
  assert.equal(row.riskStatus, '正常达标');
});

test('interview normalization resolves feedback dates for daily overwrite', () => {
  const record = normalizeInterviewRecord({
    职位名称: '【江苏基地】南京10010热线客服',
    候选人名称: '候选人',
    性别: '男',
    电话: '18636483047',
    面试官填写反馈时间: '2026-06-25',
    面试官反馈结果: '推荐',
    面试官: '江苏基地面试官',
    猎头公司标签: '自主社招',
    猎头合约名称: '刘薇+JZ073036',
    内推人: '-',
    综合评价: '评价'
  });

  assert.equal(record.base, '江苏基地-南京');
  assert.equal(record.channelType, '自主社招');
  assert.equal(record.channelName, '刘薇+JZ073036');
  assert.equal(record.feedbackDate, '2026-06-25');
  assert.deepEqual(resolveInterviewOverwriteDates([record]), ['2026-06-25']);
});

test('interview position name infers base', () => {
  assert.equal(inferInterviewBase('【韶关基地-南二在线项目】一线在线客服'), '南二在线客服项目');
  assert.equal(inferInterviewBase('【长春基地】辽宁10016外呼客服'), '辽宁外呼项目');
  assert.equal(inferInterviewBase('中国联通智慧客服-成都'), '成都基地');
  assert.equal(inferInterviewBase('【湖南基地】荷花10010热线客服'), '湖南基地-荷花');
});

test('interview filters use cleaned funnel dimensions', () => {
  const { whereSql, params } = buildInterviewFilters({
    yearMonth: '2026-06',
    base: '江苏基地-南京',
    channelType: '自主社招',
    channelName: '刘薇+JZ073036'
  });

  assert.match(whereSql, /feedback_date >= \$1/);
  assert.match(whereSql, /base = \$3/);
  assert.match(whereSql, /channel_type = \$4/);
  assert.match(whereSql, /channel_name = \$5/);
  assert.deepEqual(params, [
    '2026-06-01',
    '2026-06-31',
    '江苏基地-南京',
    '自主社招',
    '刘薇+JZ073036'
  ]);
});

test('interview funnel rows use cleaned dimensions', () => {
  const rows = buildFunnelRows([
    { base: '江苏基地-南京', feedbackResult: '推荐', phone: '13900000001' },
    { base: '江苏基地-南京', feedbackResult: '不推荐', phone: '13900000002' },
    { base: '江苏基地-淮安', feedbackResult: '强烈推荐', phone: '13900000003' }
  ], new Set(['13900000001']), (record) => record.base, 'base');

  assert.deepEqual(rows.map((row) => [row.base, row.interviewCount, row.recommendedCount, row.trainingCount, row.conversionRateText]), [
    ['江苏基地-南京', 2, 1, 1, '100.00%'],
    ['江苏基地-淮安', 1, 1, 0, '0.00%']
  ]);
});

test('monthly interview funnel uses monthly employee training totals by base', () => {
  const rows = buildMonthlyFunnelRows([
    { base: '江苏基地-南京', feedbackResult: '推荐', phone: '13900000001' },
    { base: '江苏基地-南京', feedbackResult: '不推荐', phone: '13900000002' },
    { base: '江苏基地-淮安', feedbackResult: '强烈推荐', phone: '13900000003' }
  ], [
    { employeeNo: 'JZ001', base: '江苏基地-南京', phone: '13900000001', trainingDate: '2026-06-03' },
    { employeeNo: 'JZ002', base: '江苏基地-南京', phone: '13900000001', trainingDate: '2026-07-01' },
    { employeeNo: 'JZ004', base: '江苏基地-南京', phone: '13900000004', trainingDate: '2026-06-10' },
    { employeeNo: 'JZ003', base: '江苏基地-淮安', phone: '13900000003', trainingDate: '2026-06-05' }
  ], '2026-06');

  assert.deepEqual(rows.map((row) => [
    row.base,
    row.arrivedCount,
    row.passedCount,
    row.trainingCount,
    row.passRateText,
    row.trainingRateText
  ]), [
    ['江苏基地-南京', 2, 1, 2, '50.00%', '200.00%'],
    ['江苏基地-淮安', 1, 1, 1, '100.00%', '100.00%']
  ]);
});
