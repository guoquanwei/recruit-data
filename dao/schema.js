function initializeBusinessSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      import_mode TEXT NOT NULL,
      scope TEXT,
      file_name TEXT,
      status TEXT NOT NULL,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      employee_no TEXT NOT NULL,
      name TEXT,
      employee_status TEXT,
      base TEXT,
      department TEXT,
      position TEXT,
      channel_type TEXT,
      channel_name TEXT,
      office_location TEXT,
      training_date TEXT,
      entry_date TEXT,
      resigned_date TEXT,
      phone TEXT,
      id_card TEXT,
      handover_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_type, employee_no)
    );

    CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(position, employee_status);
    CREATE INDEX IF NOT EXISTS idx_employees_base_channel ON employees(base, channel_type);
    CREATE INDEX IF NOT EXISTS idx_employees_training_date ON employees(training_date);

    CREATE TABLE IF NOT EXISTS recruitment_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_month TEXT NOT NULL,
      base TEXT NOT NULL,
      channel TEXT NOT NULL,
      order_type TEXT,
      retention_7_rate REAL,
      retention_15_rate REAL,
      retention_30_rate REAL,
      monthly_target INTEGER NOT NULL DEFAULT 0,
      day_targets_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_targets_month_base_channel ON recruitment_targets(year_month, base, channel);

    CREATE TABLE IF NOT EXISTS interview_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base TEXT,
      position_name TEXT,
      candidate_name TEXT,
      gender TEXT,
      phone TEXT,
      feedback_date TEXT,
      feedback_result TEXT,
      interviewer TEXT,
      channel_type TEXT,
      channel_name TEXT,
      channel_tag TEXT,
      contract_name TEXT,
      referrer TEXT,
      evaluation TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_interviews_feedback_date ON interview_records(feedback_date);
    CREATE INDEX IF NOT EXISTS idx_interviews_result_channel ON interview_records(feedback_result, channel_tag);
    CREATE INDEX IF NOT EXISTS idx_interviews_phone ON interview_records(phone);

    CREATE TABLE IF NOT EXISTS recruiter_monthly_scales (
      year_month TEXT NOT NULL,
      stage TEXT NOT NULL,
      recruiter_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (year_month, stage)
    );
  `);

  ensureColumn(database, 'interview_records', 'base', 'TEXT');
  ensureColumn(database, 'interview_records', 'channel_type', 'TEXT');
  ensureColumn(database, 'interview_records', 'channel_name', 'TEXT');
  database.exec(`
    UPDATE interview_records
    SET channel_type = COALESCE(NULLIF(channel_type, ''), channel_tag),
        channel_name = COALESCE(NULLIF(channel_name, ''), contract_name)
    WHERE channel_type IS NULL
       OR channel_type = ''
       OR channel_name IS NULL
       OR channel_name = '';
  `);
}

function ensureColumn(database, tableName, columnName, columnType) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType};`);
  }
}

module.exports = {
  initializeBusinessSchema
};
