param(
  [Parameter(Mandatory = $true)]
  [string]$IngestionUrl,

  [Parameter(Mandatory = $true)]
  [string]$SourceToken,

  [Parameter(Mandatory = $true)]
  [string]$WorkspacePath,

  [string]$NotesPath = "",
  [string]$SessionId = "",
  [string]$UserLabel = "",
  [string]$OutputPath = "",
  [string]$IncludeExtensions = "",
  [string]$ExcludePatterns = ".git,node_modules,__pycache__,*.db,*.db-wal,*.db-shm,*.log,.env,.env.*,package-lock.json,pnpm-lock.yaml,yarn.lock",
  [ValidateSet("none", "workspace", "full")]
  [string]$PathRedactionMode = "workspace",
  [switch]$MaskFileNames,
  [switch]$PrivateMode,
  [switch]$LocalOnlyMode,
  [switch]$SkipClipboard,
  [switch]$SkipTerminalHistory,
  [switch]$SkipFileActivity,
  [switch]$SkipNotes,
  [switch]$SkipGitStatus,
  [switch]$SkipAppFocus,
  [switch]$PreviewBeforeSend,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-StableSessionId {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue
  )

  $normalizedPath = $PathValue
  try {
    $normalizedPath = [System.IO.Path]::GetFullPath($PathValue)
  } catch {
    $normalizedPath = $PathValue
  }

  $leaf = Split-Path $normalizedPath -Leaf
  if (-not $leaf) {
    $leaf = "workspace"
  }

  $safeLeaf = ($leaf.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
  if (-not $safeLeaf) {
    $safeLeaf = "workspace"
  }

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalizedPath.ToLowerInvariant())
  $hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  $hash = (-join ($hashBytes | ForEach-Object { $_.ToString("x2") })).Substring(0, 12)

  return "workspace-$safeLeaf-$hash"
}

function Get-NormalizedWorkspaceRoot {
  try {
    return [System.IO.Path]::GetFullPath($WorkspacePath)
  } catch {
    return $WorkspacePath
  }
}

function Get-ConfiguredExtensions {
  if (-not $IncludeExtensions.Trim()) {
    return @()
  }

  return $IncludeExtensions.Split(",") |
    ForEach-Object { $_.Trim().TrimStart(".").ToLowerInvariant() } |
    Where-Object { $_ }
}

function Get-ConfiguredPatterns {
  if (-not $ExcludePatterns.Trim()) {
    return @()
  }

  return $ExcludePatterns.Split(",") |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }
}

function Test-PatternMatch {
  param(
    [string]$PathValue,
    [string]$LeafName,
    [string[]]$Patterns
  )

  foreach ($pattern in $Patterns) {
    if ($PathValue -like "*$pattern*" -or $LeafName -like $pattern) {
      return $true
    }
  }

  return $false
}

