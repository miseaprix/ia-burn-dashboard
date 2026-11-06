# Configuration et fonctionnement détaillés

One Docker image serves the Fastify API and the React dashboard, with an Overview,
sidebar and per-harness views. Local usage and the corporate API are separate providers.

| View | Data | Limits |
|---|---|---|
| Local | Claude Code / Codex JSONL parsed in Node; tokens, models, API-equivalent cost | Personal OAuth quotas; Codex can fall back to recent session `rate_limits` |
| API | Enterprise daily activity / spend logs; dollars and requests | Daily spend, tokens and models; configured monthly budget, default $300; no personal quota counters |

## Start (macOS, Linux, Windows with WSL)

Docker / Compose must be available. Run Windows commands **inside WSL**, using
WSL home paths for the coding agents. Docker Desktop needs WSL integration enabled.

```bash
./deploy.sh
# http://localhost:4090
# Run ./deploy.sh again to rebuild and redeploy.
```

The script can be invoked from any directory.
It creates `.env` from `.env.example` only if absent, detects Claude account metadata
and the native Agent Burn cache, and selects the needed Compose overrides. It builds
the image, recreates the container and waits up to 60 seconds for its healthcheck.
Named history volumes are preserved. Existing `.env` settings are retained.

```bash
./deploy.sh --port 4095    # Use a free port if 4090 is occupied.
./deploy.sh --no-build    # Reuse the existing image.
./deploy.sh --help
```

`--port` applies to the current invocation. Set `BURN_PORT` in `.env` for a persistent
port choice. The script uses the Docker daemon's native architecture. Multi-arch
export remains a separate build command below. It never sources the corporate shell
file or `.env`; Compose parses the configuration.

Missing Claude/Codex directories use empty read-only mounts under ignored
`.runtime/`. For the corporate view, enter your API key in **Admin** and set
`ENTERPRISE_BASE_URL` (or `ANTHROPIC_BASE_URL`); without it the enterprise source is disabled.
IA Burn works standalone; on macOS the agent-burn app, if installed, keeps Claude
quotas fresh and provides their history (optional `docker-compose.native-cache.yml`,
selected automatically by `deploy.sh`).

`CLAUDE_DATA_DIR` / `CODEX_DATA_DIR` override the host directories (defaults:
`${HOME}/.claude`, `${HOME}/.codex`). Container paths stay `/data/claude` and
`/data/codex`. Both mounts are read-only. Port: `BURN_PORT`, default 4090.
Corporate credentials are configured through **Admin** and retained in the
persistent state volume. `ANTHROPIC_AUTH_TOKEN` in `.env` remains an optional
initial credential; Admin takes precedence. Base URL and TLS remain deployment
settings. No corporate shell file or empty corporate mount is required.

No coding-agent binary is needed: parsing is implemented in Node.

For native Windows PowerShell, use absolute paths with forward slashes in `.env`,
for example `CLAUDE_DATA_DIR=C:/Users/you/.claude`,
`CODEX_DATA_DIR=C:/Users/you/.codex`, `CLAUDE_ACCOUNT_PATH=C:/Users/you/.claude.json`.
Copy the configuration with `Copy-Item .env.example .env` and run the same Docker
commands. The host paths must belong to the environment where the agents run.

## Personal quotas and persistence

The backend reads `.credentials.json` from the mounted Claude directory
(`claudeAiOauth.accessToken`), and Codex `auth.json` (`tokens.access_token`).
Credentials are never refreshed or written. Corporate `ANTHROPIC_AUTH_TOKEN`
is never sent to the personal endpoints.

To mount Claude's account metadata and cached quota readings, **when the file exists**:

```bash
docker compose -f docker-compose.yml -f docker-compose.personal.yml up -d --build
```

The override binds `${HOME}/.claude.json` read-only. A missing file fails explicitly
rather than creating a directory. Customize `CLAUDE_ACCOUNT_PATH` if needed.
On macOS, native Agent Burn reads Claude credentials from the Keychain, which
Docker cannot access. If Agent Burn is installed and collecting quotas, reuse
its usage cache without exporting credentials:

```bash
docker compose -f docker-compose.yml -f docker-compose.personal.yml -f docker-compose.native-cache.yml up -d --build
```

