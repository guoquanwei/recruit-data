const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

require('dotenv').config({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function importEmployeeData() {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5
  });

  try {
    console.log('开始导入员工组织架构数据...');

    const sqlFile = path.join(__dirname, '../DB_INIT/common_emp_org_real_day.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf-8');

    console.log(`SQL 文件大小: ${(sqlContent.length / 1024).toFixed(2)} KB`);
    console.log(`SQL 文件行数: ${sqlContent.split('\n').length}`);

    const insertLines = sqlContent.split('\n').filter(line => line.trim().toUpperCase().startsWith('INSERT INTO'));
    console.log(`INSERT 语句行数: ${insertLines.length}`);

    if (insertLines.length > 0) {
      console.log('第一条 INSERT 语句前300字符:', insertLines[0].substring(0, 300));
      const firstInsert = insertLines[0];
      const valuesPart = firstInsert.match(/VALUES\s*(.+);$/is);
      if (valuesPart) {
        console.log('VALUES 部分前500字符:', valuesPart[1].substring(0, 500));
        console.log('VALUES 总长度:', valuesPart[1].length);
      }
    }

    const allRows = extractInsertStatements(sqlContent);

    if (allRows.length === 0) {
      console.error('未找到 INSERT 数据');
      return;
    }

    console.log(`解析到 ${allRows.length} 条员工记录`);

    await createPostgreSQLTable(pool);

    let importedCount = 0;
    const batchSize = 200;
    const batchData = [];

    for (const rowData of allRows) {
      batchData.push(rowData);

      if (batchData.length >= batchSize) {
        await batchInsert(pool, batchData);
        importedCount += batchData.length;
        console.log(`已导入 ${importedCount} 条记录...`);
        batchData.length = 0;
      }
    }

    if (batchData.length > 0) {
      await batchInsert(pool, batchData);
      importedCount += batchData.length;
    }

    console.log('\n✅ 导入完成！');
    console.log(`总记录数: ${allRows.length}`);
    console.log(`成功导入: ${importedCount}`);

    const result = await pool.query('SELECT COUNT(*) as count FROM common_emp_org_real_day');
    console.log(`数据库中现有记录数: ${result.rows[0].count}`);

  } catch (error) {
    console.error('导入失败:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

function extractInsertStatements(sqlContent) {
  const lines = sqlContent.split('\n');
  const allRows = [];
  let columns = null;
  let parseErrors = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmedLine = line.trim();

    if (!trimmedLine.toUpperCase().startsWith('INSERT INTO')) {
      continue;
    }

    const fullStatement = trimmedLine;

    const columnsMatch = fullStatement.match(/INSERT INTO `?\w+`?\s*\(([^)]+)\)\s*VALUES/i);

    if (!columnsMatch) {
      if (parseErrors < 3) {
        console.error(`行 ${lineNum + 1}: 列名匹配失败`);
      }
      parseErrors++;
      continue;
    }

    if (!columns) {
      columns = columnsMatch[1].split(',').map(col => col.trim().replace(/`/g, ''));
      console.log(`检测到 ${columns.length} 个字段`);
    }

    const valuesMatch = fullStatement.match(/VALUES\s*\((.+)\);$/is);

    if (!valuesMatch) {
      if (parseErrors < 3) {
        console.error(`行 ${lineNum + 1}: VALUES 匹配失败`);
        console.error(`语句结尾: ...${fullStatement.slice(-50)}`);
      }
      parseErrors++;
      continue;
    }

    const valuesStr = valuesMatch[1].trim();
    const values = parseValuesString(valuesStr);

    if (values.length !== columns.length) {
      if (parseErrors < 3) {
        console.error(`行 ${lineNum + 1}: 值数量不匹配 - 期望 ${columns.length}, 实际 ${values.length}`);
      }
      parseErrors++;
      continue;
    }

    const rowData = {};
    columns.forEach((col, index) => {
      rowData[col] = values[index];
    });
    allRows.push(rowData);
  }

  if (parseErrors > 0) {
    console.log(`解析警告: ${parseErrors} 行数据存在问题`);
  }

  return allRows;
}

function parseValuesString(valuesStr) {
  const values = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < valuesStr.length) {
    const char = valuesStr[i];

    if (char === "'" && !inQuotes) {
      inQuotes = true;
      current = '';
      i++;
    } else if (char === "'" && inQuotes) {
      if (i + 1 < valuesStr.length && valuesStr[i + 1] === "'") {
        current += "'";
        i += 2;
      } else {
        values.push(current);
        inQuotes = false;
        current = '';
        i++;
      }
    } else if ((char === ' ' || char === ',') && !inQuotes) {
      if (current !== '') {
        values.push(current.trim());
        current = '';
      }
      i++;
    } else if (char === 'N' && !inQuotes && valuesStr.substring(i, i+4) === 'NULL') {
      values.push(null);
      current = '';
      i += 4;
    } else {
      current += char;
      i++;
    }
  }

  if (current !== '' || inQuotes) {
    values.push(current.trim() || null);
  }

  return values;
}

async function createPostgreSQLTable(pool) {
  console.log('创建 PostgreSQL 表结构...');

  const createTableSQL = `
    DROP TABLE IF EXISTS common_emp_org_real_day CASCADE;

    CREATE TABLE common_emp_org_real_day (
      id BIGSERIAL PRIMARY KEY,
      emp_code VARCHAR(50),
      attribute_type INTEGER,
      emp_name VARCHAR(100),
      gender VARCHAR(10),
      phone_no VARCHAR(20),
      id_card VARCHAR(20),
      email VARCHAR(200),
      org_no VARCHAR(50),
      org_name VARCHAR(200),
      org_attribute VARCHAR(255),
      org_path VARCHAR(500),
      position_no VARCHAR(50),
      position_name VARCHAR(100),
      function_type VARCHAR(100),
      position_level VARCHAR(50),
      leader_code VARCHAR(50),
      leader_name VARCHAR(100),
      emp_type VARCHAR(50),
      work_status INTEGER DEFAULT 1,
      join_date DATE,
      terminate_date DATE,
      on_probation INTEGER DEFAULT 0,
      probation_start_date DATE,
      probation_should_date DATE,
      probation_end_date DATE,
      work_location VARCHAR(200),
      hr_relation VARCHAR(100),
      hr_channel_type VARCHAR(50),
      hr_channel_name VARCHAR(100),
      try_tel_date DATE,
      join_queue_date DATE,
      train_start_date DATE,
      exit_times BIGINT,
      terminate_reason VARCHAR(200),
      education_level VARCHAR(255),
      education_degree VARCHAR(255),
      marriage VARCHAR(255),
      idcard_place VARCHAR(255),
      current_address VARCHAR(255),
      job_stage VARCHAR(50),
      business_own VARCHAR(100),
      allocated_own INTEGER DEFAULT 0,
      org_level1 VARCHAR(100),
      org_level2 VARCHAR(100),
      org_level3 VARCHAR(100),
      org_level4 VARCHAR(100),
      org_level5 VARCHAR(100),
      org_level6 VARCHAR(100),
      org_level7 VARCHAR(100),
      org_level1_code VARCHAR(50),
      org_level2_code VARCHAR(50),
      org_level3_code VARCHAR(50),
      org_level4_code VARCHAR(50),
      org_level5_code VARCHAR(50),
      org_level6_code VARCHAR(50),
      org_level7_code VARCHAR(50),
      org_level1_leader_code VARCHAR(50),
      org_level2_leader_code VARCHAR(50),
      org_level3_leader_code VARCHAR(50),
      org_level4_leader_code VARCHAR(50),
      org_level5_leader_code VARCHAR(50),
      org_level6_leader_code VARCHAR(50),
      org_level7_leader_code VARCHAR(50),
      org_level1_leader_name VARCHAR(100),
      org_level2_leader_name VARCHAR(100),
      org_level3_leader_name VARCHAR(100),
      org_level4_leader_name VARCHAR(100),
      org_level5_leader_name VARCHAR(100),
      org_level6_leader_name VARCHAR(100),
      org_level7_leader_name VARCHAR(100),
      create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_disable SMALLINT,
      org_type VARCHAR(20),
      channel_type VARCHAR(20)
    );

    CREATE INDEX idx_emp_org_emp_code ON common_emp_org_real_day(emp_code);
    CREATE INDEX idx_emp_org_org_path ON common_emp_org_real_day(org_path);
    CREATE INDEX idx_emp_org_work_status ON common_emp_org_real_day(work_status);
    CREATE INDEX idx_emp_org_org_name ON common_emp_org_real_day(org_name);
  `;

  await pool.query(createTableSQL);
  console.log('✅ 表结构创建完成');
}

async function batchInsert(pool, dataList) {
  if (dataList.length === 0) return;

  const columns = [
    'emp_code', 'attribute_type', 'emp_name', 'gender', 'phone_no', 'id_card',
    'email', 'org_no', 'org_name', 'org_attribute', 'org_path', 'position_no',
    'position_name', 'function_type', 'position_level', 'leader_code', 'leader_name',
    'emp_type', 'work_status', 'join_date', 'terminate_date', 'on_probation',
    'probation_start_date', 'probation_should_date', 'probation_end_date', 'work_location',
    'hr_relation', 'hr_channel_type', 'hr_channel_name', 'try_tel_date', 'join_queue_date',
    'train_start_date', 'exit_times', 'terminate_reason', 'education_level', 'education_degree',
    'marriage', 'idcard_place', 'current_address', 'job_stage', 'business_own', 'allocated_own',
    'org_level1', 'org_level2', 'org_level3', 'org_level4', 'org_level5', 'org_level6', 'org_level7',
    'org_level1_code', 'org_level2_code', 'org_level3_code', 'org_level4_code', 'org_level5_code',
    'org_level6_code', 'org_level7_code', 'org_level1_leader_code', 'org_level2_leader_code',
    'org_level3_leader_code', 'org_level4_leader_code', 'org_level5_leader_code', 'org_level6_leader_code',
    'org_level7_leader_code', 'org_level1_leader_name', 'org_level2_leader_name', 'org_level3_leader_name',
    'org_level4_leader_name', 'org_level5_leader_name', 'org_level6_leader_name', 'org_level7_leader_name',
    'create_time', 'is_disable', 'org_type', 'channel_type'
  ];

  const valuePlaceholders = dataList.map((_, index) => {
    const startIdx = index * columns.length + 1;
    const placeholders = [];
    for (let i = 0; i < columns.length; i++) {
      placeholders.push(`$${startIdx + i}`);
    }
    return `(${placeholders.join(', ')})`;
  }).join(', ');

  const values = [];
  for (const row of dataList) {
    for (const col of columns) {
      let value = row[col];
      if (value === null || value === undefined || value === '') {
        values.push(null);
      } else if (col.includes('_date') && !col.includes('time') && value !== '') {
        values.push(value);
      } else if (['work_status', 'on_probation', 'allocated_own', 'exit_times', 'is_disable', 'attribute_type'].includes(col)) {
        values.push(parseInt(value) || 0);
      } else {
        values.push(value);
      }
    }
  }

  const sql = `
    INSERT INTO common_emp_org_real_day (${columns.join(', ')})
    VALUES ${valuePlaceholders}
  `;

  await pool.query(sql, values);
}

importEmployeeData()
  .then(() => {
    console.log('\n🎉 员工组织架构数据导入成功！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 导入失败:', error.message);
    process.exit(1);
  });