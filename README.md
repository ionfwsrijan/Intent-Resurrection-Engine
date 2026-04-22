# Intent Resurrection Engine

Intent Resurrection Engine is a real n8n-orchestrated product for recovering abandoned work from live digital traces.

This repository now contains:

- a persistent Node.js + SQLite backend
- a persisted trainable model artifact and offline benchmark path
- a full web dashboard for workspaces, sources, sessions, and analyses
- authentication and per-user workspace separation for multi-user local setups
- a Chrome-compatible browser extension for live tab capture
- Windows PowerShell collectors for workspace and shell traces
- n8n workflows for intake orchestration and stale-session notification dispatch
- bootstrap, workflow-sync, reporting, and deck-generation scripts

No sample payloads are required to use the system. Data comes from actual registered sources.

## Core Flow

1. Create a workspace in the dashboard.
2. Register one or more sources for that workspace.
3. Configure the browser extension or Windows collector with the generated source token and n8n intake webhook URL.
4. Sources send live snapshots to n8n.
5. n8n writes those snapshots to the backend and triggers an analysis run.
6. The dashboard shows sessions, predicted intent, evidence, and recovery guidance.
7. A second n8n workflow can dispatch stale-session notifications to each workspace's configured webhook.

## Architecture

- `frontend/`
  Browser dashboard served by the backend
- `server/`
  HTTP API, persistence, normalization, and intent analysis engine
- `collectors/browser-extension/`
  Chrome-compatible extension for open tab capture
- `collectors/windows/`
  PowerShell collector and task registration scripts
- `n8n/workflows/`
  Importable workflows for ingestion and stale-session automation
- `config/intents.json`
  Intent taxonomy, keyword signals, and recovery actions
- `docs/`
  API, deployment, architecture, and collector setup notes

## Quick Start

### 1. Configure environment

Copy `.env.example` to `.env`.

Optional one-command local bootstrap:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-local.ps1
```

### 2. Start the backend and n8n

```powershell
docker compose up -d --build
```

Services:

- Backend dashboard: [http://localhost:3000](http://localhost:3000)
- n8n editor: [http://localhost:5678](http://localhost:5678)

### 3. Import the n8n workflows

Import both files from [n8n/workflows](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/n8n/workflows>):

- [intent-resurrection-engine.workflow.json](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/n8n/workflows/intent-resurrection-engine.workflow.json>)
- [stale-session-monitor.workflow.json](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/n8n/workflows/stale-session-monitor.workflow.json>)

Activate them after import.

Optional repo-to-n8n sync if you have API credentials configured:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-n8n-workflows.ps1 -Activate
```

### 4. Create a workspace and source

Open the dashboard, create a workspace, then create a source for:

- `browser-extension`
- `windows-workspace-collector`
- `manual-api`

The source creation response shows a token and the intake URL to configure your collector.

If auth is enabled or a user already exists, open [http://localhost:3000/login.html](http://localhost:3000/login.html) first.

### 5. Configure collectors

- Browser extension setup: [docs/collectors.md](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/docs/collectors.md>)
- Windows collector setup: [collectors/windows](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/collectors/windows>)

## Local Development

Run the backend directly:

```powershell
node server/index.mjs
```

The backend serves the dashboard, so there is no separate frontend dev server.

## Validation

```powershell
npm run check
npm run smoke
npm run test
```

`npm run check` validates:

- JavaScript syntax across the app, collectors, and extension
- intent taxonomy JSON
- workflow JSON structure

`npm run smoke` starts a temporary in-memory instance, creates a workspace and source, ingests a real-shaped session payload, runs analysis, and validates the main API surface.

`npm run test` adds:

- frontend structural checks for auth, analytics export, and chip-based notification rules
- authenticated API checks for bootstrap, login, report export, and model training

## Training and Reports

Train the persisted model artifact:

```powershell
npm run train:model
```

Generate the PowerPoint deck from live API data:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-presentation.ps1
```

Analytics exports are also available from the UI and via API:

- `GET /api/v1/reports/analytics?format=markdown`
- `GET /api/v1/reports/sessions.csv`
- `GET /api/v1/reports/presentation`

## Important Endpoints

- `GET /api/health`
- `GET /api/v1/dashboard`
- `POST /api/v1/workspaces`
- `PUT /api/v1/workspaces/:id`
- `POST /api/v1/sources`
- `POST /api/v1/ingestion/session`
- `POST /api/v1/analysis/run`
- `POST /api/v1/model/train`
- `POST /api/v1/automations/stale-sessions`
- `POST /api/v1/notifications/mark-delivered`
- `GET /api/v1/reports/analytics`
- `GET /api/v1/reports/sessions.csv`
- `GET /api/v1/auth/state`
- `POST /api/v1/auth/bootstrap-admin`
- `POST /api/v1/auth/login`

Full details: [docs/api.md](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/docs/api.md>)

## Real Data Sources

The project is built to work with live inputs such as:

- currently open browser tabs
- clipboard text
- recent PowerShell history
- recent file activity in a workspace
- git branch and status state
- draft note files
- focus, pause, and idle metadata from the collector

## Privacy Model

- Source tokens are stored hashed in SQLite.
- Sensitive text is redacted before analysis storage.
- Workspace notification webhooks are opt-in per workspace.
- Collectors can store local snapshots before upload if you want auditability.

Privacy notes: [docs/architecture.md](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/docs/architecture.md>)

## Files To Start With

- [server/index.mjs](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/server/index.mjs>)
- [server/app.mjs](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/server/app.mjs>)
- [server/services/analysis-engine.mjs](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/server/services/analysis-engine.mjs>)
- [frontend/index.html](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/frontend/index.html>)
- [collectors/browser-extension/manifest.json](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/collectors/browser-extension/manifest.json>)
- [collectors/windows/capture-session.ps1](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/collectors/windows/capture-session.ps1>)
- [n8n/workflows/intent-resurrection-engine.workflow.json](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/n8n/workflows/intent-resurrection-engine.workflow.json>)