function Convert-PathForPayload {
  param(
    [string]$PathValue
  )

  if (-not $PathValue) {
    return ""
  }

  $normalizedRoot = Get-NormalizedWorkspaceRoot
  $normalizedPath = $PathValue
  try {
    $normalizedPath = [System.IO.Path]::GetFullPath($PathValue)
  } catch {
    $normalizedPath = $PathValue
  }

  $leafName = Split-Path $normalizedPath -Leaf
  $extension = [System.IO.Path]::GetExtension($leafName)
  if ($MaskFileNames) {
    $leafName = if ($extension) { "[FILE]$extension" } else { "[FILE]" }
  }

  if ($PathRedactionMode -eq "full" -or $PrivateMode) {
    return if ($MaskFileNames) { "[PATH]\\$leafName" } else { "[PATH]" }
  }

  if ($PathRedactionMode -eq "workspace" -and $normalizedRoot) {
    $relativePath = $normalizedPath
    if ($normalizedPath.ToLowerInvariant().StartsWith($normalizedRoot.ToLowerInvariant())) {
      $relativePath = $normalizedPath.Substring($normalizedRoot.Length).TrimStart("\")
    }

    if (-not $relativePath) {
      return "[WORKSPACE]"
    }

    if ($MaskFileNames) {
      $parent = Split-Path $relativePath -Parent
      return if ($parent) { "[WORKSPACE]\\$parent\\$leafName" } else { "[WORKSPACE]\\$leafName" }
    }

    return "[WORKSPACE]\\$relativePath"
  }

  return $normalizedPath
}

function Get-ContextRootPath {
  if ($PrivateMode -or $PathRedactionMode -eq "full") {
    return "[PATH]"
  }

  if ($PathRedactionMode -eq "workspace") {
    return "[WORKSPACE]"
  }

  return $WorkspacePath
}

function Get-RecentHistory {
  if ($SkipTerminalHistory -or $PrivateMode -or $LocalOnlyMode) {
    return @()
  }

  $historyPath = $null
  try {
    $historyPath = (Get-PSReadLineOption).HistorySavePath
  } catch {
    return @()
  }

  if (-not $historyPath -or -not (Test-Path $historyPath)) {
    return @()
  }

  $lowSignalPatterns = @(
    '^cd(?:\s|$)',
    '^dir(?:\s|$)',
    '^ls(?:\s|$)',
    '^pwd$',
    '^clear$',
    '^cls$',
    '^npm run (dev|check|smoke)\b',
    '^docker compose up\b',
    '^docker compose ps\b',
    '^Get-ScheduledTask\b',
    '^Get-ScheduledTaskInfo\b',
    '^Start-ScheduledTask\b'
  )

  return Get-Content -Path $historyPath -Tail 35 |
    Where-Object { $_.Trim() } |
    ForEach-Object { $_.Trim() } |
    Where-Object {
      $command = $_
      -not ($lowSignalPatterns | Where-Object { $command -match $_ })
    } |
    Select-Object -First 20 |
    ForEach-Object {
      @{ command = $_ }
    }
}

function Get-RecentFiles {
  if ($SkipFileActivity -or -not (Test-Path $WorkspacePath)) {
    return @()
  }

  $extensions = Get-ConfiguredExtensions
  $patterns = Get-ConfiguredPatterns

  return Get-ChildItem -Path $WorkspacePath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      $fullPath = $_.FullName
      $leafName = $_.Name
      $extension = $_.Extension.TrimStart(".").ToLowerInvariant()
      $matchesExtension = ($extensions.Count -eq 0) -or ($extensions -contains $extension)
      $isExcluded = Test-PatternMatch -PathValue $fullPath -LeafName $leafName -Patterns $patterns
      $matchesExtension -and -not $isExcluded
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First ($(if ($PrivateMode) { 12 } else { 20 })) |
    ForEach-Object {
      @{
        path = Convert-PathForPayload -PathValue $_.FullName
        status = "modified"
        modifiedAt = $_.LastWriteTime.ToString("o")
        size = $_.Length
      }
    }
}

function Get-GitStatus {
  if ($PrivateMode -or $SkipGitStatus -or $LocalOnlyMode) {
    return @{
      branch = ""
      status = @()
    }
  }

  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) {
    return @{
      branch = ""
      status = @()
    }
  }

  try {
    $branch = git -C $WorkspacePath rev-parse --abbrev-ref HEAD 2>$null
    $statusLines = git -C $WorkspacePath status --short 2>$null
  } catch {
    return @{
      branch = ""
      status = @()
    }
  }

  return @{
    branch = ($branch | Select-Object -First 1)
    status = @($statusLines | ForEach-Object {
      if ($_.Length -ge 4) {
        @{
          status = $_.Substring(0, 2).Trim()
          path = Convert-PathForPayload -PathValue $_.Substring(3).Trim()
        }
      }
    } | Where-Object { $_ })
  }
}

function Get-Notes {
  if ($SkipNotes -or -not $NotesPath -or -not (Test-Path $NotesPath) -or $PrivateMode) {
    return @()
  }

  return Get-Content -Path $NotesPath -Tail 20 |
    Where-Object { $_.Trim() } |
    ForEach-Object {
      @{ text = $_.Trim() }
    }
}

