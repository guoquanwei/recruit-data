## Purpose

定义人力招聘数据分析后台 MVP 的基础能力，包括应用启动入口、服务端渲染页面、SQLite 文件连接、静态资源与公共布局、单容器交付。该规格只覆盖平台骨架，不包含候选人、招聘进度、渠道分析等业务表结构和业务数据。

## Requirements

### Requirement: 应用启动入口
系统必须提供 `server.js` 启动入口，用于初始化并启动人力招聘数据平台。

#### Scenario: 本地启动应用
- **WHEN** 操作人员运行配置好的启动命令
- **THEN** 系统在配置端口启动 Express 服务；未配置端口时默认使用 3000 端口

#### Scenario: 入口文件组装应用层
- **WHEN** `server.js` 启动
- **THEN** 它完成中间件、EJS 渲染、静态资源、数据库初始化、路由挂载和错误处理配置，且不内嵌招聘业务规则

### Requirement: 服务端渲染平台页面
系统必须为 MVP 平台导航提供服务端渲染的 EJS 页面。

#### Scenario: 访问仪表盘
- **WHEN** 用户打开根路径 `/`
- **THEN** 系统渲染人力招聘数据平台的仪表盘页面

#### Scenario: 访问 MVP 模块路由
- **WHEN** 用户打开 `/candidates`、`/progress`、`/channels` 或 `/settings`
- **THEN** 系统渲染对应的 MVP 空状态页面，而不是返回路由不存在错误

### Requirement: SQLite 文件连接
系统必须在应用启动期间建立 SQLite 文件模式连接。

#### Scenario: 默认数据库文件路径
- **WHEN** 应用启动且未额外配置数据库路径
- **THEN** 系统使用 `data/recruitment.db` 作为默认 SQLite 数据库文件路径

#### Scenario: 配置数据库文件模式
- **WHEN** 配置了数据库文件路径
- **THEN** 系统将 SQLite 数据存储到该路径，使 Docker volume 持久化可以保留数据

#### Scenario: 不创建业务表结构
- **WHEN** 应用首次启动
- **THEN** 系统不创建候选人、招聘进度、渠道分析等业务表结构，这些表结构留待后续需求设计

### Requirement: 静态资源与公共布局
系统必须为 MVP 页面提供公共布局和静态资源支持。

#### Scenario: 渲染公共布局
- **WHEN** 任意 MVP 页面被渲染
- **THEN** 页面包含公共导航、基础 Bootstrap 样式和一致的平台标题

#### Scenario: 提供本地资源
- **WHEN** 浏览器请求 `/public` 下的文件
- **THEN** 系统返回已配置的静态 CSS 或 JavaScript 资源

### Requirement: 单容器交付
系统必须包含将 MVP 作为单个 Docker 容器运行所需的文件。

#### Scenario: 构建容器镜像
- **WHEN** 操作人员从项目根目录构建 Docker 镜像
- **THEN** 镜像安装生产依赖，并包含启动平台所需的应用文件

#### Scenario: 运行容器
- **WHEN** 操作人员运行已构建镜像并暴露 3000 端口
- **THEN** 浏览器可以通过暴露端口访问人力招聘数据平台
