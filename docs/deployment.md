# Deployment Notes

## Local Single-Machine Setup

- Backend on port `3000`
- n8n on port `5678`
- SQLite database stored at `./data/intent-resurrection.db`

## Production-Friendly Considerations

- Put the backend behind a reverse proxy with TLS.
- Move notification destinations to a private webhook domain.
- Rotate source tokens if a collector machine changes hands.
- Restrict CORS if you deploy the dashboard on a separate origin.
- Move from SQLite to Postgres if you need multi-writer scale.

## n8n Workflow Expectations

- `intent-resurrection-engine.workflow.json` handles live collector intake
- `stale-session-monitor.workflow.json` handles stale-session dispatch
- Both workflows expect the backend API base URL to be reachable from n8n
