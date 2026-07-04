const { Pool } = require('pg');
require('dotenv').config({ quiet: true });

async function checkFrontlineData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const positions = ['客服专员', '客服班长', '培训期学员'];

    for (const position of positions) {
      const result = await pool.query(
        'SELECT COUNT(*) as count, org_level2 as base FROM common_emp_org_real_day WHERE position_name = $1 GROUP BY org_level2 ORDER BY count DESC LIMIT 5',
        [position]
      );

      console.log(`\n${position}:`);
      console.log('总计:', result.rows.reduce((sum, row) => sum + parseInt(row.count), 0));
      console.log('基地分布（前5）:');
      result.rows.forEach(row => {
        console.log(`  ${row.base || '未知'}: ${row.count}人`);
      });
    }

    const totalResult = await pool.query(
      `SELECT COUNT(*) as count FROM common_emp_org_real_day WHERE position_name = ANY($1)`,
      [positions]
    );
    console.log('\n一线员工总计:', totalResult.rows[0].count);

  } finally {
    await pool.end();
  }
}

checkFrontlineData();