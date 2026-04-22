param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [Parameter(Mandatory = $true)]
  [string]$WorkspacePath,

  [Parameter(Mandatory = $true)]
  [string]$IngestionUrl,

  [Parameter(Mandatory = $true)]
  [string]$SourceToken,

  [string]$NotesPath = "",
  [string]$UserLabel = "",
  [string]$IncludeExtensions = "",
  [string]$ExcludePatterns = "",
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
  [int]$IntervalMinutes = 15
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "capture-session.ps1"
$argumentParts = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$scriptPath`"",
  "-WorkspacePath", "`"$WorkspacePath`"",
  "-IngestionUrl", "`"$IngestionUrl`"",
  "-SourceToken", "`"$SourceToken`"",
  "-PathRedactionMode", "`"$PathRedactionMode`""
)

if ($NotesPath) {
  $argumentParts += @("-NotesPath", "`"$NotesPath`"")
}

if ($UserLabel) {
  $argumentParts += @("-UserLabel", "`"$UserLabel`"")
}

if ($IncludeExtensions) {
  $argumentParts += @("-IncludeExtensions", "`"$IncludeExtensions`"")
}

if ($ExcludePatterns) {
  $argumentParts += @("-ExcludePatterns", "`"$ExcludePatterns`"")
}

if ($MaskFileNames) {
  $argumentParts += "-MaskFileNames"
}

if ($PrivateMode) {
  $argumentParts += "-PrivateMode"
}

if ($LocalOnlyMode) {
  $argumentParts += "-LocalOnlyMode"
}

if ($SkipClipboard) {
  $argumentParts += "-SkipClipboard"
}

if ($SkipTerminalHistory) {
  $argumentParts += "-SkipTerminalHistory"
}

if ($SkipFileActivity) {
  $argumentParts += "-SkipFileActivity"
}

if ($SkipNotes) {
  $argumentParts += "-SkipNotes"
}

if ($SkipGitStatus) {
  $argumentParts += "-SkipGitStatus"
}

if ($SkipAppFocus) {
  $argumentParts += "-SkipAppFocus"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($argumentParts -join " ")
$startTime = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $startTime
$repetitionDuration = New-TimeSpan -Days 3650
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $startTime -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration $repetitionDuration).Repetition
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force -ErrorAction Stop | Out-Null
Write-Host "Scheduled collector task '$TaskName' registered."
