## 1. 项目初始化

- [x] 1.1 创建 `package.json`，配置启动脚本和必要的运行依赖。
- [x] 1.2 创建 MVP 所需目录结构，包括 `config/`、`routes/`、`service/`、`dao/`、`views/`、`public/` 和 `data/`。
- [x] 1.3 约定 `PORT`、SQLite 模式和数据库文件路径等环境配置。

## 2. 应用入口

- [x] 2.1 实现 `server.js` 启动入口，创建 Express 应用并读取运行配置。
- [x] 2.2 配置 EJS 视图引擎、视图目录、静态资源服务、JSON 解析和表单解析。
- [x] 2.3 挂载 `/`、`/candidates`、`/progress`、`/channels` 和 `/settings` 等 MVP 页面路由。
- [x] 2.4 增加 404 处理和集中错误处理，返回友好的页面或响应。

## 3. SQLite 文件连接

- [x] 3.1 实现 SQLite 连接配置，支持文件模式和可选的内存模式。
- [x] 3.2 将 SQLite 默认文件路径配置为 `data/recruitment.db`。
- [x] 3.3 在应用启动且接收请求前建立数据库连接，但不创建业务表结构。
- [x] 3.4 增加轻量 DAO 帮助模块，封装连接获取和通用查询能力，为后续表结构设计预留接口。

## 4. MVP 页面与路由

- [x] 4.1 创建共享 EJS 布局，包含 Bootstrap 样式、平台标题和导航。
- [x] 4.2 创建仪表盘、候选人管理、招聘进度、渠道分析、系统配置、404 和错误页面。
- [x] 4.3 实现路由模块，为每个 MVP 页面渲染空状态内容，不内置演示数据。
- [x] 4.4 在 `public/` 下增加少量本地 CSS 或 JavaScript，用于页面基础优化，且不引入构建步骤。

## 5. 单容器交付

- [x] 5.1 新增 `Dockerfile`，用于安装生产依赖并启动应用。
- [x] 5.2 新增 `.dockerignore`，避免本地数据、依赖目录和无关文件进入镜像。
- [x] 5.3 记录或配置默认暴露端口和数据库持久化路径，便于 Docker volume 使用。

## 6. 验证

- [x] 6.1 本地安装依赖，并使用 `npm start` 启动应用。
- [x] 6.2 验证 `/`、`/candidates`、`/progress`、`/channels` 和 `/settings` 均可正常渲染。
- [x] 6.3 验证 SQLite 默认连接到 `data/recruitment.db`，且不会创建业务数据表。
- [x] 6.4 构建 Docker 镜像，并验证容器可在 3000 端口提供 MVP 平台访问。
