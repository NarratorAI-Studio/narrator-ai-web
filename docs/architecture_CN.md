# narrator-ai-web 架构

[英文](./architecture.md)

## 分层架构（SOC，单一职责）

```text
┌─────────────────────────────────────────┐
│  narrator-ai-web（Next.js，本仓库）      │   ← 表现层 + BFF 层
│  - React UI                             │
│  - /api/* route handlers（BFF）          │
└─────────────────────────────────────────┘
              │  仅 HTTP
              ▼
┌─────────────────────────────────────────┐
│  兼容后端服务                            │   ← pricing、wallet、orchestration
│  上游 NarratorAI-compatible OpenAPI      │   ← 解说生成、任务流水线
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  托管数据库                              │   ← 数据层
│  （由 API 层管理，Web 层不直连）          │
└─────────────────────────────────────────┘
```

## 约束（由 lint 和 CI 保护）

1. **Web 层不直接使用数据库驱动。** `src/` 下禁止引入：
   - **数据库连接器：** `pg`、`pg-pool`、`pg-native`、`postgres`、`mysql`、`mysql2`（包括 `mysql2/promise`）、`mongodb`、`mongoose`、`better-sqlite3`、`sqlite3`
   - **ORM / migration 工具：** `drizzle-orm`（包括 `drizzle-orm/*`）、`drizzle-zod`、`drizzle-kit`、`prisma`、`@prisma/*`、`typeorm`、`sequelize`
   - **Query builders：** `knex`、`kysely`（包括 `kysely/*`）

   这些规则由 `eslint.config.mjs` 维护：
   - `no-restricted-imports` 覆盖 ESM `import`，包括子路径匹配。
   - `no-restricted-syntax` 覆盖 CommonJS `require('pg')` 和动态 `import('mysql2')`。

   Web 层只通过 HTTP 调用后端服务。

2. **Web 部署应避免直接配置数据库连接。** 新部署应把数据库连接留在 API / pricing 服务后面。`.env.example` 中保留的 legacy `MYSQL_*` 配置仅用于兼容路径，除非你明确使用该路径，否则应保持未设置。

3. **服务端 secret 必须留在服务端。** 任何 `NEXT_PUBLIC_` 前缀变量都会进入浏览器 bundle，只能用于 feature flags 和公开 URL。

## 为什么这样设计

混合层级，例如 Web 直接读取生产数据库，会带来：

- **故障隔离变差**：数据库故障会直接拖垮 Web，而不只是影响 API。
- **Schema coupling**：数据库 schema 变更会迫使 Web 和后端联动发布。
- **认证和行级权限复杂化**：访问控制应在 API 层集中处理。
- **连接数风险**：Next.js per-request handlers 可能耗尽数据库连接池。

如果你需要在 `src/` 里写数据库查询，应该把查询能力加到 API 服务，再由 Web 通过 HTTP 调用。

## 允许的出站依赖

| 服务 | 用途 | 模块 |
|---|---|---|
| 上游 NarratorAI-compatible OpenAPI（`NARRATORAI_BASE_URL`） | Templates、tasks、narration core | `src/lib/narrator-client.ts` |
| 兼容后端服务（`NARRATOR_PRICING_API_URL`） | Template price lookup、wallet、orchestration | `src/lib/hard-price-client.ts` |
| 上游存储 / 集成服务 | 应用特定集成 | various |