The native override mounts `~/Library/Caches/agent-burn` read-only. Mounting the
directory preserves updates when the native app replaces `claude-usage.json`
atomically. Override the host directory with `CLAUDE_NATIVE_CACHE_DIR` (Linux:
`~/.cache/agent-burn`). Keep the native app running to refresh its cache.
Readings older than 15 minutes, future timestamps, malformed bodies and expired
windows are rejected. The native cache does not carry an account identifier:
mount only the cache of the personal account used by this dashboard. History
is partitioned using the mounted Claude account metadata.

The Claude Code cache in `.claude.json` remains a separate fallback: it must match
`oauthAccount.accountUuid` and be no older than 15 minutes.

Quota collection runs every minute, independently of open browser tabs. Calls
have a five-second timeout, 1 MB response bound, shared cache and 429 backoff.
Historical readings are saved in the `burn-state` named volume at `/data/state`.
Only normalized timestamps / quota percentages are persisted, partitioned by a
hashed account identifier; tokens and log content are excluded. History retention
is eight days. Keep the volume when upgrading (`docker compose down` without `-v`).
Expired windows disappear; stale readings are labeled. Unknown quotas / prices
remain `null`. Surface/model weekly-limit usage and banked resets require a live
ChatGPT response; they are not inferred from token logs. Cursor is outside scope.

`CLAUDE_PLAN` / `CODEX_PLAN` provide label/price fallbacks (max5x / plus by default).
Detected account plans take precedence. Plan prices never determine quota percentages.
Local spend is API-equivalent token value, not the subscription bill.

## Corporate TLS and errors

TLS verification is enabled by default. For an internal CA, mount the CA file and
set `NODE_EXTRA_CA_CERTS` to its container path. The temporary test switch
`ENTERPRISE_INSECURE_TLS=1` affects only corporate requests, through per-request TLS
options. No global `NODE_TLS_REJECT_UNAUTHORIZED` mutation is used.

A failed model-log request preserves daily activity and the budget chart. A failed
monthly activity request shows an unavailable-budget warning, never zero spend.
The selected-range spend KPI remains independent of the month-to-date budget.

## Architecture and API

`GET /api/health`; `GET /api/dashboard?source=local|enterprise|enterprise-local&range=mtd`.
`GET /api/config` (public, read-only) returns the enterprise display label
(`ENTERPRISE_LABEL`, default "Enterprise") and whether the enterprise source is enabled.
Ranges: today, yesterday, wtd, mtd (default), week, month, ytd, all, custom; personal-only
rtd requires an active weekly quota. Legacy 7d / 30d aliases remain supported.
The v2 JSON contract exposes `harnesses`, `subscriptions`, `requested` and observed
`period`, costs / tokens / models per harness, quota samples and optional surfaces.
`spend` / `byGroup` aliases are retained; model `share` is a fraction in [0,1].
See [Architecture](ARCHITECTURE.md) for the implementation and collection lifecycle.

## Build for both architectures

No registry is needed. An OCI archive contains both platforms:

```bash
docker buildx create --name burn-builder --driver docker-container --use
docker buildx build --platform linux/amd64,linux/arm64 \
  --output type=oci,dest=ia-burn.oci.tar -t ia-burn:latest .
```

For deployment on a machine, build/load the appropriate platform locally (or use
`docker compose up --build`):

```bash
# Intel / AMD PC:
docker buildx build --platform linux/amd64 --load -t ia-burn:latest .
# Apple Silicon / ARM Linux:
docker buildx build --platform linux/arm64 --load -t ia-burn:latest .
```

CI tests the backend and builds each architecture natively on the available
Docker runners with rootless BuildKit. The artifacts are
`ia-burn-amd64.oci.tar` and `ia-burn-arm64.oci.tar`;
no image is published to a registry.

## Development / verification

```bash
cd backend
npm ci
npm test
CLAUDE_CONFIG_DIR="$HOME/.claude" CODEX_HOME="$HOME/.codex" \
  CLAUDE_ACCOUNT_FILE="$HOME/.claude.json" STATE_DIR=./state npm start
```

In a second terminal, `cd frontend`, `npm ci`, `npm run dev`. `npm run build`
produces the frontend served by the backend. Vite proxies `/api` in development.

## Historical curves and interactive charts

