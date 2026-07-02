const ExcelJS = require('exceljs');

const ACTIVE_REQUIRED_COLUMNS = ['工号', '姓名', '入培时间', '手机号码', '招聘渠道', '渠道名称', '办公地点', '部门', '职位', '员工状态'];
const RESIGNED_REQUIRED_COLUMNS = ['工号', '姓名', '入培时间', '手机号码', '招聘渠道', '渠道名称', '办公地点', '离职前部门', '离职前职位', '离职日期'];
const OPTIONAL_COLUMNS = ['入职日期', '证件号', '通关交接时间'];

const TEMPLATE_CONFIGS = {
  active: {
    filename: '在职员工导入模板.xlsx',
    sheetName: '在职员工信息',
    headers: [...ACTIVE_REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS],
    sample: ['JZ0001', '张三', '2026-06-01', '13900000000', '自主社招', '李四+JZ0002', 'HB01-石家庄广安大厦', '伽睿集团 / NEO-OPS / 人才开发部 / 北方招聘组', '招聘专员', '在职', '2026-06-02', '110101199001011234', '2026-06-03']
  },
  resigned: {
    filename: '离职员工导入模板.xlsx',
    sheetName: '离职员工信息',
    headers: [...RESIGNED_REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS],
    sample: ['JZ0003', '王五', '2026-06-01', '13800000000', '内推', '赵六', 'TJ-天津基地', '伽睿集团 / NEO-OPS / 天津基地 / 联通天津', '客服专员', '2026-06-30', '2026-06-02', '110101199001011235', '2026-06-03']
  }
};

function getEmployeeImportTemplateConfig(type) {
  return TEMPLATE_CONFIGS[type] || TEMPLATE_CONFIGS.active;
}

function buildEmployeeImportTemplateWorkbook(type) {
  const config = getEmployeeImportTemplateConfig(type);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(config.sheetName);

  sheet.addRow(config.headers);
  sheet.addRow(config.sample);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.columns.forEach((column) => {
    column.width = 18;
  });

  return workbook;
}

module.exports = {
  ACTIVE_REQUIRED_COLUMNS,
  RESIGNED_REQUIRED_COLUMNS,
  getEmployeeImportTemplateConfig,
  buildEmployeeImportTemplateWorkbook
};
