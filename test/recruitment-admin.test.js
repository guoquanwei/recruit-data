const assert = require('node:assert/strict');
const test = require('node:test');

const { makeUniqueHeaders } = require('../service/imports/excel');
const { buildCsv } = require('../service/export/csv');
const { buildEmployeeFilters, formatBaseOptions } = require('../service/employees/repository');
const { buildInterviewFilters } = require('../service/interviews/repository');
const { maskPhone, parsePage, formatPercent } = require('../service/shared/format');
const { inferBase, isRecruiterEmployee, normalizeActiveEmployee, normalizeResignedEmployee } = require('../service/employees/normalize');
const { calculateTargetProgress } = require('../service/targets/progress');
const { includeActualOnlyTargets, summarizeTargetPlan, summarizeTargets } = require('../service/targets/service');
const { buildBatchDrilldown, buildBatchMatrix, buildDashboardMatrix, buildOverviewInsights, buildPositionChannelBoard } = require('../service/dashboard/service');
const { inferInterviewBase, normalizeInterviewRecord, resolveInterviewOverwriteDates } = require('../service/interviews/normalize');
const { buildFunnelRows, buildMonthlyFunnelRows } = require('../service/interviews/service');

test('shared formatting masks phone numbers and parses pagination defaults', () => {
  assert.equal(maskPhone('13915993720'), '139****3720');
  assert.equal(maskPhone(''), '');
  assert.deepEqual(parsePage({}), { page: 1, pageSize: 10, limit: 10, offset: 0 });
  assert.equal(formatPercent(0.875), '87.50%');
  assert.equal(formatPercent(null), '0.00%');
});

test('excel helper keeps duplicate headers addressable like spreadsheet tools', () => {
  assert.deepEqual(
    makeUniqueHeaders(['部门', '职位', '姓名', '部门', '职位']),
    ['部门', '职位', '姓名', '部门.1', '职位.1']
  );
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

test('employee filters support single-select enums and fuzzy channel names', () => {
  const { whereSql, params } = buildEmployeeFilters({
    base: '江苏基地-南京',
    channelName: '尹翔宇+JZ005942',
    channelType: '自主社招',
    startDate: '2026-01-01',
    endDate: '2026-06-30'
  });

  assert.match(whereSql, /base = @base/);
  assert.match(whereSql, /channel_name LIKE @channelName/);
  assert.match(whereSql, /channel_type = @channelType/);
  assert.match(whereSql, /training_date >= @startDate/);
  assert.match(whereSql, /training_date <= @endDate/);
  assert.doesNotMatch(whereSql, /entry_date/);
  assert.equal(params.base, '江苏基地-南京');
  assert.equal(params.channelName, '%尹翔宇+JZ005942%');
  assert.equal(params.channelType, '自主社招');
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

test('target progress sums monthly and cutoff targets and de-duplicates employees', () => {
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
  assert.equal(result.actualTraining, 2);
  assert.equal(result.gap, -8);
  assert.equal(result.achievementRateText, '20.00%');
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
});

test('target progress includes actual-only base channel combinations', () => {
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
  assert.deepEqual(summary.bases[0].channelRows.map((row) => [row.channel, row.monthlyTarget, row.actualTraining]), [
    ['渠道社招', 0, 1],
    ['自主社招', 1, 1],
    ['合计', 1, 2]
  ]);
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
  assert.deepEqual(batchMatrix.summary, { risk: 2, warning: 1, achieved: 0, empty: 1 });
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
    interviews: [],
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
  assert.equal(board.selectedBatch.day, 10);
  assert.deepEqual(board.selectedBatch.channels.map((item) => [item.channel, item.target, item.actualTraining, item.gap]), [
    ['回流', 2, 1, -1],
    ['内推', 3, 1, -2],
    ['渠道社招', 4, 1, -3],
    ['自主社招', 5, 0, -5]
  ]);
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
    ['江苏基地-淮安', 8, '80.00%', 'risk'],
    ['长春热线项目', 3, '30.00%', 'risk'],
    ['南二在线客服项目', 4, '40.00%', 'risk'],
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

  assert.match(whereSql, /feedback_date >= @monthStart/);
  assert.match(whereSql, /base = @base/);
  assert.match(whereSql, /channel_type = @channelType/);
  assert.match(whereSql, /channel_name = @channelName/);
  assert.equal(params.base, '江苏基地-南京');
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
