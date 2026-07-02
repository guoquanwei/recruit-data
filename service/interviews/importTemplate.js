const ExcelJS = require('exceljs');

const REQUIRED_COLUMNS = ['职位名称', '候选人名称', '电话', '面试官填写反馈时间', '面试官反馈结果', '面试官', '猎头公司标签'];
const OPTIONAL_COLUMNS = ['性别', '猎头合约名称', '内推人', '综合评价'];

const TEMPLATE_CONFIG = {
  filename: '面试记录导入模板.xlsx',
  sheetName: '面试记录',
  headers: [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS],
  sample: ['联通河北客服专员', '张三', '13900000000', '2026-06-01', '推荐复试', '李四', '自主社招', '男', '河北渠道合同', '', '沟通表达清晰']
};

function getInterviewImportTemplateConfig() {
  return TEMPLATE_CONFIG;
}

function buildInterviewImportTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TEMPLATE_CONFIG.sheetName);

  sheet.addRow(TEMPLATE_CONFIG.headers);
  sheet.addRow(TEMPLATE_CONFIG.sample);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.columns.forEach((column) => {
    column.width = 18;
  });

  return workbook;
}

module.exports = {
  REQUIRED_COLUMNS,
  getInterviewImportTemplateConfig,
  buildInterviewImportTemplateWorkbook
};
