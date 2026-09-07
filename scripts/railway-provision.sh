#!/usr/bin/env bash
# Create and deploy Kampi services on Railway. Requires: railway login
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! railway whoami >/dev/null 2>&1; then
  echo "Run: railway login"
  exit 1
fi

JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

if [[ ! -f "$ROOT/.railway/config.json" ]] && [[ ! -f "$ROOT/railway.toml" ]]; then
  railway init --name kampi --json || true
fi

railway add --database postgres --json || true
railway add --database redis --json || true

for svc in api realtime web game-rps game-penalty; do
  railway add --service "$svc" --json || true
done

echo "Project linked. Generate domains, set variables, then railway up --service <name> --detach --yes"
