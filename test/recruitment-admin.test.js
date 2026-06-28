const assert = require('node:assert/strict');
const test = require('node:test');

const { makeUniqueHeaders } = require('../service/imports/excel');
const { buildEmployeeFilters, formatBaseOptions } = require('../service/employees/repository');
const { maskPhone, parsePage, formatPercent } = require('../service/shared/format');
const { inferBase, isRecruiterEmployee, normalizeActiveEmployee, normalizeResignedEmployee } = require('../service/employees/normalize');
const { calculateTargetProgress } = require('../service/targets/progress');
const { normalizeInterviewRecord, resolveInterviewOverwriteDates } = require('../service/interviews/normalize');

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

  assert.equal(record.feedbackDate, '2026-06-25');
  assert.deepEqual(resolveInterviewOverwriteDates([record]), ['2026-06-25']);
});
