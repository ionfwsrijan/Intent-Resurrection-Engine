# API Reference

## Health

### `GET /api/health`

Returns service availability and runtime metadata.

## Dashboard

### `GET /api/v1/dashboard`

Returns:

- workspace, source, session, and analysis metrics
- recent sessions
- recent analyses
- configured public collector URLs
- auth state for the current viewer

## Authentication

### `GET /api/v1/auth/state`

Returns whether auth is enabled, whether the instance still needs its first admin user, and the authenticated viewer when present.

### `POST /api/v1/auth/bootstrap-admin`

Bootstraps the first admin user. Only works before any user exists.

### `POST /api/v1/auth/login`

Returns a bearer token plus the authenticated user.

### `POST /api/v1/auth/logout`

Invalidates the current bearer token.

## Workspaces

### `GET /api/v1/workspaces`

List all workspaces.

### `POST /api/v1/workspaces`

Create a workspace.

Body:

```json
{
  "name": "Platform Ops",
  "rootPath": "D:/Work/platform-ops",
  "description": "Recovery support for operational work",
  "notificationWebhookUrl": "slack:https://hooks.slack.com/...",
  "notificationDigestMinutes": 30,
  "notificationQuietStart": "22:00",
  "notificationQuietEnd": "08:00",
  "notificationIntentIds": ["auth_debugging"],
  "notificationMinIdleMinutes": 60
}
```

### `PUT /api/v1/workspaces/:id`

Update workspace metadata and notification settings.

## Sources

### `GET /api/v1/sources`

List registered sources.

### `POST /api/v1/sources`

Create a source and issue a plaintext token once.

Body:

```json
{
  "workspaceId": "workspace-id",
  "type": "browser-extension",
  "name": "Chrome on Primary Laptop"
}
```

Response includes:

- `plaintextToken`
- `tokenPreview`
- `ingestionWebhookUrl`

## Ingestion

### `POST /api/v1/ingestion/session`

Headers:

- `X-Source-Token: <token>`

Body accepts a live snapshot with arrays of objects or strings.

Supported trace buckets:

- `browserTabs`
- `browserClusters`
- `fileActivity`
- `clipboardFragments`
- `terminalHistory`
- `draftNotes`
- `gitStatus`
- `appFocus`
- `activityTimeline`

Supported metadata:

- `sessionId`
- `title`
- `channel`
- `occurredAt`
- `context`
- `metrics`

## Analysis

### `POST /api/v1/analysis/run`

Run or rerun analysis for an existing session.

Body:

```json
{
  "sessionId": "session-id"
}
```

### `GET /api/v1/analyses`

List recent analyses.

## Sessions

### `GET /api/v1/sessions`

List sessions with attached latest analysis.

### `GET /api/v1/sessions/:id`

Return full session detail, including sanitized snapshot preview and analysis history.

### `GET /api/v1/sessions/:id/comparison`

Return the latest-vs-previous analysis delta for a session.

### `GET /api/v1/sessions/:id/timeline`

Return recent normalized captures for the session.

### `POST /api/v1/sessions/:id/resolve`

Mark a session as resolved.

### `POST /api/v1/sessions/:id/pin`

Pin or unpin a session for demo mode.

## Automations

### `POST /api/v1/automations/stale-sessions`

Find stale sessions, run analysis when needed, and create pending notifications for workspaces with a notification webhook.

Body:

```json
{
  "idleMinutes": 60
}
```

### `POST /api/v1/notifications/mark-delivered`

Mark notification IDs as delivered after n8n dispatch succeeds.

## Model and Evaluation

### `GET /api/v1/analytics`

Returns benchmark runs, model stats, recent sessions, evaluation summary, and notification logs.

### `GET /api/v1/evaluations/summary`

Returns labeled-session summary, verdict counts, and confusion data.

### `GET /api/v1/benchmarks`

Returns stored benchmark runs.

### `POST /api/v1/benchmarks/run`

Runs a new benchmark over the seed dataset plus labeled feedback sessions.

### `POST /api/v1/model/train`

Trains and persists the model artifact to `MODEL_ARTIFACT_PATH`.

## Reports

### `GET /api/v1/reports/analytics?format=markdown|html|json`

Returns an exportable analytics report in markdown, HTML, or JSON.

### `GET /api/v1/reports/sessions.csv`

Returns session summary rows as CSV.

### `GET /api/v1/reports/presentation`

Returns presentation-ready JSON used by the automated PowerPoint generator.
