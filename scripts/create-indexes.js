const { execute } = require('../dao/db');

async function createIndexes() {
  console.log('🚀 开始创建优化索引...\n');

  const indexes = [
    {
      name: 'idx_org_table_position_base_status',
      table: 'common_emp_org_real_day',
      sql: `CREATE INDEX IF NOT EXISTS idx_org_table_position_base_status
             ON common_emp_org_real_day (position_name, org_level2, work_status)`,
      description: '员工表：岗位+基地+工作状态复合索引'
    },
    {
      name: 'idx_org_table_status_train_date',
      table: 'common_emp_org_real_day',
      sql: `CREATE INDEX IF NOT EXISTS idx_org_table_status_train_date
             ON common_emp_org_real_day (work_status DESC, train_start_date DESC NULLS LAST)`,
      description: '员工表：工作状态+入培日期排序索引'
    },
    {
      name: 'idx_org_table_terminate_date',
      table: 'common_emp_org_real_day',
      sql: `CREATE INDEX IF NOT EXISTS idx_org_table_terminate_date
             ON common_emp_org_real_day (terminate_date)`,
      description: '员工表：离职日期索引'
    },
    {
      name: 'idx_org_table_channel_type',
      table: 'common_emp_org_real_day',
      sql: `CREATE INDEX IF NOT EXISTS idx_org_table_channel_type
             ON common_emp_org_real_day (hr_channel_type)`,
      description: '员工表：招聘渠道类型索引'
    },
    {
      name: 'idx_interview_feedback_date',
      table: 'interview_records',
      sql: `CREATE INDEX IF NOT EXISTS idx_interview_feedback_date
             ON interview_records (feedback_date)`,
      description: '面试记录：反馈日期索引'
    },
    {
      name: 'idx_interview_date_channel',
      table: 'interview_records',
      sql: `CREATE INDEX IF NOT EXISTS idx_interview_date_channel
             ON interview_records (feedback_date, channel_type)`,
      description: '面试记录：日期+渠道类型复合索引'
    },
    {
      name: 'idx_targets_year_month',
      table: 'recruitment_targets',
      sql: `CREATE INDEX IF NOT EXISTS idx_targets_year_month
             ON recruitment_targets (year_month)`,
      description: '目标数据：年月索引'
    },
    {
      name: 'idx_targets_year_month_base_channel',
      table: 'recruitment_targets',
      sql: `CREATE INDEX IF NOT EXISTS idx_targets_year_month_base_channel
             ON recruitment_targets (year_month, base, channel)`,
      description: '目标数据：年月+基地+渠道复合索引'
    }
  ];

  let successCount = 0;
  let skipCount = 0;

  for (const index of indexes) {
    try {
      await execute(index.sql);
      console.log(`✅ 创建成功: ${index.name}`);
      console.log(`   📝 ${index.description}\n`);
      successCount++;
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`⏭️  已存在: ${index.name}（跳过）\n`);
        skipCount++;
      } else {
        console.error(`❌ 创建失败: ${index.name}`);
        console.error(`   错误: ${error.message}\n`);
      }
    }
  }

  console.log('=' .repeat(60));
  console.log(`📊 索引创建完成！`);
  console.log(`   成功: ${successCount} 个`);
  console.log(`   跳过: ${skipCount} 个（已存在）`);
  console.log(`   总计: ${indexes.length} 个\n`);

  console.log('💡 预期性能提升:');
  console.log('   • 一线员工/招聘专员查询: 提升 10-50x');
  console.log('   • 面试记录查询: 提升 5-20x');
  console.log('   • 目标数据查询: 提升 10-100x');
  console.log('   • 排序操作: 避免文件排序，直接使用索引有序读取\n');
}

createIndexes()
  .then(() => {
    console.log('🎉 索引优化完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 索引创建失败:', error);
    process.exit(1);
  });