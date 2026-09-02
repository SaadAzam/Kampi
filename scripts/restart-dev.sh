#!/usr/bin/env bash
# Stop any running Kampi apps, refresh local setup, then start the full stack.
# Usage: pnpm dev:reset
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORTS=(3000 3001 4000 2567 5173 5174)

log() { printf '\n==> %s\n' "$*"; }

kill_pids() {
  local signal="$1"
  shift
  if (($# == 0)); then
    return 0
  fi
  kill -s "$signal" "$@" 2>/dev/null || true
}

collect_pids() {
  local pid
  local -a found=()
  for pid in "$@"; do
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      found+=("$pid")
    fi
  done
  if ((${#found[@]} > 0)); then
    printf '%s\n' "${found[@]}"
  fi
}

pids_on_port() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
}

turbo_dev_pids() {
  pgrep -f "turbo run dev" 2>/dev/null || true
}

stop_stack() {
  log "Stopping any running Kampi apps"

  local -a pids=()
  local pid port

  while IFS= read -r pid; do
    pids+=("$pid")
  done < <(turbo_dev_pids)

  if ((${#pids[@]} > 0)); then
    echo "    turbo: ${pids[*]}"
    kill_pids TERM "${pids[@]}"
    sleep 1
  fi

  for port in "${PORTS[@]}"; do
    local -a port_pids=()
    while IFS= read -r pid; do
      port_pids+=("$pid")
    done < <(pids_on_port "$port")

    if ((${#port_pids[@]} > 0)); then
      echo "    port ${port}: ${port_pids[*]}"
      kill_pids TERM "${port_pids[@]}"
    fi
  done

  sleep 0.8

  pids=()
  while IFS= read -r pid; do
    pids+=("$pid")
  done < <(collect_pids $(turbo_dev_pids))
  if ((${#pids[@]} > 0)); then
    echo "    force-stopping turbo: ${pids[*]}"
    kill_pids KILL "${pids[@]}"
  fi

  for port in "${PORTS[@]}"; do
    local -a port_pids=()
    while IFS= read -r pid; do
      port_pids+=("$pid")
    done < <(collect_pids $(pids_on_port "$port"))

    if ((${#port_pids[@]} > 0)); then
      echo "    force-stopping port ${port}: ${port_pids[*]}"
      kill_pids KILL "${port_pids[@]}"
    fi
  done

  echo "    stack is stopped"
}

clean_artifacts() {
  log "Cleaning build artifacts"
  rm -rf .turbo
  local dir
  for dir in apps/* packages/*; do
    rm -rf "${dir}/dist" "${dir}/.next" "${dir}/.turbo" "${dir}/out"
  done
}

ensure_env() {
  if [[ ! -f .env ]]; then
    log "Creating .env from .env.example"
    cp .env.example .env
  fi
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
}

ensure_node() {
  local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -f .nvmrc && -s "$nvm_sh" ]]; then
    # shellcheck disable=SC1090
    . "$nvm_sh"
    if nvm use >/dev/null 2>&1; then
      echo "    using $(node -v)"
      return 0
    fi
    echo "    .nvmrc Node $(cat .nvmrc) is not installed; continuing with $(node -v)."
  fi
}

wait_for_container() {
  local name="$1"
  local i
  for i in $(seq 1 40); do
    if [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)" == "healthy" ]]; then
      return 0
    fi
    sleep 0.5
  done
  echo "Timed out waiting for ${name} to become healthy." >&2
  docker compose ps
  exit 1
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local i
  for i in $(seq 1 90); do
    if curl -sf "$url" >/dev/null 2>&1; then
      printf '    ✓ %s\n' "$label"
      return 0
    fi
    sleep 1
  done
  printf '    ✗ %s (not ready after 90s)\n' "$label" >&2
  return 1
}

print_service_urls() {
  cat <<'EOF'

  Kampi local stack
  ─────────────────────────────────────────
  Web (lobby)     http://localhost:3000
  Admin           http://localhost:3001
  API             http://localhost:4000
  API health      http://localhost:4000/health/live
  API docs        http://localhost:4000/docs
  Realtime        ws://localhost:2567
  RPS game        http://localhost:5173
  Penalty Duel    http://localhost:5174
  ─────────────────────────────────────────
  Two-player test: open Penalty or RPS in two browser profiles, or use
  POST http://localhost:4000/auth/guest for distinct guest tokens.

EOF
}

ensure_docker() {
  log "Starting Postgres and Redis"
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Start Docker Desktop and retry." >&2
    exit 1
  fi
  docker compose up -d
  wait_for_container kampi-postgres
  wait_for_container kampi-redis
}

main() {
  stop_stack
  clean_artifacts
  ensure_env
  ensure_node
  ensure_docker

  log "Installing dependencies"
  corepack enable >/dev/null 2>&1 || true
  pnpm install

  log "Generating Prisma client"
  pnpm db:generate

  log "Building packages"
  pnpm -r --filter "./packages/**" --if-present build

  log "Applying migrations"
  pnpm db:migrate

  log "Seeding database"
  pnpm db:seed

  log "Starting all apps (turbo dev)"
  print_service_urls

  pnpm dev &
  DEV_PID=$!

  log "Waiting for core services"
  wait_for_http "http://localhost:4000/health/live" "API http://localhost:4000" || true
  wait_for_http "http://localhost:2567/health/ready" "Realtime ws://localhost:2567" || true
  wait_for_http "http://localhost:3000/" "Web http://localhost:3000" || true
  wait_for_http "http://localhost:5173/" "RPS http://localhost:5173" || true
  wait_for_http "http://localhost:5174/" "Penalty Duel http://localhost:5174" || true

  log "Stack ready — open the lobby:"
  print_service_urls

  wait "$DEV_PID"
}

main "$@"
