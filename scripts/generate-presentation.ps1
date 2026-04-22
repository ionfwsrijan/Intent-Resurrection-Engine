param(
  [string]$OutputPath = ".\outputs\intent-resurrection-engine-pitch.pptx",
  [string]$ApiBaseUrl = "http://localhost:3000",
  [string]$AuthToken = ""
)

$ErrorActionPreference = "Stop"

function Get-ApiJson {
  param([string]$Path)
  $headers = @{}
  if ($AuthToken) {
    $headers["Authorization"] = "Bearer $AuthToken"
  }

  try {
    return Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl$Path" -Headers $headers
  } catch {
    return $null
  }
}

function Add-TextBox {
  param(
    $Slide,
    [string]$Text,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [int]$FontSize = 20,
    [string]$FontName = "Aptos",
    [string]$Color = "#221B13",
    [switch]$Bold,
    [switch]$PassThru
  )

  $shape = $Slide.Shapes.AddTextbox(1, $Left, $Top, $Width, $Height)
  $shape.TextFrame.TextRange.Text = $Text
  $shape.TextFrame.TextRange.Font.Name = $FontName
  $shape.TextFrame.TextRange.Font.Size = $FontSize
  $shape.TextFrame.TextRange.Font.Color.RGB = [int]("0x" + $Color.TrimStart("#"))
  $shape.TextFrame.WordWrap = -1
  if ($Bold) {
    $shape.TextFrame.TextRange.Font.Bold = -1
  }
  if ($PassThru) {
    return $shape
  }
}

function Add-Bullets {
  param(
    $Slide,
    [string[]]$Items,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [switch]$PassThru
  )

  $shape = Add-TextBox -Slide $Slide -Text ($Items -join "`r") -Left $Left -Top $Top -Width $Width -Height $Height -FontSize 20 -PassThru
  for ($index = 1; $index -le $shape.TextFrame.TextRange.Paragraphs().Count; $index += 1) {
    $paragraph = $shape.TextFrame.TextRange.Paragraphs($index)
    $paragraph.ParagraphFormat.Bullet.Visible = -1
  }
  if ($PassThru) {
    return $shape
  }
}

function Add-Card {
  param(
    $Slide,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [string]$FillColor = "#FFFFFF",
    [string]$LineColor = "#E4D7C9",
    [double]$Transparency = 0.02,
    [switch]$PassThru
  )

  $shape = $Slide.Shapes.AddShape(1, $Left, $Top, $Width, $Height)
  $shape.Fill.ForeColor.RGB = [int]("0x" + $FillColor.TrimStart("#"))
  $shape.Fill.Transparency = $Transparency
  $shape.Line.ForeColor.RGB = [int]("0x" + $LineColor.TrimStart("#"))
  if ($PassThru) {
    return $shape
  }
}

function Add-TitleBlock {
  param(
    $Slide,
    [string]$Eyebrow,
    [string]$Title,
    [string]$Subtitle = ""
  )

  Add-TextBox -Slide $Slide -Text $Eyebrow -Left 54 -Top 28 -Width 420 -Height 24 -FontSize 12 -FontName "Aptos" -Color "#154EF5" -Bold
  Add-TextBox -Slide $Slide -Text $Title -Left 52 -Top 48 -Width 860 -Height 52 -FontSize 28 -FontName "Aptos Display" -Color "#221B13" -Bold
  if ($Subtitle) {
    Add-TextBox -Slide $Slide -Text $Subtitle -Left 54 -Top 96 -Width 960 -Height 42 -FontSize 16 -FontName "Aptos" -Color "#65594D"
  }
}

function Add-MetricCard {
  param(
    $Slide,
    [string]$Label,
    [string]$Value,
    [double]$Left,
    [double]$Top
  )

  Add-Card -Slide $Slide -Left $Left -Top $Top -Width 182 -Height 92 -FillColor "#FFF9F3"
  Add-TextBox -Slide $Slide -Text $Label -Left ($Left + 18) -Top ($Top + 16) -Width 148 -Height 20 -FontSize 12 -Color "#65594D" -Bold
  Add-TextBox -Slide $Slide -Text $Value -Left ($Left + 18) -Top ($Top + 36) -Width 148 -Height 32 -FontSize 24 -FontName "Aptos Display" -Color "#154EF5" -Bold
}

