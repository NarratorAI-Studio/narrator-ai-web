# CI

[中文](./ci_CN.md)

This repository runs the `CI` GitHub Actions workflow for pull requests and
pushes targeting `main`, `develop`, `release/**`, and `hotfix/**`.

The workflow delegates to the repository CI workflow, which can use a
configurable runner label expression:

```yaml
runs-on: ${{ vars.RUNNER_LABEL || 'ubuntu-latest' }}
```

Set the repository or organization variable `RUNNER_LABEL` to override the
default GitHub-hosted runner without editing workflow files.

## Checks

- `pnpm run lint`
- `tsc --noEmit`
- `pnpm test -- --coverage` on Node.js 20 and 22
- `pnpm run build`
- dependency audit

The workflow can also be started manually from the GitHub Actions tab through
`workflow_dispatch`.
