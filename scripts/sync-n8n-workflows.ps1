param(
  [string]$BaseUrl = $(if ($env:N8N_EDITOR_BASE_URL) { $env:N8N_EDITOR_BASE_URL } else { "http://localhost:5678" }),
  [string]$ApiKey = $env:N8N_API_KEY,
  [string]$BasicAuthUser = $env:N8N_BASIC_AUTH_USER,
  [string]$BasicAuthPassword = $env:N8N_BASIC_AUTH_PASSWORD,
  [string]$WorkflowDir = ".\n8n\workflows",
  [switch]$Activate
)

$ErrorActionPreference = "Stop"

function Get-Headers {
  $headers = @{
    "Content-Type" = "application/json"
    "Accept" = "application/json"
  }

  if ($ApiKey) {
    $headers["X-N8N-API-KEY"] = $ApiKey
  } elseif ($BasicAuthUser -and $BasicAuthPassword) {
    $pair = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${BasicAuthUser}:${BasicAuthPassword}"))
    $headers["Authorization"] = "Basic $pair"
  } else {
    throw "Provide N8N_API_KEY or N8N_BASIC_AUTH_USER/N8N_BASIC_AUTH_PASSWORD."
  }

  return $headers
}

function Invoke-N8n {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $params = @{
    Method = $Method
    Uri = "$BaseUrl$Path"
    Headers = Get-Headers
  }

  if ($Body -ne $null) {
    $params["Body"] = ($Body | ConvertTo-Json -Depth 50 -Compress)
  }

  Invoke-RestMethod @params
}

$workflowFiles = Get-ChildItem -Path $WorkflowDir -Filter *.json | Sort-Object Name
$remoteWorkflows = @{}

$page = Invoke-N8n -Method GET -Path "/api/v1/workflows?limit=200"
foreach ($workflow in ($page.data | Where-Object { $_.name })) {
  $remoteWorkflows[$workflow.name] = $workflow
}

$results = foreach ($file in $workflowFiles) {
  $workflow = Get-Content $file.FullName -Raw | ConvertFrom-Json
  $payload = @{
    name = $workflow.name
    nodes = $workflow.nodes
    connections = $workflow.connections
    settings = $workflow.settings
    tags = @($workflow.tags)
    active = [bool]($Activate -or $workflow.active)
  }

  if ($remoteWorkflows.ContainsKey($workflow.name)) {
    $existing = $remoteWorkflows[$workflow.name]
    $updated = Invoke-N8n -Method PUT -Path "/api/v1/workflows/$($existing.id)" -Body $payload
    [pscustomobject]@{
      Name = $workflow.name
      Action = "updated"
      Id = $updated.id
      Active = $updated.active
    }
  } else {
    $created = Invoke-N8n -Method POST -Path "/api/v1/workflows" -Body $payload
    [pscustomobject]@{
      Name = $workflow.name
      Action = "created"
      Id = $created.id
      Active = $created.active
    }
  }
}

$results | Format-Table -AutoSize