On macOS, `deploy.sh` also mounts `~/Library/Application Support/Agent Burn`
in read-only mode when the native cache is detected. `quota-archive.json`
provides past quota readings; the current usage cache alone cannot reconstruct
past curves. Override the directory with `CLAUDE_NATIVE_HISTORY_DIR`. Archives
with multiple sources require an explicit `AGENT_BURN_HISTORY_SOURCE` key;
readings from different source groups are never merged. The archive identifies
host paths, not OAuth accounts: select history belonging to the current account.

The web quota algorithms port native `Usage.swift` and `QuotaHistory.swift`:
cycle corrections, plateaus, short-gap steps, linear interpolation across
missing readings, pace crossings and forecasts. Move or drag over any chart
(quota, spend, Codex Surface/Model, corporate budget) to inspect its values.
Arrow keys, Home/End and Escape also control the cursor.

## SQLite history and parsed log cache

The backend requires Node 24+ and uses its built-in SQLite module. Docker and
CI use Node 24. `/data/state/burn.sqlite` is stored in the existing persistent
`burn-state` volume, with WAL mode, prepared queries, transactions and a
versioned schema. Keep the whole volume during deployment and backup; it contains
the database and its WAL files, alongside existing quota observations.

Unchanged Claude/Codex JSONL logs reuse normalized metrics, with a bounded memory
cache (up to 8,192 entries and an estimated 64 MiB budget) and indexed SQLite lookup after restart. New, changed, truncated or
atomically replaced files are reparsed. The earlier JSON cache is imported lazily
when its file signature still matches, without deleting prior files. Prompts,
full messages and authentication credentials are not stored.

Daily consumption is stored by dataset, date and harness, with model breakdowns
and token categories. Historical daily rows have **no age-based retention limit**.
Extracted metrics from removed log files stay available; they are included in
local aggregation with the same cross-file deduplication rules. The current
quota graph's eight-day window does not limit consumption history.

`GET /api/history/yearly` returns indexed personal yearly totals, observed day
counts, first/last dates and model counts, without scanning logs or calling a
vendor. `?source=enterprise` returns separately stored corporate daily activity.
Autonomous collectors populate history even without a browser; existing local logs are imported
at server startup and on scheduled collection. Corporate history only covers activity actually returned by the
API; this does not backfill unavailable years or bypass API pagination. Unknown
corporate token/model counts remain null. The response also appears as
`yearlyHistory` in dashboard data, ready for a future comparison view.

Set `USAGE_HISTORY_DATASET` to a stable alias for each account/log dataset and
keep it unchanged across token rotations. Personal and corporate histories are
isolated. Local datasets also incorporate log roots and timezone. Annual totals
cover observed data, not guaranteed complete years; compare equivalent periods
when tracking a current partial year. Spend remains API-equivalent estimates
using the available local price table, whose missing-model limitations still apply.

Directory discovery and deduplicated ingestion run in the autonomous local collector;
dashboard requests query normalized daily metrics from SQLite. The native quota archive
has a separate bounded memory cache and is read again when it changes.

## Planned monitor integration

The second phase will incorporate capabilities from the local Claude Code Monitor
project. This requires detailed session/event tables, source-qualified identities
and snapshot deduplication, alongside the existing daily aggregates.
The current delivery provides the durable history/cache foundation; monitor
features and the yearly comparison screen are not activated yet.

`deploy.sh` detects the host timezone from `/etc/localtime` where available, with
a UTC fallback. Override `TZ` in `.env` to keep daily/yearly buckets consistent
with the native application. Manual Compose deployments default to UTC.

## Missing model prices

A model without a known tariff has `spend` / `cost: null`, with any priced
portion in `knownSpend`. Totals, groups and daily rows keep the known subtotal
and expose `costComplete` plus `unknownTokens`. The dashboard labels partial
spend, keeps all tokens, and hides cost shares and token/dollar ratios when the
period is incomplete. Financial quota estimates are also unavailable if their
own observation window includes unpriced usage. Explicitly reported zero costs
remain valid; no model tariffs are invented.

SQLite schema 5 records cost coverage, collection state and token cost details without deleting existing rows or caches.
Legacy yearly rows remain unverified until refreshed from normalized logs.
Existing Claude logs are reparsed once to retain reported-cost provenance;
removed logs still use the prior cache, with ambiguous unpriced zeros marked
unknown. Old images cannot open a newer SQLite schema: use a database backup
with the old image if reverting. Keep a backup of the volume before upgrading.

## Project commands and collection

