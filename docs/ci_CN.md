# CI

[英文](./ci.md)

本仓库可以为 pull requests 和 pushes 运行 `CI` GitHub Actions workflow，常见目标分支包括 `main`、`develop`、`release/**` 和 `hotfix/**`。

Workflow 可以使用可配置的 runner label：

```yaml
runs-on: ${{ vars.RUNNER_LABEL || 'ubuntu-latest' }}
```

如需覆盖默认 GitHub-hosted runner，可在 repository 或 organization 级别设置 `RUNNER_LABEL` 变量，而无需修改 workflow 文件。

## 检查项

- `pnpm run lint`
- `tsc --noEmit`
- 在 Node.js 20 和 22 上运行 `pnpm test -- --coverage`
- `pnpm run build`
- dependency audit

Workflow 也可以通过 GitHub Actions 页面的 `workflow_dispatch` 手动触发。
