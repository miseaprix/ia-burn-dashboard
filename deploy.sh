#!/usr/bin/env bash
# Build and deploy the standalone dashboard; rerun to redeploy without losing history.
set -euo pipefail
umask 077

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_args=(--build)
port_override=""
usage() {
    cat <<'HELP'
Usage: ./deploy.sh [--port PORT] [--no-build]

Builds the local image, detects available personal caches and starts the dashboard.
Run the same command again to rebuild and redeploy. History volumes are preserved.

  --port PORT   Override BURN_PORT for this deployment (default: .env or 4090).
  --no-build    Reuse the existing local image.
  -h, --help    Show this help.

Requires Docker with Docker Compose v2 or later. On Windows, run inside WSL.
HELP
}
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)
            [[ $# -ge 2 ]] || fail '--port requires a number'
            port_override="$2"; shift 2 ;;
        --no-build) build_args=(--no-build); shift ;;
        -h|--help) usage; exit 0 ;;
        *) fail "Unknown argument: $1 (see --help)" ;;
    esac
done
validate_port() {
    [[ "$1" =~ ^[0-9]{1,5}$ ]] || fail 'Port must be a number from 1 to 65535'
    (( 10#$1 >= 1 && 10#$1 <= 65535 )) || fail 'Port must be from 1 to 65535'
}
if [[ -n "$port_override" ]]; then
    validate_port "$port_override"
    export BURN_PORT="$((10#$port_override))"
fi
command -v docker >/dev/null 2>&1 || fail 'Docker is not installed'
docker info >/dev/null 2>&1 || fail 'Docker is not running'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose is unavailable'

cd "$PROJECT_DIR"
if [[ ! -e .env ]]; then
    cp .env.example .env
    printf 'Created .env from .env.example.\n'
fi
[[ -f .env ]] || fail '.env must be a regular file'
compose_args=(--project-directory "$PROJECT_DIR" --env-file "$PROJECT_DIR/.env" -f "$PROJECT_DIR/docker-compose.yml")
# Let Compose parse/interpolate .env. Never source it or print credentials.
resolved_environment="$(docker compose "${compose_args[@]}" config --environment)"
while IFS='=' read -r key value; do
    case "$key" in
        TZ|BURN_PORT|ENTERPRISE_CLAUDE_DATA_DIR|ENTERPRISE_CODEX_DATA_DIR|ENTERPRISE_OPENCODE_DATA_DIR|CLAUDE_DATA_DIR|CODEX_DATA_DIR|CLAUDE_ACCOUNT_PATH|CLAUDE_NATIVE_CACHE_DIR|CLAUDE_NATIVE_HISTORY_DIR|AGENT_BURN_HISTORY_SOURCE|XDG_CACHE_HOME)
            export "$key=$value" ;;
    esac
done <<< "$resolved_environment"
unset resolved_environment
# Match native local-day buckets; keep a stable IANA timezone for yearly history.
if [[ -z "${TZ:-}" ]]; then
    timezone_link="$(readlink /etc/localtime 2>/dev/null || true)"
    case "$timezone_link" in
        */zoneinfo/*) export TZ="${timezone_link#*/zoneinfo/}" ;;
        *) export TZ=UTC ;;
    esac
    unset timezone_link
fi

absolute_path() {
    case "$1" in /*) printf '%s\n' "$1" ;; *) printf '%s/%s\n' "$PROJECT_DIR" "$1" ;; esac
}
port="${BURN_PORT:-4090}"
validate_port "$port"
export BURN_PORT="$((10#$port))"
for kind in claude codex; do
    if [[ "$kind" == claude ]]; then
        data_path="${CLAUDE_DATA_DIR:-$HOME/.claude}"
    else
        data_path="${CODEX_DATA_DIR:-$HOME/.codex}"
    fi
    data_path="$(absolute_path "$data_path")"
    if [[ ! -d "$data_path" ]]; then
        mkdir -p ".runtime/empty-$kind"
        data_path="$PROJECT_DIR/.runtime/empty-$kind"
        printf 'No %s logs directory: using an empty read-only mount.\n' "$kind"
    fi
    if [[ "$kind" == claude ]]; then
        export CLAUDE_DATA_DIR="$data_path"
    else
        export CODEX_DATA_DIR="$data_path"
    fi
done

for enterprise_kind in CLAUDE CODEX OPENCODE; do
    case "$enterprise_kind" in
      CLAUDE) enterprise_default="$HOME/.claude-enterprise" ;;
      CODEX) enterprise_default="$HOME/.codex-enterprise" ;;
      OPENCODE) enterprise_default="$HOME/.local/share/opencode" ;;
    esac
    enterprise_var="ENTERPRISE_${enterprise_kind}_DATA_DIR"
    enterprise_path="$(absolute_path "${!enterprise_var:-$enterprise_default}")"
    if [[ ! -d "$enterprise_path" ]]; then
      mkdir -p ".runtime/empty-enterprise-$enterprise_kind"
      enterprise_path="$PROJECT_DIR/.runtime/empty-enterprise-$enterprise_kind"
    fi
    export "$enterprise_var=$enterprise_path"
done

account_path="$(absolute_path "${CLAUDE_ACCOUNT_PATH:-$HOME/.claude.json}")"
if [[ -f "$account_path" ]]; then
    export CLAUDE_ACCOUNT_PATH="$account_path"
    compose_args+=(-f "$PROJECT_DIR/docker-compose.personal.yml")
    printf 'Claude account metadata enabled.\n'
fi
if [[ "$(uname -s)" == Darwin ]]; then
    native_default="$HOME/Library/Caches/agent-burn"
else
    native_default="${XDG_CACHE_HOME:-$HOME/.cache}/agent-burn"
fi
native_path="$(absolute_path "${CLAUDE_NATIVE_CACHE_DIR:-$native_default}")"
if [[ -f "$native_path/claude-usage.json" ]]; then
    export CLAUDE_NATIVE_CACHE_DIR="$native_path"
    history_path="$(absolute_path "${CLAUDE_NATIVE_HISTORY_DIR:-$HOME/Library/Application Support/Agent Burn}")"
    if [[ ! -d "$history_path" ]]; then history_path="$native_path"; fi
    export CLAUDE_NATIVE_HISTORY_DIR="$history_path"
    if [[ -f "$history_path/quota-archive.json" ]]; then
        printf 'Native quota history enabled (read-only).\n'
    fi
    compose_args+=(-f "$PROJECT_DIR/docker-compose.native-cache.yml")
    printf 'Native Claude quota cache enabled (read-only).\n'
fi

docker compose "${compose_args[@]}" config --quiet
printf 'Deploying IA Burn on port %s…\n' "$BURN_PORT"
docker compose "${compose_args[@]}" up -d "${build_args[@]}" --force-recreate --wait --wait-timeout 60
printf 'Ready: http://localhost:%s\n' "$BURN_PORT"
