const express = require('express');

const router = express.Router();

const pages = {
  '/': {
    view: 'pages/dashboard',
    active: 'dashboard',
    pageTitle: '仪表盘',
    heading: '招聘数据概览',
    description: '平台骨架已就绪，后续需求将接入招聘指标、趋势图表和核心数据。'
  },
  '/candidates': {
    view: 'pages/candidates',
    active: 'candidates',
    pageTitle: '候选人管理',
    heading: '候选人管理',
    description: '当前仅提供空状态页面，候选人字段和表结构将在后续需求中设计。'
  },
  '/progress': {
    view: 'pages/progress',
    active: 'progress',
    pageTitle: '招聘进度',
    heading: '招聘进度管理',
    description: '当前仅提供空状态页面，面试流程和录用状态将在后续需求中设计。'
  },
  '/channels': {
    view: 'pages/channels',
    active: 'channels',
    pageTitle: '渠道分析',
    heading: '渠道数据分析',
    description: '当前仅提供空状态页面，渠道效果统计将在后续需求中设计。'
  },
  '/settings': {
    view: 'pages/settings',
    active: 'settings',
    pageTitle: '系统配置',
    heading: '系统基础配置',
    description: '当前仅提供空状态页面，字典项和权限配置将在后续需求中设计。'
  }
};

Object.entries(pages).forEach(([routePath, page]) => {
  router.get(routePath, (req, res) => {
    res.render(page.view, page);
  });
});

module.exports = router;
