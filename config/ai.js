let aiModelConfig;

function normalizeAiModelConfig(row) {
  if (!row) {
    return undefined;
  }

  return {
    provider: row.provider,
    baseURL: row.base_url,
    apiKey: row.api_key,
    endpoint: row.endpoint
  };
}

function maskSecret(value = '') {
  if (!value) {
    return '';
  }
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, 2)}${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}

function maskAiModelConfig(config = aiModelConfig) {
  if (!config) {
    return undefined;
  }

  return {
    ...config,
    apiKey: maskSecret(config.apiKey)
  };
}

async function initializeAiModelConfig(database, provider = 'doubao') {
  const result = await database.query(`
    SELECT provider, base_url, api_key, endpoint
    FROM ai_model_configs
    WHERE provider = $1
      AND is_active = true
    LIMIT 1
  `, [provider]);

  aiModelConfig = normalizeAiModelConfig(result.rows[0]);
  global.aiModelConfig = aiModelConfig;
  return aiModelConfig;
}

function getAiModelConfig() {
  return aiModelConfig;
}

module.exports = {
  getAiModelConfig,
  initializeAiModelConfig,
  maskAiModelConfig
};
