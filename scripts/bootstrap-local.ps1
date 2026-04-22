param(
  [switch]$SkipDocker,
  [switch]$SkipModelTraining,
  [switch]$SyncWorkflows
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\.env")) {
  Copy-Item ".\.env.example" ".\.env"
  Write-Host "Created .env from .env.example"
}

if (-not $SkipModelTraining) {
  Write-Host "Training model artifact..."
  node .\scripts\train-model.mjs
}

if (-not $SkipDocker) {
  Write-Host "Starting backend and n8n..."
  docker compose up -d --build
}

if ($SyncWorkflows) {
  Write-Host "Syncing n8n workflows..."
  powershell -ExecutionPolicy Bypass -File ".\scripts\sync-n8n-workflows.ps1" -Activate
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Dashboard: http://localhost:3000"
Write-Host "n8n editor: http://localhost:5678"
Write-Host "If auth is enabled and no user exists, open http://localhost:3000/login.html to bootstrap the first admin account."
