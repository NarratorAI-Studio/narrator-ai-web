# 部署指南

[英文](./DEPLOYMENT.md)

本文说明如何在本地开发、自构建 Docker 镜像和 Fly.io 环境中运行 NarratorAI Web。其他 PaaS 平台通常也可以使用相同思路部署，只需要调整平台相关命令。

## 1. 前置要求

无论使用哪种环境，都需要：

- **Node.js 20 或 22**：CI 覆盖这两个版本。
- **pnpm 9+**：由 `preinstall` 脚本通过 `npx only-allow pnpm` 强制。
- **NarratorAI-compatible OpenAPI key**：配置为 `NARRATORAI_API_KEY`。
- **Pricing / orchestration 后端**：通过 `NARRATOR_PRICING_API_URL` 访问。缺少该变量时，相关 lib client 会在首次调用时抛出 `NARRATOR_PRICING_API_URL environment variable is required`。

完整环境变量说明见 [`.env.example`](../.env.example)，部署时以该文件为准。

## 2. 本地开发

```bash
git clone <your-fork-or-clone-url> narrator-ai-web
cd narrator-ai-web
pnpm install
cp .env.example .env.local
# 编辑 .env.local，至少设置 NARRATOR_PRICING_API_URL
pnpm dev
```

开发服务器默认监听 `http://localhost:5000`，可通过 `PORT` 修改。

### 常用本地命令

```bash
pnpm test            # 运行 Vitest 单元测试
pnpm test:watch      # Vitest watch mode
pnpm ts-check        # 全项目 TypeScript 检查
pnpm lint            # ESLint
pnpm build           # 生产构建，输出到 .next/
pnpm start           # 启动生产构建
```

### Turbopack 与 webpack

Next.js 16 默认在 `pnpm dev` 中使用 Turbopack。如果你的机器上 Turbopack 异常，可以切换到 webpack：

```bash
NEXT_DEV_BUNDLER=webpack pnpm dev
```

该变量只影响 `pnpm dev`，生产构建不受影响。

## 3. Docker

仓库包含用于自构建镜像的 `Dockerfile`。本地构建和运行：

```bash
docker build -t narrator-ai-web:local .

docker run --rm -p 5000:5000 \
  -e NARRATOR_PRICING_API_URL=https://your-backend.example.com \
  -e NARRATORAI_BASE_URL=https://api.example.com \
  -e NARRATORAI_API_KEY=<your-key> \
  -e PRICING_BFF_AUTH_TOKEN=<your-bff-token> \
  narrator-ai-web:local
```

也可以使用 `docker-compose.yml` 运行一个带 health check 的本地服务。

### 镜像内容

- 多阶段构建：使用 `node:20-alpine` 完成 build，并使用精简 runtime 运行 `pnpm start`。
- Next.js 直接服务静态资源，基础部署不需要单独 CDN。
- 默认端口：`5000`。
- `HOSTNAME=0.0.0.0`，容器外部可以访问服务。

## 4. Fly.io

Fly.io 是支持的部署目标之一。仓库包含两个配置文件：

- `fly.toml`：生产环境 app 配置。
- `fly-test.toml`：测试 / staging app 配置。

部署前必须把 `app` 字段改成你自己的 Fly.io app 名称。仓库中的 app 名称只是占位符。

### 首次设置

```bash
# 安装 flyctl 并登录
curl -L https://fly.io/install.sh | sh
fly auth login

# 编辑 fly.toml，把 app = "..." 改成你的 app 名称
# 如需测试环境，也同样编辑 fly-test.toml

# 创建 app
fly apps create <your-prod-app-name>
fly apps create <your-test-app-name>      # 可选

# 设置运行时 secrets
fly secrets set \
  NARRATOR_PRICING_API_URL=https://your-backend.example.com \
  NARRATORAI_BASE_URL=https://api.example.com \
  NARRATORAI_API_KEY=<your-key> \
  PRICING_BFF_AUTH_TOKEN=<your-bff-token> \
  -a <your-prod-app-name>
```

### 发布

```bash
# 生产环境
fly deploy -a <your-prod-app-name>

# 测试环境，使用 fly-test.toml
fly deploy -c fly-test.toml -a <your-test-app-name>
```

### 健康检查与回滚

`fly.toml` 中配置了 rolling deploy strategy（滚动发布策略）：