function Get-AppFocus {
  if ($SkipAppFocus) {
    return @()
  }

  if (-not ("IntentResurrectionWindowFocus" -as [type])) {
    Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class IntentResurrectionWindowFocus {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
  }

  try {
    $windowHandle = [IntentResurrectionWindowFocus]::GetForegroundWindow()
    if ($windowHandle -eq [System.IntPtr]::Zero) {
      return @()
    }

    $length = [IntentResurrectionWindowFocus]::GetWindowTextLength($windowHandle)
    $buffer = New-Object System.Text.StringBuilder ($length + 1)
    [void][IntentResurrectionWindowFocus]::GetWindowText($windowHandle, $buffer, $buffer.Capacity)

    $processId = 0
    [void][IntentResurrectionWindowFocus]::GetWindowThreadProcessId($windowHandle, [ref]$processId)
    $processName = ""
    if ($processId) {
      try {
        $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
      } catch {
        $processName = ""
      }
    }

    $windowTitle = $buffer.ToString().Trim()
    if ($windowTitle.Length -gt 240) {
      $windowTitle = $windowTitle.Substring(0, 240)
    }

    return @(@{
      app = $processName
      windowTitle = $(if ($PrivateMode -or $LocalOnlyMode) { "" } else { $windowTitle })
      active = $true
      observedAt = (Get-Date).ToString("o")
    })
  } catch {
    return @()
  }
}

function Get-ActivityTimeline {
  param(
    [array]$RecentFiles,
    [array]$RecentAppFocus
  )

  $timeline = @()

  foreach ($entry in ($RecentFiles | Select-Object -First 8)) {
    $timeline += @{
      kind = "file-change"
      label = $entry.path
      host = ""
      observedAt = $entry.modifiedAt
    }
  }

  foreach ($entry in ($RecentAppFocus | Select-Object -First 2)) {
    $timeline += @{
      kind = "app-focus"
      label = $entry.app
      host = ""
      observedAt = $entry.observedAt
    }
  }

  return $timeline |
    Sort-Object observedAt -Descending |
    Select-Object -First 10
}

function Convert-ToLocalOnlyPayload {
  param(
    [hashtable]$Payload
  )

  $extensionSummary = $Payload.traces.fileActivity |
    ForEach-Object {
      $extension = [System.IO.Path]::GetExtension([string]$_.path).TrimStart(".").ToLowerInvariant()
      if ($extension) { $extension } else { "unknown" }
    } |
    Group-Object |
    Sort-Object Count -Descending |
    Select-Object -First 5 |
    ForEach-Object { "$($_.Name) ($($_.Count))" }

  $summaryNotes = @()
  if ($extensionSummary.Count -gt 0) {
    $summaryNotes += @{ text = "Local-only summary: recent file types -> $($extensionSummary -join ', ')." }
  }
  if ($Payload.traces.appFocus.Count -gt 0 -and $Payload.traces.appFocus[0].app) {
    $summaryNotes += @{ text = "Local-only summary: active application -> $($Payload.traces.appFocus[0].app)." }
  }
  if ($Payload.traces.terminalHistory.Count -gt 0) {
    $summaryNotes += @{ text = "Local-only summary: terminal activity captured locally but commands were not uploaded verbatim." }
  }
  if ($Payload.traces.clipboardFragments.Count -gt 0) {
    $summaryNotes += @{ text = "Local-only summary: clipboard content was used locally and omitted from the uploaded payload." }
  }

  $Payload.context.rootPath = "[LOCAL_ONLY]"
  $Payload.context.hostname = ""
  $Payload.context.userLabel = ""
  $Payload.traces = [ordered]@{
    browserTabs = @()
    browserClusters = @()
    fileActivity = @()
    clipboardFragments = @()
    terminalHistory = @()
    draftNotes = @($Payload.traces.draftNotes + $summaryNotes)
    gitStatus = @()
    appFocus = @($Payload.traces.appFocus | ForEach-Object {
      @{
        app = $_.app
        windowTitle = ""
        active = $_.active
        observedAt = $_.observedAt
      }
    })
    activityTimeline = @($Payload.traces.activityTimeline | ForEach-Object {
      @{
        kind = $_.kind
        label = ""
        host = ""
        observedAt = $_.observedAt
      }
    })
  }

  return $Payload
}

$clipboardText = ""
if (-not $SkipClipboard -and -not $PrivateMode -and -not $LocalOnlyMode) {
  try {
    $clipboardText = Get-Clipboard -Raw -ErrorAction Stop
  } catch {
    $clipboardText = ""
  }
}

$gitInfo = Get-GitStatus
$workspaceLeaf = Split-Path (Get-NormalizedWorkspaceRoot) -Leaf
$sessionIdValue = if ($SessionId) { $SessionId } else { Get-StableSessionId -PathValue $WorkspacePath }
$recentFiles = Get-RecentFiles
$recentAppFocus = Get-AppFocus
$activityTimeline = Get-ActivityTimeline -RecentFiles $recentFiles -RecentAppFocus $recentAppFocus

$payload = [ordered]@{
  sessionId = $sessionIdValue
  title = "Workspace capture for $workspaceLeaf"
  sourceType = "windows-workspace-collector"
  channel = "windows-workspace-collector"
  occurredAt = (Get-Date).ToString("o")
  context = [ordered]@{
    rootPath = Get-ContextRootPath
    branch = $gitInfo.branch
    hostname = $(if ($PrivateMode) { "" } else { $env:COMPUTERNAME })
    userLabel = $(if ($PrivateMode) { "" } else { $UserLabel })
    platform = "windows"
    sourceLabel = "Windows Workspace Collector"
  }
  metrics = [ordered]@{
    interruptionCount = 0
    pauseRatio = 0
    typingBurstScore = 0
    focusSwitchCount = 0
    idleMinutes = 0
  }
  traces = [ordered]@{
    browserTabs = @()
    browserClusters = @()
    fileActivity = $recentFiles
    clipboardFragments = @()
    terminalHistory = Get-RecentHistory
    draftNotes = Get-Notes
    gitStatus = $gitInfo.status
    appFocus = $recentAppFocus
    activityTimeline = $activityTimeline
  }
}

if ($clipboardText) {
  $payload.traces.clipboardFragments = @(@{ text = $clipboardText.Substring(0, [Math]::Min($clipboardText.Length, 600)) })
}

if ($LocalOnlyMode) {
  $payload = Convert-ToLocalOnlyPayload -Payload $payload
}

$json = $payload | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $directory = Split-Path -Parent $OutputPath
  if ($directory) {
    New-Item -Path $directory -ItemType Directory -Force | Out-Null
  }
  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

if ($DryRun) {
  $json
  exit 0
}

if ($PreviewBeforeSend) {
  Write-Host $json
  $confirmation = Read-Host "Send this payload? (y/N)"
  if ($confirmation -notmatch "^(y|yes)$") {
    Write-Host "Capture canceled."
    exit 0
  }
}

$headers = @{
  "Content-Type" = "application/json"
  "X-Source-Token" = $SourceToken
}

Invoke-RestMethod -Method Post -Uri $IngestionUrl -Headers $headers -Body $json
