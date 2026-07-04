const { Pool } = require('pg');
require('dotenv').config({ quiet: true });

async function checkRecruiterData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count, org_level2 as base
       FROM common_emp_org_real_day
       WHERE position_name = '招聘专员'
       GROUP BY org_level2
       ORDER BY count DESC
       LIMIT 10`
    );

    console.log('招聘专员数据:');
    console.log('总计:', result.rows.reduce((sum, row) => sum + parseInt(row.count), 0));
    console.log('基地分布（前10）:');
    result.rows.forEach(row => {
      console.log(`  ${row.base || '未知'}: ${row.count}人`);
    });

    const sampleResult = await pool.query(
      `SELECT emp_code, emp_name, position_name, org_level2, work_status, train_start_date
       FROM common_emp_org_real_day
       WHERE position_name = '招聘专员'
       LIMIT 3`
    );

    console.log('\n示例数据（3条）:');
    sampleResult.rows.forEach(row => {
      console.log(`  ${row.emp_code} | ${row.emp_name} | ${row.position_name} | ${row.org_level2} | ${row.work_status === 1 ? '在职' : '离职'} | ${row.train_start_date}`);
    });

  } finally {
    await pool.end();
  }
}

checkRecruiterData();