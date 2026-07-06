# narrator-ai-web

[英文](./README.md)

`narrator-ai-web` 是 NarratorAI 的可自托管 Next.js 前端，用于模板化视频解说制作。它可以帮助用户自动完成电影、短剧等视频的解说制作。

用户上传原始视频、影视片段、短剧素材或其他长视频素材后，选择一个解说模板，系统会通过连接的后端根据模板生成解说文案、剪辑脚本，并合成一条适合短视频平台发布的精简版解说视频。

每个模板都可以配置自己的价格。用户在提交任务前可以看到本次任务价格，确认后再提交生成。

这个项目适合用于电影解说、短剧解说、剧情混剪、内容工作室批量交付，以及想把解说模板做成可售卖商品的团队。

本仓库不包含模型推理、视频生成、钱包或任务编排服务。这些能力需要由兼容后端服务提供，并通过环境变量接入。

配套后端仓库：[NarratorAI-Studio/narrator-ai-web-backend](https://github.com/NarratorAI-Studio/narrator-ai-web-backend)。

## 在线演示

公开演示站：<https://app.jieshuo.cn/>。

## 页面截图

**自定义素材上传**

<img src="./docs/assets/screenshot-custom-material.png" alt="自定义素材上传页面，包含解说类型、文案类型和素材上传控件" width="800">

**模板选择**

<img src="./docs/assets/screenshot-template-selection.png" alt="模板选择页面，包含解说模板卡片网格" width="800">

## 功能特性

- 基于 Next.js App Router 的前端应用，BFF 路由位于 `src/app/api`
- 多步骤解说视频任务创建流程
- 支持模板任务和自定义素材任务路径
- 通过后端 API 接入账户、钱包、报价和任务状态能力
- 面向部署管理员的 `/admin/*` 页面，并通过 Basic Auth 保护
- 提供 Dockerfile 和 Docker Compose，支持自行构建镜像
- 包含 Vitest、TypeScript、ESLint 和 Playwright 测试配置

## 架构

```text
Browser
  |
  v
narrator-ai-web（Next.js UI + BFF routes）
  |
  v
兼容后端服务（pricing、wallet、orchestration、upstream proxy）
  |
  v
上游 NarratorAI-compatible OpenAPI provider
```

更多说明见 [docs/architecture_CN.md](./docs/architecture_CN.md)。

## 文档

| 主题 | 文档 |
|---|---|
| 架构 | [docs/architecture_CN.md](./docs/architecture_CN.md) |
| 部署 | [docs/DEPLOYMENT_CN.md](./docs/DEPLOYMENT_CN.md) |
| CI | [docs/ci_CN.md](./docs/ci_CN.md) |

## 环境要求

- Node.js 20 或 22
- pnpm 9+
- 一个可由本 Web 应用访问的兼容后端服务
- 上游 NarratorAI-compatible OpenAPI 的基础 URL 和 API key

## 环境变量

复制 [`.env.example`](./.env.example) 为 `.env.local`，并按你的环境填写。

| 变量 | 是否必需 | 用途 |
|---|---:|---|
| `NARRATOR_PRICING_API_URL` | 是 | 后端服务基础 URL，用于 pricing、wallet、orchestration 和 proxy 路由。 |
| `NARRATORAI_BASE_URL` | 是 | 上游 NarratorAI-compatible OpenAPI provider 的基础 URL。 |
| `NARRATORAI_API_KEY` | 是 | 服务端使用的上游 API key。不要使用 `NEXT_PUBLIC_` 前缀暴露到浏览器。 |
| `PRICING_BFF_AUTH_TOKEN` | 建议 | Web 与后端 proxy 路由共享的 Bearer token。 |
| `WALLET_BFF_AUTH_TOKEN` | 建议 | Web 与后端 wallet 路由共享的 Bearer token，取决于后端是否启用。 |
| `ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS` | 建议 | `/admin/*` 页面的 Basic Auth 用户名和密码。 |
| `MYSQL_*` | 可选 | 可选的 master-task 持久化配置。后端负责持久化时可留空。 |
| `PORT` | 可选 | HTTP 端口，默认 `5000`。 |

完整变量列表和注释见 [`.env.example`](./.env.example)。

## 快速开始

```bash
git clone <repo-url> narrator-ai-web
cd narrator-ai-web
pnpm install
cp .env.example .env.local
```

编辑 `.env.local`，至少设置：

```bash
NARRATOR_PRICING_API_URL=http://localhost:8080
NARRATORAI_BASE_URL=https://api.example.com
NARRATORAI_API_KEY=<your-api-key>
PRICING_BFF_AUTH_TOKEN=<shared-backend-token>
```

启动开发服务器：

```bash
pnpm dev
```

默认访问地址为 <http://localhost:5000>。

## 配合后端运行

本前端依赖后端提供 account、wallet、pricing、metadata 和 task orchestration 等接口。本地开发时，请先启动兼容后端服务，并将 `NARRATOR_PRICING_API_URL` 指向它。配套后端仓库默认监听 `8080`：

- 后端源码：[NarratorAI-Studio/narrator-ai-web-backend](https://github.com/NarratorAI-Studio/narrator-ai-web-backend)

```bash
NARRATOR_PRICING_API_URL=http://localhost:8080
```

如果后端要求 BFF 认证，请在 Web 和后端两侧设置同一个 token：

```bash
PRICING_BFF_AUTH_TOKEN=<shared-backend-token>
WALLET_BFF_AUTH_TOKEN=<shared-backend-token>
```

## 常用命令

```bash
pnpm dev        # 启动本地开发服务器
pnpm test       # 运行 Vitest 测试
pnpm ts-check   # 运行 TypeScript 检查
pnpm lint       # 运行 ESLint
pnpm build      # 生成生产构建
pnpm start      # 启动生产构建
```

## Docker

公开 Linux 镜像已发布到阿里云容器镜像服务：

| Tag | 用途 |
|---|---|
| `registry.cn-hangzhou.aliyuncs.com/narrator-ai/public:web-latest` | 最新公开前端镜像 |
| `registry.cn-hangzhou.aliyuncs.com/narrator-ai/public:web-0.1.0-32b83b3` | 从 `docs/public` commit `32b83b3` 构建的固定版本前端镜像 |

两个 tag 都是 `linux/amd64` 架构。由于前端和后端共用同一个镜像仓库，本项目使用带组件名前缀的 tag，而不是共用单个 `latest` tag。

拉取镜像：

```bash
docker pull --platform linux/amd64 registry.cn-hangzhou.aliyuncs.com/narrator-ai/public:web-latest
```

使用可访问的后端和上游 API 配置运行：

```bash
docker run --rm --platform linux/amd64 -p 5000:5000 \
  -e NARRATOR_PRICING_API_URL=http://host.docker.internal:8080 \
  -e NARRATORAI_BASE_URL=https://api.example.com \
  -e NARRATORAI_API_KEY='<your-api-key>' \
  -e PRICING_BFF_AUTH_TOKEN='<shared-backend-token>' \
  -e WALLET_BFF_AUTH_TOKEN='<shared-backend-token>' \
  registry.cn-hangzhou.aliyuncs.com/narrator-ai/public:web-latest
```

容器启动后访问 <http://localhost:5000>。

如果同一台机器上使用已发布的后端镜像，请先在 `8080` 端口启动后端，再在上面的前端命令中保持 `NARRATOR_PRICING_API_URL=http://host.docker.internal:8080`。

如果需要固定到已验证版本：

```bash
docker run --rm --platform linux/amd64 -p 5000:5000 \
  -e NARRATOR_PRICING_API_URL=http://host.docker.internal:8080 \
  -e NARRATORAI_BASE_URL=https://api.example.com \
  -e NARRATORAI_API_KEY='<your-api-key>' \
  -e PRICING_BFF_AUTH_TOKEN='<shared-backend-token>' \
  -e WALLET_BFF_AUTH_TOKEN='<shared-backend-token>' \
  registry.cn-hangzhou.aliyuncs.com/narrator-ai/public:web-0.1.0-32b83b3
```

需要修改源码时，可以本地自行构建：

```bash
docker build -t narrator-ai-web:local .
```

运行本地构建的镜像：

```bash
docker run --rm -p 5000:5000 \
  -e NARRATOR_PRICING_API_URL=http://host.docker.internal:8080 \
  -e NARRATORAI_BASE_URL=https://api.example.com \
  -e NARRATORAI_API_KEY=<your-api-key> \
  -e PRICING_BFF_AUTH_TOKEN=<shared-backend-token> \
  -e WALLET_BFF_AUTH_TOKEN=<shared-backend-token> \
  narrator-ai-web:local
```

也可以在设置必要环境变量后使用 Docker Compose：

```bash
docker compose up --build
```

## 项目结构

```text
src/
  app/          Next.js 路由、页面、布局和 BFF route handlers
  components/   可复用 React 组件
  hooks/        React hooks
  lib/          客户端工具、API clients 和领域辅助函数
  __tests__/    Vitest 测试

docs/           架构、部署、CI 和截图
scripts/        开发、构建和启动脚本
e2e/            Playwright 测试
```

## 部署

本地、Docker 和 Fly.io 部署说明见 [docs/DEPLOYMENT_CN.md](./docs/DEPLOYMENT_CN.md)。仓库中包含的 Fly.io 配置使用占位 app 名称，部署前需要替换。

## 安全

不要提交真实 `.env` 文件、API keys、Bearer tokens、数据库凭据或生产 URL。请使用环境变量或部署平台的 secret manager（密钥管理器）。

安全漏洞请通过 security@gridltd.com 私下报告。详见 [SECURITY.md](./SECURITY.md)。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

Apache License 2.0。见 [LICENSE](./LICENSE)。

## 联系方式

项目问题请使用下方二维码。

Tips：如有大批量需求、技术项支持请求，可通过同一渠道联系我们。

<img src="./docs/assets/project-contact-qr.png" alt="项目联系二维码" width="240">