function Add-FeatureSessionCard {
  param(
    $Slide,
    [object]$Session,
    [double]$Left,
    [double]$Top,
    [double]$Width
  )

  Add-Card -Slide $Slide -Left $Left -Top $Top -Width $Width -Height 128 -FillColor "#FFFFFF"
  Add-TextBox -Slide $Slide -Text $Session.title -Left ($Left + 16) -Top ($Top + 14) -Width ($Width - 32) -Height 22 -FontSize 16 -Bold
  Add-TextBox -Slide $Slide -Text "$($Session.channel) · $($Session.predictedIntent.label)" -Left ($Left + 16) -Top ($Top + 38) -Width ($Width - 32) -Height 18 -FontSize 12 -Color "#65594D"
  Add-Bullets -Slide $Slide -Items @($Session.evidence | Select-Object -First 2) -Left ($Left + 18) -Top ($Top + 60) -Width ($Width - 36) -Height 54
}

function Add-SimpleTable {
  param(
    $Slide,
    [string[]]$Headers,
    [object[][]]$Rows,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height
  )

  $tableShape = $Slide.Shapes.AddTable($Rows.Count + 1, $Headers.Count, $Left, $Top, $Width, $Height)
  $table = $tableShape.Table

  for ($column = 1; $column -le $Headers.Count; $column += 1) {
    $table.Cell(1, $column).Shape.TextFrame.TextRange.Text = $Headers[$column - 1]
    $table.Cell(1, $column).Shape.Fill.ForeColor.RGB = 0xEEDFCF
  }

  for ($row = 0; $row -lt $Rows.Count; $row += 1) {
    for ($column = 0; $column -lt $Headers.Count; $column += 1) {
      $table.Cell($row + 2, $column + 1).Shape.TextFrame.TextRange.Text = [string]$Rows[$row][$column]
    }
  }
}

$presentationData = Get-ApiJson -Path "/api/v1/reports/presentation"
if (-not $presentationData) {
  $dashboard = Get-ApiJson -Path "/api/v1/dashboard"
  $analytics = Get-ApiJson -Path "/api/v1/analytics"
  $presentationData = @{
    generatedAt = (Get-Date).ToString("o")
    modelVersion = $analytics.modelVersion
    metrics = $dashboard.metrics
    modelStats = $analytics.modelStats
    latestBenchmark = $analytics.latestBenchmark
    featuredSessions = @($dashboard.recentSessions | Select-Object -First 4)
    evaluationSummary = $analytics.evaluationSummary
    notificationLogs = @($analytics.notificationLogs | Select-Object -First 6)
  }
}

$metrics = if ($presentationData.metrics) { $presentationData.metrics } else { @{ workspaces = 0; sources = 0; activeSessions = 0; pinnedSessions = 0; labeledSessions = 0 } }
$latestBenchmark = $presentationData.latestBenchmark
$hybridBenchmark = if ($latestBenchmark -and $latestBenchmark.results -and $latestBenchmark.results.runs) {
  $latestBenchmark.results.runs | Where-Object { $_.strategy -like "hybrid*" } | Select-Object -First 1
}
if (-not $hybridBenchmark) {
  $hybridBenchmark = @{
    strategy = $presentationData.modelVersion
    top1Accuracy = 0
    top3Accuracy = 0
    averageConfidence = 0
  }
}

$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $outputFullPath
if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$ppt = $null
$presentation = $null

