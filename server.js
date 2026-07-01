const express = require('express');
const path = require('node:path');

const { connectDatabase, closeDatabase } = require('./config/database');
const runtime = require('./config/runtime');
const pageRoutes = require('./routes');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(runtime.appRoot, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/public', express.static(path.join(runtime.appRoot, 'public'), {
    maxAge: '30d',
    etag: true
  }));

  app.use((req, res, next) => {
    res.locals.platformName = runtime.platformName;
    res.locals.active = '';
    res.locals.moduleActive = '';
    res.locals.pageTitle = runtime.platformName;
    next();
  });

  app.use('/', pageRoutes);

  app.use((req, res) => {
    res.status(404).render('pages/404', {
      pageTitle: '页面不存在',
      active: ''
    });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('pages/error', {
      pageTitle: '服务异常',
      active: '',
      message: '服务暂时不可用，请稍后重试。'
    });
  });

  return app;
}

function startServer() {
  connectDatabase();

  const app = createApp();
  const server = app.listen(runtime.port, () => {
    console.log(`${runtime.platformName} 已启动：http://localhost:${runtime.port}`);
    console.log(`SQLite 模式：${runtime.sqlite.mode}，路径：${runtime.sqlite.path}`);
  });

  const shutdown = () => {
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