```bash
fly status -a <your-app-name>          # 查看当前 machines 和版本
fly releases -a <your-app-name>        # 查看发布历史
fly deploy -a <your-app-name> --image registry.fly.io/<your-app>:deployment-<id>   # 回滚到指定镜像
```

## 5. 环境变量参考

权威来源：[`.env.example`](../.env.example)。摘要如下。

### 必需

| 变量 | 用途 |
|---|---|
| `NARRATOR_PRICING_API_URL` | Pricing / orchestration 后端基础 URL。缺少时相关 lib client 会在首次调用时报错。 |
| `NARRATORAI_BASE_URL` | 上游 NarratorAI-compatible OpenAPI provider 基础 URL。生产环境使用你的 provider URL，本地开发可使用本地 URL。 |
| `NARRATORAI_API_KEY` | 服务端使用的 NarratorAI OpenAPI key。 |

### 建议

| 变量 | 用途 |
|---|---|
| `PRICING_BFF_AUTH_TOKEN` | 后端 proxy 路由的 Bearer token，应与后端配置一致。缺少时，部分 `/api/narrator/*` 路由可能在生产环境返回 401。 |
| `APP_ENV` | 可选值为 `DEV` / `UAT` / `PROD`，用于控制开发日志和 branding。 |

### Feature flags

| 变量 | 默认值 | 用途 |
|---|---|---|
| `HARD_PRICE_ROLLOUT_PERCENT` | `0` | 服务端 hard-price v2 rollout 百分比。按请求读取，修改后重启即可，不需要重新 build。 |
| `HARD_PRICE_KILL_SWITCH` | `false` | 强制关闭 hard-price v2。 |
| `NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT` | `0` | 客户端 fallback，会写入 JS bundle。优先使用服务端变量。 |
| `NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH` | `false` | 客户端 fallback。 |
| `NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON` | `"1"` | 为 `"1"` 时，前端不再为 auto-advance tasks 调用 `triggerNextStep`，由后端 orchestrator 管理状态机。回滚方式是设为 `"0"` 并重新部署。 |

### 可选：MySQL

用于 master-task state 持久化。不需要时留空。

| 变量 | 默认值 |
|---|---|
| `MYSQL_HOST` | 无 |
| `MYSQL_PORT` | `3306` |
| `MYSQL_USER` | 无 |
| `MYSQL_PASSWORD` | 无 |
| `MYSQL_DATABASE` | 无 |

### 可选：Runtime

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PORT` | `5000` | HTTP 端口，由 `server.ts` 使用。 |
| `NEXT_DEV_BUNDLER` | unset | 设置为 `webpack` 可在开发模式禁用 Turbopack。对生产无影响。 |
| `NEXT_PUBLIC_BASE_URL` | 自动 | 用于生成绝对 URL，例如分享链接。 |
| `NEXT_PUBLIC_SSE_BASE_URL` | fallback 到 `NARRATORAI_BASE_URL` | SSE endpoint。 |

## 6. CI / GitHub Actions

本仓库可以在 pull requests 和 pushes 上运行 GitHub Actions checks。若你的 fork 或部署仓库中启用了 workflow files，请在启用部署或 e2e jobs 前配置以下 repository variables：

- `NARRATOR_PRICING_API_URL`
- `E2E_BASE_URL`

示例：

```bash
gh variable set NARRATOR_PRICING_API_URL --body "<backend-url>"
gh variable set E2E_BASE_URL --body "<frontend-url>"
```

常见 CI 检查包括 lint、TypeScript 检查、单元测试、生产构建、依赖审计，以及可选 Playwright e2e 测试。

## 7. Troubleshooting

### `NARRATOR_PRICING_API_URL environment variable is required`

`src/lib/*-backend-client.ts` 中的 lib clients 会在缺少该变量时 fail fast。请确认本地 `.env.local` 或部署环境 secrets 中设置了可访问的后端 URL。

### `/api/narrator/*` 路由返回 `401`

通常是 `PRICING_BFF_AUTH_TOKEN` 缺失，或与后端期望值不一致。请检查 Web 和后端两侧配置。

### Windows 上 Turbopack 崩溃（`STATUS_DLL_INIT_FAILED`）

设置 `NEXT_DEV_BUNDLER=webpack` 后重新运行 `pnpm dev`。

### 测试出现 `getPricingApiUrl is not a function` 类错误

Vitest 会运行 `src/__tests__/setup.ts`，该文件会设置默认 `NARRATOR_PRICING_API_URL`。如果你删除或重命名了该文件，请恢复它，或在运行测试前手动设置环境变量。