From the repository root, `npm run install:all` installs both packages using their
existing lockfiles. `npm test`, `npm run build`, `npm run check`, and `npm start`
provide one entry point for verification, frontend build and backend startup.
Local development still uses two terminals (`npm start` and `npm run dev:frontend`).

See [docs/ARCHITECTURE.md](ARCHITECTURE.md) for module responsibilities,
autonomous collection, configurable intervals, lifecycle and historical coverage.
The default cadences are 60 seconds for local consumption/quotas and 5 minutes for
corporate consumption. Browser refreshes read SQLite without triggering ingestion.
`/api/collection/status` exposes collection state; SQLite schema 5 preserves the
existing volume. Keep a backup before upgrading.

Custom dates are available in the Period selector, and through
`/api/dashboard?range=custom&from=2026-09-20&to=2026-09-30`.
Periods including today refresh every minute while visible; fixed past periods do
not poll. Relative periods shift at server-local midnight. Refresh errors preserve
previous metrics. The Refresh button consults collected data; it does not force
vendor calls. Future intraday/session details and historical corporate backfill
remain outside this delivery.

## Automatic pricing catalogs

Personal ingestion refreshes the public LiteLLM pricing catalog and models.dev
at startup when due, then every six hours (`PRICING_REFRESH_MS`, minimum 60 s).
No LiteLLM server or API key is needed. Requests use verified TLS, an 8-second
limit per source and a 16 MiB response limit. Dashboard reads make no network calls.
Each validated catalog is persisted independently in SQLite `collection_state`;
restart/offline operation restores the last valid prices. Failed or empty responses
retain the previous catalog and retry after 15 minutes. `/api/pricing/status`
reports source URLs, timestamps, errors and model counts without exposing the catalog.

Price lookup uses embedded tariffs overridden by LiteLLM, then live/cached
models.dev and its embedded snapshot. Input/output/cache rates and applicable
long-context/fast multipliers are used. Tokens without a matching tariff remain
unknown. Costs are API-equivalent estimates, not subscription charges; catalogs
are third-party references rather than invoices.

Claude logs are reparsed once to retain normalized pricing counters (including
cache duration and speed), without prompts or credentials. Subsequent ingestion
revalues unchanged or deleted cached logs from these counters. Explicit reported
costs, including zero, are preserved. Older deleted Claude caches lacking these
counters retain their previous cost/coverage. Codex counters are already retained.
Historical estimates use the currently available tariffs, not a dated tariff ledger.
The existing SQLite schema and Docker volume are preserved. Backup before this
change: `.runtime/burn-before-dynamic-pricing.sqlite` (ignored by Git).

## Codex daily quota breakdown

The daily percent breakdown is collected independently from live/log quota
snapshots, once per minute. SQLite retains the last valid breakdown per account
across restarts; a failed or unsupported provider response retains it for up to
15 minutes and marks it stale. A successful empty response clears the prior
breakdown. No surface usage is inferred from token logs. In live Codex views,
the panel stays visible with an unavailable/empty message when no usable data
exists. Historical periods still hide the current quota panel.


## Personal usage detail panels

Personal Claude Code and Codex views display a visible Token breakdown for the
selected period. The expanded Subscription economics panel uses a separate
rolling 30-day window, shown explicitly in its header: API-equivalent usage,
monthly plan/value, daily spend, spend by token type, weekly trend and current
weekly quota value estimates. Selecting a past period does not change this
30-day economics window; current quota estimates require a live quota reading.

Token cost components use the same model prices as the overall totals. Reported
cost totals without a per-token allocation remain valid totals, but their
unallocated token cost categories display as unavailable. The first day of the
rolling window is prorated from daily aggregates, so intraday precision is not
claimed. These values estimate API-equivalent usage, not subscription invoices.

Codex image generation calls are deduplicated by call ID from local logs. The
image section uses a separate fixed estimate of $0.15 per observed call, matching
the native reference, and does not add this estimate to token spend. Calls can
include attempts; this is not a count of successfully delivered images. Legacy
caches without image coverage display unavailable rather than zero. Image
payloads and results are not stored.

SQLite migration 5 adds token cost components and image counts without deleting
history or changing the Docker volume. Keep a backup before upgrading.

Codex personal views display both the five-hour session and weekly limits.
The session panel includes the local reset time; alerts distinguish exhausted
limits from pace-based forecasts and consider both windows.


