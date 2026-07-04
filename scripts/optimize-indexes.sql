-- ============================================================
-- 自主社招人效页面查询优化索引
-- 创建时间: 2026-07-04
-- 说明: 针对 /dashboard/self-sourcing?ajax=1 接口优化
-- ============================================================

-- 1. common_emp_org_real_day 表索引（员工数据）
-- 主要用于一线员工列表、招聘专员列表查询

-- 复合索引：岗位 + 基地 + 工作状态（覆盖主要筛选条件）
CREATE INDEX IF NOT EXISTS idx_org_table_position_base_status
ON common_emp_org_real_day (position_name, org_level2, work_status);

-- 复合索引：工作状态 + 入培日期（支持在职优先排序）
CREATE INDEX IF NOT EXISTS idx_org_table_status_train_date
ON common_emp_org_real_day (work_status DESC, train_start_date DESC NULLS LAST);

-- 单列索引：离职日期（用于过滤历史数据）
CREATE INDEX IF NOT EXISTS idx_org_table_terminate_date
ON common_emp_org_real_day (terminate_date);

-- 单列索引：招聘渠道类型（用于筛选自主社招）
CREATE INDEX IF NOT EXISTS idx_org_table_channel_type
ON common_emp_org_real_day (hr_channel_type);

-- 2. interview_records 表索引（面试记录）
-- 主要用于面试记录查询和统计

-- 单列索引：反馈日期（用于按月份筛选）
CREATE INDEX IF NOT EXISTS idx_interview_feedback_date
ON interview_records (feedback_date);

-- 复合索引：日期 + 渠道类型（支持自主社招筛选）
CREATE INDEX IF NOT EXISTS idx_interview_date_channel
ON interview_records (feedback_date, channel_type);

-- 3. recruitment_targets 表索引（目标数据）
-- 主要用于目标数据查询

-- 单列索引：年月（用于按月份查询）
CREATE INDEX IF NOT EXISTS idx_targets_year_month
ON recruitment_targets (year_month);

-- 复合索引：年月 + 基地 + 渠道（支持排序和筛选）
CREATE INDEX IF NOT EXISTS idx_targets_year_month_base_channel
ON recruitment_targets (year_month, base, channel);


-- ============================================================
-- 查询性能分析说明
-- ============================================================

/*
【核心查询分析】

1. listAllOrgTableFrontlineEmployees() - 一线员工全量查询
   WHERE position_name = ANY($1)                    -- 使用 idx_org_table_position_base_status
   AND (work_status = 1 OR terminate_date > '2025-12-31')  -- 使用 idx_org_table_terminate_date
   ORDER BY work_status DESC, train_start_date DESC  -- 使用 idx_org_table_status_train_date

2. listAllOrgTableRecruiters() - 招聘专员全量查询
   WHERE position_name = ANY($1)                    -- 使用 idx_org_table_position_base_status
   AND org_level2 = '人才开发部'                     -- 使用 idx_org_table_position_base_status
   AND (work_status = 1 OR terminate_date > '2025-12-31')
   ORDER BY work_status DESC, train_start_date DESC  -- 使用 idx_org_table_status_train_date

3. listAllInterviewRecords() - 面试记录查询
   WHERE feedback_date LIKE '2026-07%'              -- 使用 idx_interview_feedback_date
   OR feedback_date >= '2026-07-01'                 -- 使用 idx_interview_feedback_date

4. listTargetsByMonth() - 目标数据查询
   WHERE year_month = '2026-07'                     -- 使用 idx_targets_year_month
   ORDER BY base ASC, channel ASC                   -- 使用 idx_targets_year_month_base_channel

5. 自主社招人效计算中的员工筛选
   WHERE channelType = '自主社招'                   -- 使用 idx_org_table_channel_type
   AND trainingDate LIKE '2026-07%'                  -- 需要函数索引或应用层处理


【预期性能提升】

- 一线员工/招聘专员查询：从全表扫描 → 索引范围扫描（预计提升 10-50x）
- 面试记录查询：从全表扫描 → 索引查找（预计提升 5-20x）
- 目标数据查询：从全表扫描 → 唯一索引查找（预计提升 10-100x）
- 排序操作：从文件排序 → 索引有序读取（避免临时表和文件排序）


【注意事项】

1. 索引会占用额外存储空间（约原始数据的 20-30%）
2. 写入性能略有下降（INSERT/UPDATE/DELETE 需维护索引）
3. 对于数据量 < 1万行 的表，索引效果不明显
4. 建议在业务低峰期执行此脚本
5. 可以使用 EXPLAIN ANALYZE 验证索引使用情况
*/


-- ============================================================
-- 验证索引是否生效的示例查询
-- ============================================================

-- 验证一线员工查询
/*
EXPLAIN ANALYZE
SELECT * FROM common_emp_org_real_day
WHERE position_name = ANY(ARRAY['客服专员', '客服班长', '培训期学员'])
AND (work_status = 1 OR terminate_date > '2025-12-31')
ORDER BY work_status DESC, train_start_date DESC NULLS LAST, id DESC;
*/

-- 验证招聘专员查询
/*
EXPLAIN ANALYZE
SELECT * FROM common_emp_org_real_day
WHERE position_name = ANY(ARRAY['招聘专员', '初级招聘主管'])
AND org_level2 = '人才开发部'
AND (work_status = 1 OR terminate_date > '2025-12-31')
ORDER BY work_status DESC, train_start_date DESC NULLS LAST, id DESC;
*/

-- 验证面试记录查询
/*
EXPLAIN ANALYZE
SELECT * FROM interview_records
WHERE feedback_date >= '2026-07-01' AND feedback_date < '2026-08-01';
*/

-- 验证目标数据查询
/*
EXPLAIN ANALYZE
SELECT * FROM recruitment_targets
WHERE year_month = '2026-07'
ORDER BY base ASC, channel ASC;
*/