try {
  $ppt = New-Object -ComObject PowerPoint.Application
  $ppt.Visible = -1
  $presentation = $ppt.Presentations.Add()
  $presentation.PageSetup.SlideSize = 16

  $slides = $presentation.Slides

  $slide1 = $slides.Add(1, 12)
  $slide1.FollowMasterBackground = 0
  $slide1.Background.Fill.ForeColor.RGB = 0xF7F1E8
  Add-TextBox -Slide $slide1 -Text "Intent Resurrection Engine" -Left 56 -Top 74 -Width 760 -Height 70 -FontSize 32 -FontName "Aptos Display" -Color "#221B13" -Bold
  Add-TextBox -Slide $slide1 -Text "Reconstructing abandoned user intent from live digital traces" -Left 58 -Top 144 -Width 780 -Height 40 -FontSize 19 -Color "#65594D"
  Add-Card -Slide $slide1 -Left 54 -Top 222 -Width 526 -Height 150 -FillColor "#FFFFFF"
  Add-TextBox -Slide $slide1 -Text "Current systems remember actions. This system reconstructs purpose." -Left 76 -Top 254 -Width 480 -Height 80 -FontSize 24 -FontName "Aptos Display" -Color "#154EF5" -Bold
  Add-Card -Slide $slide1 -Left 624 -Top 220 -Width 578 -Height 152 -FillColor "#154EF5" -LineColor "#154EF5"
  Add-TextBox -Slide $slide1 -Text "Collectors -> n8n -> backend -> analysis -> recovery guidance" -Left 654 -Top 252 -Width 514 -Height 48 -FontSize 22 -Color "#FFFFFF" -Bold
  Add-TextBox -Slide $slide1 -Text "Now with persisted model artifacts, auth-aware workspaces, analytics export, and automated deck/report generation." -Left 654 -Top 306 -Width 514 -Height 34 -FontSize 15 -Color "#E8EFFF"

  $slide2 = $slides.Add(2, 12)
  $slide2.Background.Fill.ForeColor.RGB = 0xFCF6EF
  Add-TitleBlock -Slide $slide2 -Eyebrow "Problem" -Title "Users lose intent, not just files or tabs"
  Add-Card -Slide $slide2 -Left 56 -Top 148 -Width 548 -Height 420
  Add-Bullets -Slide $slide2 -Items @(
    "Interruptions, context switching, and fatigue break continuity.",
    "When users return, they cannot quickly reconstruct why they were working.",
    "History tools show residue, not purpose or the next best action.",
    "This system rebuilds likely intent and suggests how to resume work."
  ) -Left 78 -Top 184 -Width 500 -Height 320
  Add-Card -Slide $slide2 -Left 642 -Top 148 -Width 518 -Height 420 -FillColor "#154EF5" -LineColor "#154EF5"
  Add-TextBox -Slide $slide2 -Text "Human impact" -Left 672 -Top 180 -Width 180 -Height 24 -FontSize 13 -Color "#D8E5FF" -Bold
  Add-Bullets -Slide $slide2 -Items @(
    "Resume work faster after interruptions",
    "Reduce memory burden",
    "Support ADHD-friendly workflows",
    "Turn messy traces into recovery guidance"
  ) -Left 670 -Top 220 -Width 434 -Height 250 | Out-Null
  $slide2.Shapes.Range().Item($slide2.Shapes.Count).TextFrame.TextRange.Font.Color.RGB = 0xFFFFFF

  $slide3 = $slides.Add(3, 12)
  $slide3.Background.Fill.ForeColor.RGB = 0xF7F1E8
  Add-TitleBlock -Slide $slide3 -Eyebrow "Architecture" -Title "Operational workflow from live traces to recovery plan"
  Add-Card -Slide $slide3 -Left 54 -Top 200 -Width 210 -Height 96 -FillColor "#EAF0FF"
  Add-Card -Slide $slide3 -Left 286 -Top 200 -Width 210 -Height 96 -FillColor "#FFF0E1"
  Add-Card -Slide $slide3 -Left 518 -Top 200 -Width 210 -Height 96 -FillColor "#EAFBF6"
  Add-Card -Slide $slide3 -Left 750 -Top 200 -Width 210 -Height 96 -FillColor "#F6EEFF"
  Add-Card -Slide $slide3 -Left 982 -Top 200 -Width 178 -Height 96 -FillColor "#FFF9E8"
  Add-TextBox -Slide $slide3 -Text "Collectors" -Left 72 -Top 220 -Width 170 -Height 26 -FontSize 17 -Bold
  Add-TextBox -Slide $slide3 -Text "n8n workflows" -Left 304 -Top 220 -Width 170 -Height 26 -FontSize 17 -Bold
  Add-TextBox -Slide $slide3 -Text "Backend + model" -Left 536 -Top 220 -Width 170 -Height 26 -FontSize 17 -Bold
  Add-TextBox -Slide $slide3 -Text "Dashboard + analytics" -Left 768 -Top 220 -Width 170 -Height 26 -FontSize 17 -Bold
  Add-TextBox -Slide $slide3 -Text "Notifications" -Left 1000 -Top 220 -Width 140 -Height 26 -FontSize 17 -Bold
  foreach ($left in @(250, 482, 714, 946)) {
    $arrow = $slide3.Shapes.AddShape(33, $left, 236, 28, 20)
    $arrow.Fill.ForeColor.RGB = 0x154EF5
    $arrow.Line.Visible = 0
  }
  Add-TextBox -Slide $slide3 -Text "Recent improvements: trainable artifact flow, auth-aware workspaces, benchmark runs, temporal history, exportable reports, and deck automation." -Left 58 -Top 360 -Width 1100 -Height 54 -FontSize 18 -Color "#65594D"

  $slide4 = $slides.Add(4, 12)
  $slide4.Background.Fill.ForeColor.RGB = 0xFCF6EF
  Add-TitleBlock -Slide $slide4 -Eyebrow "Live Metrics" -Title "Current project state and model improvements"
  Add-MetricCard -Slide $slide4 -Label "Workspaces" -Value ([string]($metrics.workspaces)) -Left 56 -Top 152
  Add-MetricCard -Slide $slide4 -Label "Sources" -Value ([string]($metrics.sources)) -Left 252 -Top 152
  Add-MetricCard -Slide $slide4 -Label "Active sessions" -Value ([string]($metrics.activeSessions)) -Left 448 -Top 152
  Add-MetricCard -Slide $slide4 -Label "Pinned sessions" -Value ([string]($metrics.pinnedSessions)) -Left 644 -Top 152
  Add-MetricCard -Slide $slide4 -Label "Model version" -Value ($presentationData.modelVersion) -Left 840 -Top 152
  Add-MetricCard -Slide $slide4 -Label "Labeled sessions" -Value ([string]($metrics.labeledSessions)) -Left 1036 -Top 152
  Add-Card -Slide $slide4 -Left 56 -Top 286 -Width 540 -Height 280
  Add-Bullets -Slide $slide4 -Items @(
    "Hybrid scoring now combines rules, prototype similarity, semantic similarity, and a persisted trainable artifact.",
    "Temporal continuity from recent capture history is folded into intent ranking.",
    "Confidence is calibrated and weak sessions are flagged as uncertain instead of overclaiming."
  ) -Left 76 -Top 320 -Width 500 -Height 220
  Add-Card -Slide $slide4 -Left 626 -Top 286 -Width 534 -Height 280 -FillColor "#154EF5" -LineColor "#154EF5"
  Add-TextBox -Slide $slide4 -Text "Latest benchmark" -Left 654 -Top 318 -Width 180 -Height 22 -FontSize 12 -Color "#D8E5FF" -Bold
  Add-Bullets -Slide $slide4 -Items @(
    "Strategy: $($hybridBenchmark.strategy)",
    "Top-1 accuracy: $([math]::Round(($hybridBenchmark.top1Accuracy) * 100))%",
    "Top-3 accuracy: $([math]::Round(($hybridBenchmark.top3Accuracy) * 100))%",
    "Average confidence: $([math]::Round(($hybridBenchmark.averageConfidence) * 100))%"
  ) -Left 654 -Top 352 -Width 454 -Height 180 | Out-Null
  $slide4.Shapes.Range().Item($slide4.Shapes.Count).TextFrame.TextRange.Font.Color.RGB = 0xFFFFFF

  $slide5 = $slides.Add(5, 12)
  $slide5.Background.Fill.ForeColor.RGB = 0xF7F1E8
  Add-TitleBlock -Slide $slide5 -Eyebrow "Featured Sessions" -Title "Curated examples from the live system"
  $featured = @($presentationData.featuredSessions)
  while ($featured.Count -lt 4) {
    $featured += @{
      title = "No session available"
      channel = "n/a"
      predictedIntent = @{ label = "No prediction" }
      evidence = @("Capture more sessions to populate this slot.")
    }
  }
  Add-FeatureSessionCard -Slide $slide5 -Session $featured[0] -Left 56 -Top 156 -Width 520
  Add-FeatureSessionCard -Slide $slide5 -Session $featured[1] -Left 612 -Top 156 -Width 520
  Add-FeatureSessionCard -Slide $slide5 -Session $featured[2] -Left 56 -Top 314 -Width 520
  Add-FeatureSessionCard -Slide $slide5 -Session $featured[3] -Left 612 -Top 314 -Width 520

  $slide6 = $slides.Add(6, 12)
  $slide6.Background.Fill.ForeColor.RGB = 0xFCF6EF
  Add-TitleBlock -Slide $slide6 -Eyebrow "Operations" -Title "Notification rules, ownership, and delivery visibility"
  Add-Card -Slide $slide6 -Left 56 -Top 152 -Width 430 -Height 370
  Add-Bullets -Slide $slide6 -Items @(
    "Workspace-specific quiet hours and minimum idle thresholds",
    "Intent-specific alert filters using clickable UI chips",
    "Per-user workspace ownership with token-based login",
    "One-click bootstrap and n8n workflow sync scripts"
  ) -Left 78 -Top 188 -Width 392 -Height 280
  Add-Card -Slide $slide6 -Left 520 -Top 152 -Width 642 -Height 370
  $notificationRows = @($presentationData.notificationLogs | Select-Object -First 5 | ForEach-Object {
    @(
      ($_.workspaceName),
      ($_.sessionTitle),
      ($_.status),
      ($_.attemptCount)
    )
  })
  if (-not $notificationRows -or $notificationRows.Count -eq 0) {
    $notificationRows = @(@("No logs yet", "", "", ""))
  }
  Add-SimpleTable -Slide $slide6 -Headers @("Workspace", "Session", "Status", "Attempts") -Rows $notificationRows -Left 540 -Top 186 -Width 584 -Height 250
  Add-TextBox -Slide $slide6 -Text "Notification delivery logs are now exportable and auditable from the analytics page." -Left 540 -Top 454 -Width 560 -Height 40 -FontSize 16 -Color "#65594D"

  $slide7 = $slides.Add(7, 12)
  $slide7.Background.Fill.ForeColor.RGB = 0xF7F1E8
  Add-TitleBlock -Slide $slide7 -Eyebrow "Evaluation" -Title "Trainable artifact and exportable analytics"
  Add-Card -Slide $slide7 -Left 56 -Top 152 -Width 550 -Height 360
  Add-Bullets -Slide $slide7 -Items @(
    "Seed dataset expanded and split into train, validation, and test partitions",
    "Persisted model artifact stored under data/model-artifact.json",
    "New train-model route and local training script refresh the artifact",
    "Analytics can export markdown reports and CSV session summaries"
  ) -Left 78 -Top 186 -Width 506 -Height 260
  Add-Card -Slide $slide7 -Left 638 -Top 152 -Width 522 -Height 360 -FillColor "#154EF5" -LineColor "#154EF5"
  Add-TextBox -Slide $slide7 -Text "Artifact snapshot" -Left 668 -Top 184 -Width 180 -Height 22 -FontSize 12 -Color "#D8E5FF" -Bold
  Add-Bullets -Slide $slide7 -Items @(
    "Vocabulary size: $($presentationData.modelStats.artifact.vocabularySize)",
    "Train split: $($presentationData.modelStats.artifact.splitSummary.train)",
    "Validation split: $($presentationData.modelStats.artifact.splitSummary.validation)",
    "Test split: $($presentationData.modelStats.artifact.splitSummary.test)"
  ) -Left 668 -Top 220 -Width 430 -Height 220 | Out-Null
  $slide7.Shapes.Range().Item($slide7.Shapes.Count).TextFrame.TextRange.Font.Color.RGB = 0xFFFFFF

  $slide8 = $slides.Add(8, 12)
  $slide8.Background.Fill.ForeColor.RGB = 0xFCF6EF
  Add-TitleBlock -Slide $slide8 -Eyebrow "Impact" -Title "From activity history to intent recovery"
  Add-Card -Slide $slide8 -Left 56 -Top 164 -Width 522 -Height 350
  Add-Bullets -Slide $slide8 -Items @(
    "Interrupted-work recovery for developers, researchers, and knowledge workers",
    "ADHD-friendly context restoration",
    "Enterprise workflow memory and follow-up automation",
    "Explainable intent recovery instead of opaque assistant guesses"
  ) -Left 78 -Top 198 -Width 480 -Height 250
  Add-Card -Slide $slide8 -Left 620 -Top 164 -Width 542 -Height 350 -FillColor "#154EF5" -LineColor "#154EF5"
  Add-TextBox -Slide $slide8 -Text "What is now automated" -Left 652 -Top 198 -Width 220 -Height 20 -FontSize 12 -Color "#D8E5FF" -Bold
  Add-Bullets -Slide $slide8 -Items @(
    "Model training and artifact refresh",
    "Analytics markdown and CSV export",
    "PowerPoint deck generation from live API data",
    "n8n workflow sync and local bootstrap scripts"
  ) -Left 652 -Top 232 -Width 470 -Height 220 | Out-Null
  $slide8.Shapes.Range().Item($slide8.Shapes.Count).TextFrame.TextRange.Font.Color.RGB = 0xFFFFFF
  Add-TextBox -Slide $slide8 -Text "Intent Resurrection Engine turns messy digital residue into a structured recovery plan." -Left 58 -Top 566 -Width 1040 -Height 42 -FontSize 22 -FontName "Aptos Display" -Color "#221B13" -Bold

  $presentation.SaveAs($outputFullPath)
}
finally {
  if ($presentation) {
    $presentation.Close()
  }
  if ($ppt) {
    $ppt.Quit()
  }
  if ($presentation) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)
  }
  if ($ppt) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt)
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}

Write-Output $outputFullPath
