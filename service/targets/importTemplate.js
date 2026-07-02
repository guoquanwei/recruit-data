const ExcelJS = require('exceljs');

const REQUIRED_COLUMNS = ['年月份', '基地', '渠道', '招聘订单类型', '7天留存率目标', '15天留存率目标', '30天留存率目标', '招聘目标'];
const DAILY_TARGET_COLUMNS = Array.from({ length: 31 }, (_, index) => `${index + 1}日`);

const TEMPLATE_CONFIG = {
  filename: '招聘目标导入模板.xlsx',
  sheetName: '整体目标',
  headers: [...REQUIRED_COLUMNS, ...DAILY_TARGET_COLUMNS],
  sample: [
    '2026-06',
    '联通河北',
    '自主社招',
    '客服专员',
    0.7,
    0.6,
    0.5,
    30,
    ...DAILY_TARGET_COLUMNS.map((_, index) => (index < 30 ? 1 : 0))
  ]
};

function getTargetImportTemplateConfig() {
  return TEMPLATE_CONFIG;
}

function buildTargetImportTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TEMPLATE_CONFIG.sheetName);

  sheet.addRow(TEMPLATE_CONFIG.headers);
  sheet.addRow(TEMPLATE_CONFIG.sample);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.columns.forEach((column, index) => {
    column.width = index < REQUIRED_COLUMNS.length ? 16 : 8;
  });

  return workbook;
}

module.exports = {
  REQUIRED_COLUMNS,
  getTargetImportTemplateConfig,
  buildTargetImportTemplateWorkbook
};
