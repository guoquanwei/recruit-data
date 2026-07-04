const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const runtime = require('../config/runtime');
const { importActiveEmployees, importResignedEmployees } = require('../service/employees/importer');
const { buildEmployeeImportTemplateWorkbook, getEmployeeImportTemplateConfig } = require('../service/employees/importTemplate');
const { getEmployeeExportRows, getEmployeeList } = require('../service/employees/service');
const { sendCsv } = require('../service/export/csv');
const { importInterviewRecords } = require('../service/interviews/importer');
const { buildInterviewImportTemplateWorkbook, getInterviewImportTemplateConfig } = require('../service/interviews/importTemplate');
const { getInterviewExportRows, getInterviewFunnel, getInterviewList } = require('../service/interviews/service');
const { getDashboardOverview } = require('../service/dashboard/service');
const { importMonthlyTargets } = require('../service/targets/importer');
const { buildTargetImportTemplateWorkbook, getTargetImportTemplateConfig } = require('../service/targets/importTemplate');
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

async function sendWorkbookTemplate(res, config, workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  const encodedFilename = encodeURIComponent(config.filename);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
  res.send(Buffer.from(buffer));
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

const PROTOTYPE_INVITE_ARRIVE_RATE = 0.8;
const PROTOTYPE_TODAY = '5月5日';

function parsePrototypeMonthDay(value) {
  const match = String(value || '').trim().match(/(\d+)月(\d+)日/);
  if (!match) {
    return null;
  }

  return {
    month: Number(match[1]),
    day: Number(match[2])
  };
}

function formatPrototypeMonthDay(date) {
  return `${date.month}月${date.day}日`;
}

function getPrototypeActionPeriod(processWindow, todayText = PROTOTYPE_TODAY) {
  const [startText, endText] = String(processWindow || '').split('-').map((part) => part.trim());
  const start = parsePrototypeMonthDay(startText);
  const end = parsePrototypeMonthDay(endText);
  const today = parsePrototypeMonthDay(todayText);

  if (!start || !end || !today) {
    return {
      label: processWindow,
      days: 1
    };
  }

  const periodStart = today.month > start.month || (today.month === start.month && today.day >= start.day)
    ? today
    : start;
  const days = Math.max(1, end.day - periodStart.day + 1);

  return {
    label: `${formatPrototypeMonthDay(periodStart)} - ${formatPrototypeMonthDay(end)}`,
    days
  };
}

function buildPrototypeSelfActionItems(channel, batch, today = PROTOTYPE_TODAY) {
  const period = getPrototypeActionPeriod(batch.processWindow, today);
  const arrivedGap = Math.max(0, Number(channel.expectedArrived || 0) - Number(channel.actualArrived || 0));
  const dailyArrived = Math.max(1, Math.ceil(arrivedGap / period.days));
  const dailyInvite = Math.max(1, Math.ceil(arrivedGap / PROTOTYPE_INVITE_ARRIVE_RATE / period.days));
  const recruiterCount = Number(channel.recruiterCount || 4);
  const perRecruiterInvite = Math.max(1, Math.ceil(dailyInvite / recruiterCount));
  const currentDailyCapacity = Number(channel.currentDailyCapacity || 0);
  const capacityOk = currentDailyCapacity >= dailyInvite;

  return [
    `${period.label}每天至少完成 ${dailyArrived} 人有效到面，对应每天约 ${dailyInvite} 人有效邀约。`,
    capacityOk
      ? `当前自招有 ${recruiterCount} 名招聘专员，均摊后每人每天需要完成约 ${perRecruiterInvite} 人有效邀约；人力测算可承接当前缺口，优先把邀约和到面动作做满，暂不扩编。`
      : `当前自招有 ${recruiterCount} 名招聘专员，均摊后每人每天需要完成约 ${perRecruiterInvite} 人有效邀约，按现有人力日均约 ${currentDailyCapacity} 人邀约，存在产能缺口，建议增加招聘专员或临时加人。`,
    '如果每天邀约人数完成了，但实际到面仍然不足，说明候选人爽约较多，需要提前讲清岗位要求、薪资、工作地点和到岗时间，减少无效邀约。'
  ];
}

function buildPrototypeRpoActionItems(channel, batch, today = PROTOTYPE_TODAY) {
  const period = getPrototypeActionPeriod(batch.processWindow, today);
  const arrivedGap = Math.max(0, Number(channel.expectedArrived || 0) - Number(channel.actualArrived || 0));
  const dailyArrived = Math.max(1, Math.ceil(arrivedGap / period.days));
  const supplierCount = Number(channel.supplierCount || 3);
  const perSupplierDaily = Math.max(1, Math.ceil(dailyArrived / supplierCount));
  const supplierCapacity = Number(channel.supplierDailyCapacity || 0);
  const capacityGap = Math.max(0, dailyArrived - supplierCapacity);
  const suggestedNewSuppliers = Number(
    channel.suggestedNewSuppliers ?? (capacityGap > 0 ? 1 : 0)
  );
  const items = [
    `${period.label}每天需完成 ${dailyArrived} 人到面，当前 ${supplierCount} 家供应商平均每家每天需提升到 ${perSupplierDaily} 人到面。`,
    capacityGap > 0
      ? `现有供应商池最近日均到面约 ${supplierCapacity} 人，低于后续所需 ${dailyArrived} 人，存在 ${capacityGap} 人/天产能缺口。`
      : `现有供应商池最近日均到面约 ${supplierCapacity} 人，已达到后续所需 ${dailyArrived} 人/天。`
  ];

  if (suggestedNewSuppliers > 0) {
    items.push(`若现有供应商无法提升到该节奏，建议新增 ${suggestedNewSuppliers} 家 RPO 供应商或要求现有供应商短期加量。`);
  }

  return items;
}

function enrichPrototypeChannelPlan(channel, batch, today = PROTOTYPE_TODAY) {
  if (channel.status === 'achieved') {
    return {
      ...channel,
      actionItems: channel.actionItems || []
    };
  }

  if (channel.key === 'self') {
    return {
      ...channel,
      diagnosis: channel.diagnosis || `到面人数未达标，当前候选人储备无法支撑 ${batch.label} 到岗。`,
      actionItems: buildPrototypeSelfActionItems(channel, batch, today)
    };
  }

  if (channel.key === 'rpo') {
    return {
      ...channel,
      diagnosis: channel.diagnosis || `渠道社招整体到面不足，现有供应商池日均到面能力低于 ${batch.label} 达成节奏。`,
      actionItems: buildPrototypeRpoActionItems(channel, batch, today)
    };
  }

  return channel;
}

function enrichPrototypeBatch(batch, today = PROTOTYPE_TODAY) {
  return {
    ...batch,
    channels: batch.channels.map((channel) => enrichPrototypeChannelPlan(channel, batch, today))
  };
}

function buildBaseRiskFunnelPrototype(selectedChannel = '', selectedBatchDay = '') {
  const riskChannels = [
    {
      key: 'self',
      name: '自主社招',
      owner: '自招团队',
      status: 'risk',
      statusText: '高风险',
      target: 20,
      actualTraining: 12,
      expectedArrived: 72,
      actualArrived: 40,
      expectedPassed: 50,
      actualPassed: 26,
      recruiterCount: 4,
      currentDailyCapacity: 18,
      diagnosis: '到面人数未达标，当前候选人储备无法支撑本批次到岗。',
      actionTitle: '每日邀约动作量',
      actionSummary: '自招团队需把待补到面量继续倒推到邀约动作，并结合招聘专员投入判断是否需要加人。',
      compareItems: [
        { label: '自招到面目标', actual: 40, target: 72, unit: '人' },
        { label: '面通目标', actual: 26, target: 50, unit: '人' },
        { label: '入职目标', actual: 12, target: 20, unit: '人' }
      ]
    },
    {
      key: 'rpo',
      name: '渠道社招',
      owner: 'RPO 供应商池',
      status: 'risk',
      statusText: '高风险',
      target: 20,
      actualTraining: 10,
      expectedArrived: 72,
      actualArrived: 38,
      expectedPassed: 50,
      actualPassed: 22,
      supplierCount: 3,
      supplierDailyCapacity: 4,
      supplierRequiredDaily: 5,
      supplierPerRequiredDaily: 2,
      suggestedNewSuppliers: 1,
      diagnosis: '渠道社招整体到面不足，现有供应商池日均到面能力低于后续达成节奏。',
      actionTitle: '供应商池够不够',
      actionSummary: '系统不拆分供应商目标，只判断现有供应商池是否能支撑批次到面需求。',
      compareItems: [
        { label: '渠道社招到面目标', actual: 38, target: 72, unit: '人' },
        { label: '现有供应商日均', actual: 4, target: 5, unit: '人/天' },
        { label: '单家需提升到', actual: 1.3, target: 2, unit: '人/天' }
      ]
    },
    {
      key: 'referral',
      name: '内推',
      owner: '基地负责人',
      status: 'warning',
      statusText: '需关注',
      target: 10,
      actualTraining: 7,
      expectedArrived: 36,
      actualArrived: 30,
      expectedPassed: 25,
      actualPassed: 21,
      diagnosis: '内推渠道低于批次目标，但不做复杂产能测算，重点提示基地侧加强宣导。',
      actionTitle: '内推宣导提醒',
      actionSummary: '内推未达标时输出通用管理建议，帮助基地负责人推动员工转介绍。',
      actionItems: [
        '基地负责人在班前会 / 班后会加强岗位需求、到岗时间和奖励政策宣导。',
        '推动班组长收集员工推荐名单，并对已推荐候选人及时跟进邀约和到面。',
        '将内推缺口纳入基地周度复盘，持续提醒员工转介绍。'
      ],
      compareItems: [
        { label: '内推到面目标', actual: 30, target: 36, unit: '人' },
        { label: '面通目标', actual: 21, target: 25, unit: '人' },
        { label: '入职目标', actual: 7, target: 10, unit: '人' }
      ]
    }
  ];
  const achievedChannels = [
    {
      key: 'self',
      name: '自主社招',
      owner: '自招团队',
      status: 'achieved',
      statusText: '已达成',
      target: 18,
      actualTraining: 21,
      expectedArrived: 65,
      actualArrived: 70,
      expectedPassed: 45,
      actualPassed: 48,
      diagnosis: '该渠道到岗目标已达成，当前无需额外提升动作。',
      actionTitle: '提升方案',
      actionItems: [],
      compareItems: [
        { label: '自招到面目标', actual: 70, target: 65, unit: '人' },
        { label: '面通目标', actual: 48, target: 45, unit: '人' },
        { label: '入职目标', actual: 21, target: 18, unit: '人' }
      ]
    },
    {
      key: 'rpo',
      name: '渠道社招',
      owner: 'RPO 供应商池',
      status: 'achieved',
      statusText: '已达成',
      target: 17,
      actualTraining: 19,
      expectedArrived: 61,
      actualArrived: 64,
      expectedPassed: 43,
      actualPassed: 45,
      supplierCount: 3,
      supplierDailyCapacity: 6,
      supplierRequiredDaily: 0,
      supplierPerRequiredDaily: 0,
      suggestedNewSuppliers: 0,
      diagnosis: '现有供应商池已支撑本批次达成，当前无需新增供应商。',
      actionTitle: '提升方案',
      actionItems: [],
      compareItems: [
        { label: '渠道社招到面目标', actual: 64, target: 61, unit: '人' },
        { label: '现有供应商日均', actual: 6, target: 5, unit: '人/天' },
        { label: '入职目标', actual: 19, target: 17, unit: '人' }
      ]
    },
    {
      key: 'referral',
      name: '内推',
      owner: '基地负责人',
      status: 'achieved',
      statusText: '已达成',
      target: 15,
      actualTraining: 16,
      expectedArrived: 54,
      actualArrived: 58,
      expectedPassed: 38,
      actualPassed: 40,
      diagnosis: '内推目标已达成，保持当前内推宣导和转介绍跟进节奏。',
      actionTitle: '提升方案',
      actionItems: [],
      compareItems: [
        { label: '内推到面目标', actual: 58, target: 54, unit: '人' },
        { label: '面通目标', actual: 40, target: 38, unit: '人' },
        { label: '入职目标', actual: 16, target: 15, unit: '人' }
      ]
    }
  ];
  const firstBatchChannels = [
    { ...riskChannels[0] },
    {
      ...achievedChannels[1],
      target: 20,
      actualTraining: 20,
      diagnosis: '渠道社招目标已达成，保持供应商跟进节奏。',
      compareItems: [
        { label: '渠道社招到面目标', actual: 72, target: 72, unit: '人' },
        { label: '现有供应商日均', actual: 5, target: 5, unit: '人/天' },
        { label: '入职目标', actual: 20, target: 20, unit: '人' }
      ]
    },
    {
      ...achievedChannels[2],
      target: 10,
      actualTraining: 10,
      diagnosis: '内推目标已达成，保持基地内推宣导节奏。',
      compareItems: [
        { label: '内推到面目标', actual: 36, target: 36, unit: '人' },
        { label: '面通目标', actual: 25, target: 25, unit: '人' },
        { label: '入职目标', actual: 10, target: 10, unit: '人' }
      ]
    }
  ];
  const secondBatchChannels = [
    {
      ...riskChannels[0],
      status: 'warning',
      statusText: '需关注',
      actualTraining: 17,
      actualArrived: 58,
      actualPassed: 38,
      diagnosis: '自主社招低于批次目标，需继续跟进剩余候选人到岗确认。'
    },
    riskChannels[1],
    {
      ...achievedChannels[2],
      target: 10,
      actualTraining: 15,
      diagnosis: '内推目标已达成，保持基地内推宣导节奏。',
      compareItems: [
        { label: '内推到面目标', actual: 42, target: 36, unit: '人' },
        { label: '面通目标', actual: 30, target: 25, unit: '人' },
        { label: '入职目标', actual: 15, target: 10, unit: '人' }
      ]
    }
  ];
  const batches = [
    {
      day: '12',
      label: '5月12日批次',
      processWindow: '5月1日 - 5月11日',
      acceptanceWindow: '5月12日 - 5月13日',
      target: 50,
      actualTraining: 42,
      status: 'risk',
      statusText: '高风险',
      channels: firstBatchChannels
    },
    {
      day: '20',
      label: '5月20日批次',
      processWindow: '5月13日 - 5月19日',
      acceptanceWindow: '5月20日 - 5月21日',
      target: 50,
      actualTraining: 42,
      status: 'warning',
      statusText: '需关注',
      channels: secondBatchChannels
    },
    {
      day: '26',
      label: '5月26日批次',
      processWindow: '5月21日 - 5月25日',
      acceptanceWindow: '5月26日 - 5月27日',
      target: 50,
      actualTraining: 56,
      status: 'achieved',
      statusText: '已达成',
      channels: achievedChannels
    }
  ].map((batch) => enrichPrototypeBatch(batch));
  const selectedBatch = batches.find((batch) => batch.day === selectedBatchDay) || batches[0];
  const channels = selectedBatch.channels;
  const selected = channels.find((channel) => channel.key === selectedChannel) || channels[0];
  const selectedBatchDayNumber = Number(selectedBatch.day);
  const totals = channels.reduce((summary, channel) => ({
    target: summary.target + channel.target,
    actualTraining: summary.actualTraining + channel.actualTraining,
    expectedArrived: summary.expectedArrived + channel.expectedArrived,
    actualArrived: summary.actualArrived + channel.actualArrived,
    expectedPassed: summary.expectedPassed + channel.expectedPassed,
    actualPassed: summary.actualPassed + channel.actualPassed
  }), {
    target: 0,
    actualTraining: 0,
    expectedArrived: 0,
    actualArrived: 0,
    expectedPassed: 0,
    actualPassed: 0
  });
  const overall = batches.reduce((summary, batch) => ({
    target: summary.target + batch.target,
    actualTraining: summary.actualTraining + batch.actualTraining,
    riskBatchCount: summary.riskBatchCount + (batch.status === 'risk' || batch.status === 'warning' ? 1 : 0)
  }), {
    target: 0,
    actualTraining: 0,
    riskBatchCount: 0
  });
  const monthlyChannels = Array.from(
    batches.reduce((channelMap, batch) => {
      batch.channels.forEach((channel) => {
        const current = channelMap.get(channel.name) || {
          channel: channel.name,
          monthlyTarget: 0,
          actualTraining: 0
        };
        current.monthlyTarget += channel.target;
        current.actualTraining += channel.actualTraining;
        channelMap.set(channel.name, current);
      });
      return channelMap;
    }, new Map()).values()
  ).map((channel) => {
    const gap = channel.actualTraining - channel.monthlyTarget;
    const achievementRate = channel.monthlyTarget > 0 ? channel.actualTraining / channel.monthlyTarget : 0;
    const status = gap >= 0 ? 'achieved' : (achievementRate >= 0.8 ? 'warning' : 'risk');
    return {
      ...channel,
      cutoffTarget: channel.monthlyTarget,
      gap,
      achievementRate,
      achievementRateText: `${Math.round(achievementRate * 100)}%`,
      status,
      statusText: status === 'achieved' ? '健康' : (status === 'warning' ? '预警' : '风险'),
      targetShareText: '',
      actualShareText: ''
    };
  });
  const toFunnelRow = (channel) => {
    const passRate = channel.actualArrived > 0 ? channel.actualPassed / channel.actualArrived : 0;
    const trainingRate = channel.actualPassed > 0 ? channel.actualTraining / channel.actualPassed : 0;
    return {
      channel: channel.name,
      status: channel.status,
      statusText: channel.statusText,
      arrivedCount: channel.actualArrived,
      passedCount: channel.actualPassed,
      trainingCount: channel.actualTraining,
      passRateText: `${Math.round(passRate * 100)}%`,
      trainingRateText: `${Math.round(trainingRate * 100)}%`
    };
  };
  const buildPrototypeBatchActionPlans = (batchChannels = []) => {
    const channelsNeedingAction = batchChannels.filter((channel) => channel.status !== 'achieved');
    if (channelsNeedingAction.length === 0) {
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

    return channelsNeedingAction.map((channel) => ({
      title: `${channel.name}提升方案`,
      owner: channel.owner,
      status: channel.status,
      statusText: channel.statusText,
      focus: channel.diagnosis,
      diagnosis: channel.diagnosis,
      communicationScript: '',
      actions: channel.actionItems
    }));
  };
  const buildPrototypeBatchMainRiskText = (batch) => {
    if (batch.status === 'achieved') {
      return '当前批次目标已达成，保持现有招聘节奏';
    }

    const mainRiskChannel = batch.channels.find((channel) => channel.status === 'risk')
      || batch.channels.find((channel) => channel.status !== 'achieved');
    return `当前主要风险：${mainRiskChannel?.name || ''}${mainRiskChannel?.diagnosis || ''}`;
  };
  const batchRisks = batches.map((batch) => {
    const achievementRate = batch.target > 0 ? batch.actualTraining / batch.target : 0;
    return {
      day: Number(batch.day),
      label: batch.label,
      target: batch.target,
      actualTraining: batch.actualTraining,
      gap: batch.actualTraining - batch.target,
      achievementRate,
      achievementRateText: `${Math.round(achievementRate * 100)}%`,
      status: batch.status,
      statusText: batch.statusText,
      channels: batch.channels.map((channel) => ({
        channel: channel.name,
        target: channel.target,
        actualTraining: channel.actualTraining,
        gap: channel.actualTraining - channel.target,
        status: channel.status,
        statusText: channel.statusText,
        day: Number(batch.day)
      })),
      funnelRows: batch.channels.map(toFunnelRow),
      actionPlans: buildPrototypeBatchActionPlans(batch.channels),
      mainRiskText: buildPrototypeBatchMainRiskText(batch),
      reason: batch.status === 'achieved' ? '达标 / 正常' : '存在入职缺口',
      suggestion: '',
      worstChannel: batch.channels.find((channel) => channel.status === 'risk')?.name || ''
    };
  });
  const selectedBatchSummary = batchRisks.find((batch) => batch.day === selectedBatchDayNumber) || batchRisks[0];
  const actionPlans = selectedBatchSummary.actionPlans;
  const dashboard = {
    yearMonth: '2026-05',
    filters: {
      base: '江苏基地-淮安',
      channel: ''
    },
    options: {
      bases: ['江苏基地-淮安'],
      channels: ['回流', '内推', '渠道社招', '自主社招']
    },
    selectedCell: {
      base: '江苏基地-淮安',
      channel: '',
      selectedBatchDay: String(selectedBatchDayNumber)
    },
    positionBoard: {
      mode: 'position',
      base: '江苏基地-淮安',
      title: '江苏基地-淮安 · 多渠道岗位',
      total: {
        monthlyTarget: overall.target,
        cutoffTarget: overall.target,
        actualTraining: overall.actualTraining,
        gap: overall.actualTraining - overall.target,
        achievementRate: overall.target > 0 ? overall.actualTraining / overall.target : 0,
        achievementRateText: `${Math.round(overall.actualTraining / overall.target * 100)}%`,
        status: overall.actualTraining >= overall.target ? 'achieved' : 'risk',
        statusText: overall.actualTraining >= overall.target ? '健康' : '风险'
      },
      healthStatus: overall.actualTraining >= overall.target ? 'healthy' : 'risk',
      channels: monthlyChannels,
      funnelRows: selectedBatchSummary.funnelRows,
      actionPlans,
      batchRisks,
      selectedBatch: selectedBatchSummary,
      mainRiskText: selectedBatchSummary.mainRiskText
    }
  };

  return {
    baseName: '江苏基地-淮安',
    month: '2026-05',
    positionName: '客服二组',
    batchName: selectedBatch.label,
    processWindow: selectedBatch.processWindow,
    acceptanceWindow: selectedBatch.acceptanceWindow,
    today: '5月5日',
    remainingDays: 7,
    rates: [
      { label: '邀约到面率', value: '80%' },
      { label: '面通率', value: '70%' },
      { label: '面通参培率', value: '40%' }
    ],
    totals: {
      ...totals,
      gap: totals.actualTraining - totals.target,
      achievementRateText: `${Math.round(totals.actualTraining / totals.target * 100)}%`
    },
    overall: {
      ...overall,
      gap: overall.actualTraining - overall.target,
      achievementRateText: `${Math.round(overall.actualTraining / overall.target * 100)}%`
    },
    batches,
    selectedBatch,
    channels,
    selected,
    dashboard
  };
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

router.get('/employees/import/template/:type', async (req, res) => {
  const config = getEmployeeImportTemplateConfig(req.params.type);
  const workbook = buildEmployeeImportTemplateWorkbook(req.params.type);
  await sendWorkbookTemplate(res, config, workbook);
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

router.get('/employees/recruiters', async (req, res) => {
  renderPage(res, 'pages/employees/list', {
    active: 'employees-recruiters',
    moduleActive: 'employees',
    pageTitle: '招聘专员列表',
    heading: '招聘专员列表',
    role: 'recruiter',
    result: await getEmployeeList(req.query, 'recruiter')
  });
});

router.get('/employees/recruiters/export', async (req, res) => {
  sendCsv(res, '招聘专员列表.csv', employeeExportColumns(), await getEmployeeExportRows(req.query, 'recruiter'));
});

router.get('/employees/frontline', async (req, res) => {
  renderPage(res, 'pages/employees/list', {
    active: 'employees-frontline',
    moduleActive: 'employees',
    pageTitle: '一线员工列表',
    heading: '一线员工列表',
    role: 'frontline',
    result: await getEmployeeList(req.query, 'frontline')
  });
});

router.get('/employees/frontline/export', async (req, res) => {
  sendCsv(res, '一线员工列表.csv', employeeExportColumns(true), await getEmployeeExportRows(req.query, 'frontline'));
});

router.post('/targets/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.redirect('/targets/import?error=请选择要导入的文件');
    return;
  }
  const result = await importMonthlyTargets(req.file.path);
  cleanupUploadedFile(req.file);
  redirectWithResult(res, '/targets/import', result);
});

router.get('/targets/import', (req, res) => {
  renderPage(res, 'pages/targets/import', {
    active: 'targets-import',
    moduleActive: 'targets',
    pageTitle: '招聘目标导入',
    notice: req.query.notice,
    error: req.query.error
  });
});

router.get('/targets/import/template', async (req, res) => {
  await sendWorkbookTemplate(res, getTargetImportTemplateConfig(), buildTargetImportTemplateWorkbook());
});

router.get('/targets', async (req, res) => {
  renderPage(res, 'pages/targets/list', {
    active: 'targets-list',
    moduleActive: 'targets',
    pageTitle: '目标列表',
    result: await getTargetList(req.query),
    notice: req.query.notice,
    error: req.query.error
  });
});

router.get('/targets/export', async (req, res) => {
  sendCsv(res, '目标列表.csv', targetExportColumns(), await getTargetExportRows(req.query));
});

router.get('/targets/progress', async (req, res) => {
  renderPage(res, 'pages/targets/progress', {
    active: 'targets-progress',
    moduleActive: 'targets',
    pageTitle: '目标达成进度',
    progress: await getTargetProgress(req.query)
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

router.get('/interviews/import/template', async (req, res) => {
  await sendWorkbookTemplate(res, getInterviewImportTemplateConfig(), buildInterviewImportTemplateWorkbook());
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

router.get('/interviews', async (req, res) => {
  renderPage(res, 'pages/interviews/list', {
    active: 'interviews-list',
    moduleActive: 'interviews',
    pageTitle: '面试记录列表',
    result: await getInterviewList(req.query)
  });
});

router.get('/interviews/export', async (req, res) => {
  sendCsv(res, '面试记录列表.csv', interviewExportColumns(), await getInterviewExportRows(req.query));
});

router.get('/interviews/funnel', async (req, res) => {
  renderPage(res, 'pages/interviews/funnel', {
    active: 'interviews-funnel',
    moduleActive: 'interviews',
    pageTitle: '招聘漏斗分析',
    funnel: await getInterviewFunnel(req.query)
  });
});

router.get('/dashboard/overview', async (req, res) => {
  renderPage(res, 'pages/dashboard/overview', {
    active: 'dashboard-overview',
    moduleActive: 'dashboard',
    pageTitle: '人才开发运营看板',
    dashboard: await getDashboardOverview(req.query)
  });
});

router.get('/dashboard/base-risk', async (req, res) => {
  renderPage(res, 'pages/dashboard/base-risk', {
    active: 'dashboard-base-risk',
    moduleActive: 'dashboard',
    pageTitle: '基地风险分析',
    dashboard: await getDashboardOverview({ ...req.query, tab: 'base' })
  });
});

router.get('/dashboard/self-sourcing', async (req, res) => {
  if (req.headers.accept === 'application/json' || req.query.ajax) {
    const data = await getDashboardOverview({ ...req.query, tab: 'self' });
    return res.json(data);
  }
  renderPage(res, 'pages/dashboard/self-sourcing', {
    active: 'dashboard-self-sourcing',
    moduleActive: 'dashboard',
    pageTitle: '自主社招人效',
    dashboard: await getDashboardOverview({ ...req.query, tab: 'self' })
  });
});

router.get('/prototype/base-risk-funnel', (req, res) => {
  const selectedBatchDay = req.query.selectedBatchDay || req.query.batch;
  renderPage(res, 'pages/prototypes/base-risk-funnel', {
    active: '',
    moduleActive: 'dashboard',
    pageTitle: '基地风险漏斗诊断原型',
    riskPrototype: buildBaseRiskFunnelPrototype(req.query.channel, selectedBatchDay)
  });
});

router.get('/candidates', (req, res) => res.redirect('/employees/frontline'));
router.get('/progress', (req, res) => res.redirect('/targets/progress'));
router.get('/channels', (req, res) => res.redirect('/dashboard/overview'));
router.get('/settings', (req, res) => res.redirect('/employees/import'));

module.exports = router;