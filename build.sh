#!/usr/bin/env bash
set -euo pipefail

# Builds the usage-statistics plugin as a c-shared dynamic library.
# c-shared requires CGO_ENABLED=1 and a C toolchain (gcc / mingw-w64).
# The SQLite driver itself is pure Go (modernc.org/sqlite).

if [[ ! -s web/dist/index.html ]]; then
  echo 'Build the embedded pages first: cd web && bun install --frozen-lockfile && bun run build' >&2
  exit 1
fi

ext="so"
case "$(go env GOOS)" in
  windows) ext="dll" ;;
  darwin) ext="dylib" ;;
esac

ldflags="-s -w"
if [[ -n "${PLUGIN_VERSION:-}" ]]; then
  ldflags="${ldflags} -X 'main.pluginVersion=${PLUGIN_VERSION}'"
fi
if [[ -n "${PLUGIN_AUTHOR:-}" ]]; then
  ldflags="${ldflags} -X 'main.pluginAuthor=${PLUGIN_AUTHOR}'"
fi
if [[ -n "${PLUGIN_REPOSITORY:-}" ]]; then
  ldflags="${ldflags} -X 'main.pluginRepository=${PLUGIN_REPOSITORY}'"
fi

CGO_ENABLED="${CGO_ENABLED:-1}" go build -trimpath -ldflags="${ldflags}" -buildmode=c-shared -o "usage-statistics.${ext}" .
if command -v strip >/dev/null 2>&1; then
  strip "usage-statistics.${ext}" 2>/dev/null || true
fi
echo "Built $(pwd)/usage-statistics.${ext}"
