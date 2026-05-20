#!/usr/bin/env bash
# launchd entrypoint for com.swingpro.server.
#
# Why this script exists: the launchd plist used to invoke `node server.js`
# directly, which meant `dist/` (the Vite-built SPA) only got rebuilt when
# the user remembered to run `npm run build`. After source changes, the
# browser would happily serve a months-old bundle — making UI fixes look
# "not applied" even though they were committed. (Surfaced 2026-05-20.)
#
# This wrapper:
#   1. cds to the repo root (launchd's WorkingDirectory is unreliable
#      across nvm + brew node setups)
#   2. runs `npm run build` so dist/ matches the current source on every
#      server start. Build failures are logged but NOT fatal — we'd rather
#      serve a slightly stale dist than no service at all.
#   3. execs node server.js so signals (SIGTERM from launchctl kickstart -k,
#      SIGINT from a clean shutdown) propagate to the node process directly
#      instead of being absorbed by this shell wrapper. Critical for
#      launchd KeepAlive accounting.
#
# Boot adds ~2s for the Vite build. Worth it.

set -u  # treat unset vars as errors (but NOT -e — we want to survive a bad build)

# Absolute path to project root. The plist's WorkingDirectory often gets
# clobbered by nvm shims; derive it from this script's location instead.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR" || { echo "[start-server] FATAL: cd to $PROJECT_DIR failed"; exit 1; }

echo "[start-server] $(date '+%Y-%m-%d %H:%M:%S') booting from $PROJECT_DIR"

# Ensure node is on PATH (launchd's PATH is minimal; nvm Node lives under HOME).
# The plist sets PATH explicitly but we double up here for defense.
export PATH="$HOME/.nvm/versions/node/v20.19.2/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

# Rebuild dist/ so the browser sees the latest committed UI. If this fails
# we keep going — old dist/ is better than no service.
echo "[start-server] running npm run build ..."
if npm run build > /tmp/swingpro-build.log 2>&1; then
  echo "[start-server] build ok — dist/ refreshed"
else
  rc=$?
  echo "[start-server] WARN: npm run build exited $rc — continuing with existing dist/"
  echo "[start-server] last 10 lines of build log:"
  tail -10 /tmp/swingpro-build.log 2>/dev/null | sed 's/^/[start-server]   /'
fi

# Hand off to node. exec replaces this shell so signals reach node directly
# and launchd's KeepAlive sees the right process.
echo "[start-server] handing off to node server.js"
exec node server.js