## Enterprise local by harness

The source switch offers Local (personal), Enterprise local and API (gateway).
Enterprise local reads Claude Code logs from `~/.claude-enterprise`, Codex sessions
from `~/.codex-enterprise`, and the shared OpenCode SQLite database at
`~/.local/share/opencode/opencode.db`. Override host directories with
`ENTERPRISE_CLAUDE_DATA_DIR`, `ENTERPRISE_CODEX_DATA_DIR`, `ENTERPRISE_OPENCODE_DATA_DIR`.
`deploy.sh` mounts these read-only and uses empty mounts if absent.

Claude/Codex usage is classified by the dedicated enterprise root. OpenCode has a
shared database: only completed assistant messages whose provider id is listed in
`ENTERPRISE_OPENCODE_PROVIDERS` (comma-separated, empty by default) are included (legacy `message` and v2 `session_message`).
Each harness has totals, models, spend history and token breakdown. Corporate
local data has a separate persistent dataset and minute collection loop; past
periods and yearly history work as for personal logs. Personal subscriptions,
quota forecasts and surface charts are excluded from this source.

These are observed metrics of this machine, not the complete usage of a key across
machines or the corporate invoice. Token costs use model catalogs; unknown
prices retain token counts and flag incomplete spend. OpenCode gateway cost
zero is replaced with a token-based estimate. Changing a provider inside a
dedicated Claude/Codex enterprise root requires separating logs to avoid mixing
sources. OpenCode deleted messages cannot be repriced from source after removal;
previous daily aggregates remain in SQLite. Monitor integration remains phase 2.

The Help page in the sidebar explains sources, per-harness classification,
cost estimates and refresh behavior in French.


## Enterprise gateway

The Enterprise source (formerly API) reads every page of `/user/daily/activity`.
The gateway can split a day across pages: daily and model metrics are merged
before storing them. Tokens and model costs are supplied by activity itself;
`/spend/logs` is no longer needed. Failed pagination preserves the last valid
collection. Raw spend precision is kept in SQLite and rounded for display.

The autonomous collector reconciles the last 30 days every five minutes.
Daily model totals persist and can be filtered by dates without using today's
snapshot for a past period. Older history is limited to previously collected
data; a full historical backfill is still pending. The monthly budget limit
is `ENTERPRISE_BUDGET` (default 300 USD), not a limit discovered from the API.
Personal quotas remain separate. Labels: Perso / Enterprise local / Enterprise.

## Local Admin settings

Open **Admin** at the bottom of the sidebar to set an Enterprise API key, the
monthly budget and collection intervals. Leave the key blank to keep it.
Saved settings override startup environment values; removing the Admin key
returns to the startup key, if configured. `deploy.sh` also works without a
corporate credential file, allowing the first key to be entered in Admin.
The gateway URL and TLS policy remain deployment settings.

The key is encrypted with AES-256-GCM in `/data/state/admin-settings.json`;
`/data/state/admin-secret.key` contains the encryption material. Both files use
permissions 0600 and stay in the existing Docker volume, outside metrics SQLite.
The API returns only key presence/source, never its value. Back up both files
privately: encryption does not protect against someone with access to the whole
volume. A different key (or return to startup credentials) opens a separate
corporate history scope; previous datasets are retained. Rotating a key therefore
also starts a new scope, even when it belongs to the same account.

Admin edits apply without rebuilding the image and restart active collectors.
Budget changes affect Burn's forecasts only, not the gateway's account budget.
Local logs accept 15–3600 seconds, personal quotas 30–3600 seconds, and corporate
API 60–86400 seconds. Dashboard polling remains one minute for live periods.

This is a single-user localhost administration page. Compose binds to
127.0.0.1 by default; Admin rejects non-loopback Host headers and cross-origin
browser requests. There is no remote multi-user admin login. Do not expose the
application publicly; remote administration requires a separate authenticated
access design. `BURN_BIND_HOST` can override the Docker bind for deployments,
but does not enable remote Admin access.

## Codex subscription tiers

Quota windows come from vendor readings. Burn hides the session card when no
short window is returned. The generic `pro` label does not identify the actual
monthly subscription price: set `CODEX_MONTHLY_PRICE` in `.env` to your price
(e.g. 100, 200 or 500 USD). Without this setting, Pro price and price-dependent
economics remain unavailable, rather than assuming a 200 USD subscription.
