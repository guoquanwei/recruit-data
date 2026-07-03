const path = require('node:path');

const runtime = require('../config/runtime');

const SYSTEM_DATA_ROOT = path.join(runtime.appRoot, 'systerm_data');

const SOURCE_DATA_FILES = {
  activeEmployees: {
    key: 'active-employees',
    label: '在职员工信息',
    filename: '在职员工信息_20260627.xlsx',
    relativePath: '在职员工信息_20260627.xlsx'
  },
  resignedEmployees: {
    key: 'resigned-employees',
    label: '离职员工信息',
    filename: '离职员工信息_20260627.xlsx',
    relativePath: '离职员工信息_20260627.xlsx'
  },
  interviews: {
    key: 'interviews',
    label: '面试记录',
    filename: '面试记录_0625.xlsx',
    relativePath: '面试记录_0625.xlsx'
  },
  targets: [
    ['target-2026-01', '1月招聘目标', '2026年月度招聘目标/人才开发目标拆解-1月-0209.xlsx'],
    ['target-2026-02', '2月招聘目标', '2026年月度招聘目标/人才开发目标拆解-2月-0422.xlsx'],
    ['target-2026-03', '3月招聘目标', '2026年月度招聘目标/人才开发目标拆解-3月-0422.xlsx'],
    ['target-2026-04', '4月招聘目标', '2026年月度招聘目标/人才开发目标拆解-4月-0514.xlsx'],
    ['target-2026-05', '5月招聘目标', '2026年月度招聘目标/人才开发目标拆解-5月-0622.xlsx'],
    ['target-2026-06', '6月招聘目标', '2026年月度招聘目标/人才开发目标拆解-6月-0623.xlsx']
  ].map(([key, label, relativePath]) => ({
    key,
    label,
    filename: path.basename(relativePath),
    relativePath
  }))
};

function withAbsolutePath(file) {
  return {
    ...file,
    absolutePath: path.join(SYSTEM_DATA_ROOT, file.relativePath)
  };
}

function getSystemDataFile(key) {
  const files = [
    SOURCE_DATA_FILES.activeEmployees,
    SOURCE_DATA_FILES.resignedEmployees,
    SOURCE_DATA_FILES.interviews,
    ...SOURCE_DATA_FILES.targets
  ];
  const file = files.find((item) => item.key === key);
  return file ? withAbsolutePath(file) : undefined;
}

module.exports = {
  getSystemDataFile,
  SYSTEM_DATA_ROOT
};
