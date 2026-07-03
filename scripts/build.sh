#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"

cd "${APP_WORKSPACE_PATH}"

if [ "${SKIP_BUILD_INSTALL:-}" = "1" ]; then
  echo "Skipping dependency install because SKIP_BUILD_INSTALL=1."
else
  echo "Installing dependencies..."
  pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
fi

echo "Building the Next.js project..."
npx next build

echo "Bundling server with tsup..."
npx tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
