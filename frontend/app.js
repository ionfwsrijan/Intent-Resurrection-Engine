const state = {
  workspaces: [],
  sources: [],
  sessions: [],
  analyses: [],
  intents: [],
  evaluationSummary: null,
  modelStats: null,
  publicConfig: {},
  selectedSessionId: null,
  latestSource: null,
  comparison: null,
  feedback: [],
  selectedNotificationIntentIds: [],
  filters: {
    search: "",
    status: "all",
    channel: "all",
    intent: "all"
  }
};

const elements = {
  metricWorkspaces: document.querySelector("#metricWorkspaces"),
  metricSources: document.querySelector("#metricSources"),
  metricActiveSessions: document.querySelector("#metricActiveSessions"),
  metricStaleSessions: document.querySelector("#metricStaleSessions"),
  metricAnalyses: document.querySelector("#metricAnalyses"),
  metricPinnedSessions: document.querySelector("#metricPinnedSessions"),
  analyticsConfidenceTrend: document.querySelector("#analyticsConfidenceTrend"),
  analyticsIntentTimeline: document.querySelector("#analyticsIntentTimeline"),
  analyticsSourceMix: document.querySelector("#analyticsSourceMix"),
  analyticsModelStatus: document.querySelector("#analyticsModelStatus"),
  workspaceForm: document.querySelector("#workspaceForm"),
  workspaceId: document.querySelector("#workspaceId"),
  workspaceName: document.querySelector("#workspaceName"),
  workspaceRootPath: document.querySelector("#workspaceRootPath"),
  workspaceDescription: document.querySelector("#workspaceDescription"),
  workspaceNotificationWebhook: document.querySelector("#workspaceNotificationWebhook"),
  workspaceNotificationDigestMinutes: document.querySelector("#workspaceNotificationDigestMinutes"),
  workspaceNotificationQuietStart: document.querySelector("#workspaceNotificationQuietStart"),
  workspaceNotificationQuietEnd: document.querySelector("#workspaceNotificationQuietEnd"),
  workspaceNotificationIntentIds: document.querySelector("#workspaceNotificationIntentIds"),
  workspaceNotificationMinIdleMinutes: document.querySelector("#workspaceNotificationMinIdleMinutes"),
  workspaceResetButton: document.querySelector("#workspaceResetButton"),
  workspaceList: document.querySelector("#workspaceList"),
  sourceForm: document.querySelector("#sourceForm"),
  sourceWorkspaceId: document.querySelector("#sourceWorkspaceId"),
  sourceType: document.querySelector("#sourceType"),
  sourceName: document.querySelector("#sourceName"),
  sourceCredentialCard: document.querySelector("#sourceCredentialCard"),
  sourceCredentialBody: document.querySelector("#sourceCredentialBody"),
  sourceList: document.querySelector("#sourceList"),
  ingestionForm: document.querySelector("#ingestionForm"),
  ingestionSourceToken: document.querySelector("#ingestionSourceToken"),
  snapshotFile: document.querySelector("#snapshotFile"),
  snapshotJson: document.querySelector("#snapshotJson"),
  pipelineStatus: document.querySelector("#pipelineStatus"),
  ingestionWebhookUrl: document.querySelector("#ingestionWebhookUrl"),
  staleWebhookUrl: document.querySelector("#staleWebhookUrl"),
  collectorCommand: document.querySelector("#collectorCommand"),
  extensionSetup: document.querySelector("#extensionSetup"),
  collectorIncludeClipboard: document.querySelector("#collectorIncludeClipboard"),
  collectorIncludeTerminal: document.querySelector("#collectorIncludeTerminal"),
  collectorIncludeNotes: document.querySelector("#collectorIncludeNotes"),
  collectorIncludeGitStatus: document.querySelector("#collectorIncludeGitStatus"),
  collectorIncludeAppFocus: document.querySelector("#collectorIncludeAppFocus"),
  collectorLocalOnlyMode: document.querySelector("#collectorLocalOnlyMode"),
  collectorExtensions: document.querySelector("#collectorExtensions"),
  bundleFile: document.querySelector("#bundleFile"),
  bundleWorkspaceId: document.querySelector("#bundleWorkspaceId"),
  bundleOverwrite: document.querySelector("#bundleOverwrite"),
  importBundleButton: document.querySelector("#importBundleButton"),
  exportBundleButton: document.querySelector("#exportBundleButton"),
  sessionSearch: document.querySelector("#sessionSearch"),
  sessionStatusFilter: document.querySelector("#sessionStatusFilter"),
  sessionChannelFilter: document.querySelector("#sessionChannelFilter"),
  sessionIntentFilter: document.querySelector("#sessionIntentFilter"),
  sessionList: document.querySelector("#sessionList"),
  evaluationMetrics: document.querySelector("#evaluationMetrics"),
  evaluationExamples: document.querySelector("#evaluationExamples"),
  rerunAnalysisButton: document.querySelector("#rerunAnalysisButton"),
  resolveSessionButton: document.querySelector("#resolveSessionButton"),
  pinSessionButton: document.querySelector("#pinSessionButton"),
  markCorrectButton: document.querySelector("#markCorrectButton"),
  deleteSessionButton: document.querySelector("#deleteSessionButton"),
  detailIntent: document.querySelector("#detailIntent"),
  detailConfidence: document.querySelector("#detailConfidence"),
  detailEvidence: document.querySelector("#detailEvidence"),
  detailNextSteps: document.querySelector("#detailNextSteps"),
  detailPrivacy: document.querySelector("#detailPrivacy"),
  detailTraceSummary: document.querySelector("#detailTraceSummary"),
  detailCalibration: document.querySelector("#detailCalibration"),
  detailClusters: document.querySelector("#detailClusters"),
  comparisonSummary: document.querySelector("#comparisonSummary"),
  detailTimeline: document.querySelector("#detailTimeline"),
  feedbackVerdict: document.querySelector("#feedbackVerdict"),
  feedbackIntentId: document.querySelector("#feedbackIntentId"),
  feedbackNote: document.querySelector("#feedbackNote"),
  submitFeedbackButton: document.querySelector("#submitFeedbackButton"),
  feedbackHistory: document.querySelector("#feedbackHistory"),
  detailJson: document.querySelector("#detailJson")
};

function persistToken(sourceId, token) {
  localStorage.setItem(`source-token:${sourceId}`, token);
}

function getPersistedToken(sourceId) {
  return localStorage.getItem(`source-token:${sourceId}`) || "";
}

async function api(path, options = {}) {
  return window.intentAuth.api(path, options);
}

function setPipelineStatus(message, tone = "idle") {
  elements.pipelineStatus.textContent = message;
  elements.pipelineStatus.className = `status-banner ${tone}`;
}

function renderList(container, items, mapper, ordered = false) {
  container.replaceChildren();
  const values = Array.isArray(items) && items.length > 0 ? items : [ordered ? "No recommendations available." : "No items available."];
  values.forEach((item) => {
    const element = document.createElement("li");
    element.textContent = mapper ? mapper(item) : String(item);
    container.appendChild(element);
  });
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createBarChart(container, rows, formatter) {
  container.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "support-copy";
    empty.textContent = "No analytics available yet.";
    container.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const wrapper = document.createElement("div");
    wrapper.className = "chart-row";

    const meta = document.createElement("div");
    meta.className = "chart-meta";
    const label = document.createElement("strong");
    label.textContent = row.label;
    const value = document.createElement("span");
    value.textContent = formatter ? formatter(row) : String(row.value);
    meta.append(label, value);

    const barTrack = document.createElement("div");
    barTrack.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = "bar-fill";
    bar.style.width = `${Math.max(8, Math.round((row.value || 0) * 100))}%`;
    barTrack.appendChild(bar);

    wrapper.append(meta, barTrack);
    container.appendChild(wrapper);
  });
}

function fillWorkspaceForm(workspace) {
  elements.workspaceId.value = workspace?.id || "";
  elements.workspaceName.value = workspace?.name || "";
  elements.workspaceRootPath.value = workspace?.rootPath || "";
  elements.workspaceDescription.value = workspace?.description || "";
  elements.workspaceNotificationWebhook.value = workspace?.notificationWebhookUrl || "";
  elements.workspaceNotificationDigestMinutes.value = workspace?.notificationDigestMinutes || 0;
  elements.workspaceNotificationQuietStart.value = workspace?.notificationQuietStart || "";
  elements.workspaceNotificationQuietEnd.value = workspace?.notificationQuietEnd || "";
  state.selectedNotificationIntentIds = Array.isArray(workspace?.notificationIntentIds) ? [...workspace.notificationIntentIds] : [];
  elements.workspaceNotificationMinIdleMinutes.value = workspace?.notificationMinIdleMinutes || 0;
  renderNotificationIntentChips();
}

function renderNotificationIntentChips() {
  elements.workspaceNotificationIntentIds.replaceChildren();
  state.intents.forEach((intent) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip-button ${state.selectedNotificationIntentIds.includes(intent.id) ? "selected" : ""}`;
    button.textContent = intent.label;
    button.addEventListener("click", () => {
      if (state.selectedNotificationIntentIds.includes(intent.id)) {
        state.selectedNotificationIntentIds = state.selectedNotificationIntentIds.filter((value) => value !== intent.id);
      } else {
        state.selectedNotificationIntentIds = [...state.selectedNotificationIntentIds, intent.id];
      }
      renderNotificationIntentChips();
    });
    elements.workspaceNotificationIntentIds.appendChild(button);
  });

  if (state.intents.length === 0) {
    const copy = document.createElement("p");
    copy.className = "support-copy";
    copy.textContent = "Intent taxonomy is loading.";
    elements.workspaceNotificationIntentIds.appendChild(copy);
  }
}

function renderMetrics(metrics) {
  elements.metricWorkspaces.textContent = metrics.workspaces || 0;
  elements.metricSources.textContent = metrics.sources || 0;
  elements.metricActiveSessions.textContent = metrics.activeSessions || 0;
  elements.metricStaleSessions.textContent = metrics.staleSessions || 0;
  elements.metricAnalyses.textContent = metrics.analyses || 0;
  elements.metricPinnedSessions.textContent = metrics.pinnedSessions || 0;
}

function renderWorkspaces() {
  elements.workspaceList.replaceChildren();

  state.workspaces.forEach((workspace) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-chip";
    const title = document.createElement("strong");
    title.textContent = workspace.name;
    const pathText = document.createElement("small");
    pathText.textContent = workspace.rootPath || "No root path configured";
    const webhookText = document.createElement("small");
    webhookText.textContent = workspace.notificationWebhookUrl
      ? `Notifications: ${workspace.notificationWebhookUrl}${workspace.notificationDigestMinutes ? ` · digest ${workspace.notificationDigestMinutes}m` : ""}`
      : "No notification destination configured";
    const ruleText = document.createElement("small");
    const rules = [
      workspace.notificationQuietStart && workspace.notificationQuietEnd
        ? `quiet ${workspace.notificationQuietStart}-${workspace.notificationQuietEnd}`
        : "",
      workspace.notificationMinIdleMinutes ? `min idle ${workspace.notificationMinIdleMinutes}m` : "",
      workspace.notificationIntentIds?.length ? `intents ${workspace.notificationIntentIds.join(", ")}` : ""
    ].filter(Boolean);
    ruleText.textContent = rules.length ? `Rules: ${rules.join(" · ")}` : "No extra notification rules";
    button.append(title, pathText, webhookText, ruleText);
    button.addEventListener("click", () => fillWorkspaceForm(workspace));
    elements.workspaceList.appendChild(button);
  });

  const workspaceSelects = [elements.sourceWorkspaceId, elements.bundleWorkspaceId];
  workspaceSelects.forEach((select) => {
    select.replaceChildren();
    if (state.workspaces.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Create a workspace first";
      select.appendChild(option);
      return;
    }

    state.workspaces.forEach((workspace) => {
      const option = document.createElement("option");
      option.value = workspace.id;
      option.textContent = workspace.name;
      select.appendChild(option);
    });
  });
}

function renderSources() {
  elements.sourceList.replaceChildren();

  state.sources.forEach((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-chip";
    const tokenHint = getPersistedToken(source.id);
    const title = document.createElement("strong");
    title.textContent = source.name;
    const type = document.createElement("small");
    type.textContent = source.type;
    const token = document.createElement("small");
    token.textContent = `${source.tokenPreview}${tokenHint ? " · token stored locally" : ""}`;
    button.append(title, type, token);
    button.addEventListener("click", () => {
      if (tokenHint) {
        elements.ingestionSourceToken.value = tokenHint;
        state.latestSource = {
          ...source,
          plaintextToken: tokenHint
        };
        renderCredentialCard();
      }
    });
    elements.sourceList.appendChild(button);
  });
}

function renderIntentOptions() {
  const selects = [elements.sessionIntentFilter, elements.feedbackIntentId];
  const filterValue = state.filters.intent;
  const feedbackValue = elements.feedbackIntentId.value;

  selects.forEach((select, index) => {
    select.replaceChildren();
    const firstOption = document.createElement("option");
    firstOption.value = index === 0 ? "all" : "";
    firstOption.textContent = index === 0 ? "All intents" : "Use predicted intent";
    select.appendChild(firstOption);

    state.intents.forEach((intent) => {
      const option = document.createElement("option");
      option.value = intent.id;
      option.textContent = intent.label;
      select.appendChild(option);
    });
  });

  elements.sessionIntentFilter.value = filterValue;
  elements.feedbackIntentId.value = feedbackValue;
}

function renderSessionFilters() {
  const channels = [...new Set(state.sessions.map((session) => session.channel).filter(Boolean))];
  const previousChannel = state.filters.channel;

  elements.sessionChannelFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All channels";
  elements.sessionChannelFilter.appendChild(allOption);
  channels.forEach((channel) => {
    const option = document.createElement("option");
    option.value = channel;
    option.textContent = channel;
    elements.sessionChannelFilter.appendChild(option);
  });
  elements.sessionChannelFilter.value = channels.includes(previousChannel) ? previousChannel : "all";
}

function buildCollectorCommand(source) {
  const ingestionUrl = state.publicConfig.ingestionWebhookUrl || "http://localhost:5678/webhook/intent-resurrection-engine/ingest";
  const parts = [
    ".\\collectors\\windows\\capture-session.ps1",
    `-IngestionUrl "${ingestionUrl}"`,
    `-SourceToken "${source.plaintextToken}"`,
    '-WorkspacePath "D:\\Work\\your-workspace"'
  ];

  const extensions = elements.collectorExtensions.value.trim();
  if (extensions) {
    parts.push(`-IncludeExtensions "${extensions}"`);
  }
  if (!elements.collectorIncludeClipboard.checked) {
    parts.push("-SkipClipboard");
  }
  if (!elements.collectorIncludeTerminal.checked) {
    parts.push("-SkipTerminalHistory");
  }
  if (!elements.collectorIncludeNotes.checked) {
    parts.push("-SkipNotes");
  }
  if (!elements.collectorIncludeGitStatus.checked) {
    parts.push("-SkipGitStatus");
  }
  if (!elements.collectorIncludeAppFocus.checked) {
    parts.push("-SkipAppFocus");
  }
  if (elements.collectorLocalOnlyMode.checked) {
    parts.push("-LocalOnlyMode");
  }

  return parts.join(" ");
}

function renderCredentialCard() {
  const source = state.latestSource;
  const ingestionUrl = state.publicConfig.ingestionWebhookUrl || "Configure PUBLIC_INGESTION_WEBHOOK_URL";

  elements.ingestionWebhookUrl.textContent = ingestionUrl || "Not configured";
  elements.staleWebhookUrl.textContent = state.publicConfig.staleMonitorWebhookUrl || "Not configured";

  if (!source) {
    elements.sourceCredentialCard.classList.add("empty");
    elements.sourceCredentialBody.textContent = "Create a source to receive the one-time token and collector instructions.";
    elements.collectorCommand.textContent = "Create a source to generate a usable command.";
    elements.extensionSetup.textContent = "Load the unpacked extension from collectors/browser-extension, then paste the intake URL and source token in its options screen.";
    return;
  }

  elements.sourceCredentialCard.classList.remove("empty");
  elements.sourceCredentialBody.replaceChildren();

  const title = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = source.name;
  title.appendChild(strong);

  const tokenRow = document.createElement("div");
  tokenRow.textContent = "Token: ";
  const tokenCode = document.createElement("code");
  tokenCode.textContent = source.plaintextToken;
  tokenRow.appendChild(tokenCode);

  const urlRow = document.createElement("div");
  urlRow.textContent = "Ingestion URL: ";
  const urlCode = document.createElement("code");
  urlCode.textContent = ingestionUrl;
  urlRow.appendChild(urlCode);

  elements.sourceCredentialBody.append(title, tokenRow, urlRow);
  elements.collectorCommand.textContent = buildCollectorCommand(source);
  elements.extensionSetup.textContent =
    `Load the unpacked extension from collectors/browser-extension, paste ${ingestionUrl} and the token for ${source.name}, then use allow/block hosts, clusters, and local-only mode in the extension options page.`;
}

function getFilteredSessions() {
  const query = state.filters.search.trim().toLowerCase();

  return state.sessions.filter((session) => {
    const predictedIntentId = session.latestAnalysis?.predictedIntent?.id || session.latestAnalysis?.summary?.predictedIntent?.id || "";
    const searchable = [
      session.title,
      session.summary,
      session.channel,
      session.latestAnalysis?.predictedIntent?.label,
      ...(session.latestAnalysis?.summary?.evidence || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (state.filters.status !== "all" && session.status !== state.filters.status) {
      return false;
    }

    if (state.filters.channel !== "all" && session.channel !== state.filters.channel) {
      return false;
    }

    if (state.filters.intent !== "all" && predictedIntentId !== state.filters.intent) {
      return false;
    }

    if (query && !searchable.includes(query)) {
      return false;
    }

    return true;
  });
}

function renderAnalytics() {
  const sessions = [...state.sessions];
  const analyses = [...state.analyses].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  const confidenceRows = sessions
    .slice(0, 8)
    .reverse()
    .map((session) => ({
      label: session.title,
      value: session.latestAnalysis?.predictedIntent?.confidence || 0
    }));

  createBarChart(elements.analyticsConfidenceTrend, confidenceRows, (row) => `${Math.round(row.value * 100)}%`);

  elements.analyticsIntentTimeline.replaceChildren();
  if (analyses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "support-copy";
    empty.textContent = "No intent history yet.";
    elements.analyticsIntentTimeline.appendChild(empty);
  } else {
    analyses.slice(-8).reverse().forEach((analysis) => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      const label = document.createElement("strong");
      label.textContent = analysis.predictedIntent.label;
      const meta = document.createElement("span");
      meta.textContent = `${Math.round((analysis.predictedIntent.confidence || 0) * 100)}% · ${new Date(analysis.createdAt).toLocaleString()}`;
      item.append(label, meta);
      elements.analyticsIntentTimeline.appendChild(item);
    });
  }

  const sourceCounts = Object.entries(
    sessions.reduce((accumulator, session) => {
      accumulator[session.channel] = (accumulator[session.channel] || 0) + 1;
      return accumulator;
    }, {})
  ).map(([label, count]) => ({
    label,
    value: sessions.length ? count / sessions.length : 0,
    raw: count
  }));
  createBarChart(elements.analyticsSourceMix, sourceCounts, (row) => `${row.raw} session${row.raw === 1 ? "" : "s"}`);

  const modelStats = state.modelStats || {};
  renderList(elements.analyticsModelStatus, [
    `Seed training examples: ${modelStats.seedExamples || 0}`,
    `Feedback-derived examples: ${modelStats.dynamicExamples || 0}`,
    `Labeled sessions: ${state.evaluationSummary?.labeledSessions || 0}`,
    `Exact accuracy: ${Math.round((state.evaluationSummary?.exactAccuracy || 0) * 100)}%`
  ]);
}

async function toggleSessionPinned(sessionId, pinned) {
  await api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/pin`, {
    method: "POST",
    body: JSON.stringify({ pinned })
  });
  await loadDashboard();
  if (state.selectedSessionId === sessionId) {
    await loadSessionDetail(sessionId);
  }
}

async function saveFeedback(sessionId, payload) {
  await api("/api/v1/feedback", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      ...payload
    })
  });
}

function renderSessions() {
  elements.sessionList.replaceChildren();
  const sessions = getFilteredSessions();

  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "detail-card";
    empty.textContent = "No sessions match the current filters.";
    elements.sessionList.appendChild(empty);
    return;
  }

  sessions.forEach((session) => {
    const card = document.createElement("article");
    card.className = `session-card ${state.selectedSessionId === session.id ? "active" : ""}`;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "session-card-main";
    const analysis = session.latestAnalysis;
    const confidence = analysis?.predictedIntent?.confidence
      ? `${Math.round(analysis.predictedIntent.confidence * 100)}%`
      : "Not analyzed";
    const title = document.createElement("strong");
    title.textContent = `${session.pinned ? "★ " : ""}${session.title}`;
    const status = document.createElement("small");
    status.textContent = `Status: ${session.status} · Channel: ${session.channel}`;
    const prediction = document.createElement("small");
    prediction.textContent = `${analysis?.predictedIntent?.label || "No prediction yet"} · ${confidence}`;
    const activity = document.createElement("small");
    activity.textContent = `Last activity: ${new Date(session.lastActivityAt).toLocaleString()}`;
    main.append(title, status, prediction, activity);
    main.addEventListener("click", () => loadSessionDetail(session.id));

    const actions = document.createElement("div");
    actions.className = "session-actions";

    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "ghost-button mini";
    pinButton.textContent = session.pinned ? "Unpin" : "Pin";
    pinButton.addEventListener("click", async () => {
      await toggleSessionPinned(session.id, !session.pinned);
      setPipelineStatus(session.pinned ? "Session unpinned." : "Session pinned.", "success");
    });

    const correctButton = document.createElement("button");
    correctButton.type = "button";
    correctButton.className = "ghost-button mini";
    correctButton.textContent = "Correct";
    correctButton.addEventListener("click", async () => {
      await saveFeedback(session.id, { verdict: "correct" });
      setPipelineStatus("Marked as correct.", "success");
      await loadDashboard();
      if (state.selectedSessionId === session.id) {
        await loadSessionDetail(session.id);
      }
    });

    actions.append(pinButton, correctButton);
    card.append(main, actions);
    elements.sessionList.appendChild(card);
  });
}

function renderEvaluationSummary() {
  const summary = state.evaluationSummary;
  if (!summary) {
    renderList(elements.evaluationMetrics, ["No evaluation summary available yet."]);
    renderList(elements.evaluationExamples, ["No evaluation examples yet."]);
    return;
  }

  renderList(elements.evaluationMetrics, [
    `Labeled sessions: ${summary.labeledSessions || 0}`,
    `Exact accuracy: ${Math.round((summary.exactAccuracy || 0) * 100)}%`,
    `Correct: ${summary.verdictCounts?.correct || 0}`,
    `Partially correct: ${summary.verdictCounts?.partial || 0}`,
    `Wrong: ${summary.verdictCounts?.wrong || 0}`
  ]);

  renderList(
    elements.evaluationExamples,
    summary.examples || [],
    (example) => `${example.title} · predicted ${example.predictedIntentId} · actual ${example.actualIntentId} · ${example.verdict}`
  );
}

function resetSessionDetail() {
  state.selectedSessionId = null;
  state.comparison = null;
  state.feedback = [];
  renderSessions();
  elements.detailIntent.textContent = "No session selected";
  elements.detailConfidence.textContent = "Select a session to inspect its latest analysis.";
  renderList(elements.detailEvidence, ["Evidence appears when a session is selected."]);
  renderList(elements.detailNextSteps, ["Recommendations appear when a session is selected."], null, true);
  elements.detailPrivacy.textContent = "No session selected.";
  renderList(elements.detailTraceSummary, ["No session selected."]);
  elements.detailCalibration.textContent = "No session selected.";
  renderList(elements.detailClusters, ["No browser clusters available."]);
  renderList(elements.comparisonSummary, ["No comparison available yet."]);
  renderList(elements.detailTimeline, ["No timeline available yet."]);
  elements.feedbackHistory.textContent = "No feedback saved for this session yet.";
  elements.feedbackNote.value = "";
  elements.feedbackIntentId.value = "";
  elements.pinSessionButton.textContent = "Pin session";
  elements.detailJson.textContent = JSON.stringify({ status: "idle" }, null, 2);
}

function renderSessionDetail(session, timeline = []) {
  state.selectedSessionId = session.id;
  renderSessions();

  const analysis = session.latestAnalysis?.summary || {};
  const predictedIntent = analysis.predictedIntent || session.latestAnalysis?.predictedIntent || null;

  elements.detailIntent.textContent = predictedIntent?.label || session.title;
  elements.detailConfidence.textContent = predictedIntent
    ? `${Math.round((predictedIntent.confidence || 0) * 100)}% confidence · ${predictedIntent.recoveryFocus || "Recovery guidance available"}`
    : "No analysis available for this session yet.";

  renderList(elements.detailEvidence, analysis.evidence || ["No evidence available yet."]);
  renderList(elements.detailNextSteps, analysis.suggestedNextSteps || ["No next-step guidance available yet."], null, true);

  const privacy = analysis.privacySummary;
  elements.detailPrivacy.textContent = privacy
    ? `${privacy.status} · ${privacy.redactionCount} redactions${privacy.redactedFields?.length ? ` across ${privacy.redactedFields.join(", ")}` : ""}`
    : "No privacy summary available.";

  const traceSummary = Object.entries(analysis.traceSummary || {})
    .map(([key, value]) => `${key}: ${value}`);
  renderList(elements.detailTraceSummary, traceSummary.length ? traceSummary : ["No trace summary available."]);

  const calibrationBits = [];
  if (predictedIntent?.confidenceBand) {
    calibrationBits.push(`Confidence band: ${predictedIntent.confidenceBand}`);
  }
  if (predictedIntent?.uncertain) {
    calibrationBits.push(`Uncertain: ${predictedIntent.uncertaintyReason}`);
  }
  if (analysis.modelDiagnostics) {
    calibrationBits.push(`Model score ${analysis.modelDiagnostics.winnerModelScore}, rule score ${analysis.modelDiagnostics.winnerRuleScore}, training examples ${analysis.modelDiagnostics.trainingExamples}`);
  }
  elements.detailCalibration.textContent = calibrationBits.length
    ? calibrationBits.join(" · ")
    : "No calibration data available.";

  renderList(
    elements.detailClusters,
    analysis.browserClusterSummary || [],
    (cluster) => `${cluster.label}: ${cluster.count} tab${cluster.count === 1 ? "" : "s"}${cluster.hosts?.length ? ` · ${cluster.hosts.join(", ")}` : ""}`
  );

  if (state.comparison?.changeSummary) {
    const summary = state.comparison.changeSummary;
    renderList(elements.comparisonSummary, [
      `Intent changed: ${summary.intentChanged ? "yes" : "no"}`,
      `Confidence delta: ${summary.confidenceDelta > 0 ? "+" : ""}${summary.confidenceDelta}`,
      `Idle delta: ${summary.staleDeltaMinutes > 0 ? "+" : ""}${summary.staleDeltaMinutes} minutes`,
      ...(summary.evidenceDelta.added.length ? summary.evidenceDelta.added.map((item) => `Evidence added: ${item}`) : []),
      ...(summary.evidenceDelta.removed.length ? summary.evidenceDelta.removed.map((item) => `Evidence removed: ${item}`) : []),
      ...(summary.nextStepDelta.added.length ? summary.nextStepDelta.added.map((item) => `Next step added: ${item}`) : []),
      ...(summary.nextStepDelta.removed.length ? summary.nextStepDelta.removed.map((item) => `Next step removed: ${item}`) : [])
    ]);
  } else {
    renderList(elements.comparisonSummary, ["No comparison available yet."]);
  }

  renderList(
    elements.detailTimeline,
    timeline,
    (entry) => {
      const snapshot = entry.snapshot || {};
      const observedAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "unknown time";
      const tabCount = snapshot.traces?.browserTabs?.length || 0;
      const fileCount = snapshot.traces?.fileActivity?.length || 0;
      const focusCount = snapshot.traces?.appFocus?.length || 0;
      return `${observedAt} · ${snapshot.title || "Capture"} · tabs ${tabCount}, files ${fileCount}, focus ${focusCount}`;
    }
  );

  if (state.feedback.length > 0) {
    elements.feedbackHistory.textContent = state.feedback
      .slice(0, 3)
      .map((entry) => `${entry.verdict}${entry.actualIntentId ? ` -> ${entry.actualIntentId}` : ""}${entry.note ? ` · ${entry.note}` : ""}`)
      .join(" | ");
  } else {
    elements.feedbackHistory.textContent = "No feedback saved for this session yet.";
  }

  elements.feedbackIntentId.value = "";
  elements.feedbackNote.value = "";
  elements.pinSessionButton.textContent = session.pinned ? "Unpin session" : "Pin session";
  elements.detailJson.textContent = JSON.stringify(
    {
      sessionId: session.id,
      status: session.status,
      pinned: session.pinned,
      latestSnapshot: session.latestSnapshot,
      latestAnalysis: session.latestAnalysis,
      comparison: state.comparison
    },
    null,
    2
  );
}

async function loadDashboard() {
  const dashboard = await api("/api/v1/dashboard");
  state.workspaces = dashboard.workspaces || [];
  state.sources = dashboard.sources || [];
  state.sessions = dashboard.recentSessions || [];
  state.analyses = dashboard.recentAnalyses || [];
  state.intents = dashboard.intents || [];
  state.evaluationSummary = dashboard.evaluationSummary || null;
  state.modelStats = dashboard.modelStats || null;
  state.publicConfig = dashboard.publicConfig || {};

  renderMetrics(dashboard.metrics || {});
  renderWorkspaces();
  renderIntentOptions();
  renderNotificationIntentChips();
  renderSources();
  renderCredentialCard();
  renderSessionFilters();
  renderEvaluationSummary();
  renderAnalytics();
  renderSessions();

  if (state.selectedSessionId) {
    const selected = state.sessions.find((session) => session.id === state.selectedSessionId);
    if (selected) {
      await loadSessionDetail(selected.id);
      return;
    }
  }

  resetSessionDetail();
}

async function loadSessionDetail(sessionId) {
  const [sessionPayload, comparisonPayload, feedbackPayload, timelinePayload] = await Promise.all([
    api(`/api/v1/sessions/${encodeURIComponent(sessionId)}`),
    api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/comparison`),
    api(`/api/v1/feedback?sessionId=${encodeURIComponent(sessionId)}`),
    api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/timeline`)
  ]);

  state.comparison = comparisonPayload.comparison;
  state.feedback = feedbackPayload.feedback || [];
  renderSessionDetail(sessionPayload.session, timelinePayload.timeline || []);
}

async function readSnapshotPayload() {
  if (elements.snapshotFile.files?.length) {
    const file = elements.snapshotFile.files[0];
    const text = await file.text();
    return JSON.parse(text);
  }

  if (!elements.snapshotJson.value.trim()) {
    throw new Error("Provide a snapshot JSON file or paste a JSON payload.");
  }

  return JSON.parse(elements.snapshotJson.value);
}

elements.workspaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const workspaceId = elements.workspaceId.value.trim();
  const body = {
    name: elements.workspaceName.value.trim(),
    rootPath: elements.workspaceRootPath.value.trim(),
    description: elements.workspaceDescription.value.trim(),
    notificationDestination: elements.workspaceNotificationWebhook.value.trim(),
    notificationDigestMinutes: Number(elements.workspaceNotificationDigestMinutes.value || 0),
    notificationQuietStart: elements.workspaceNotificationQuietStart.value.trim(),
    notificationQuietEnd: elements.workspaceNotificationQuietEnd.value.trim(),
    notificationIntentIds: state.selectedNotificationIntentIds,
    notificationMinIdleMinutes: Number(elements.workspaceNotificationMinIdleMinutes.value || 0)
  };

  if (!body.name) {
    setPipelineStatus("Workspace name is required before saving.", "error");
    return;
  }

  if (workspaceId) {
    await api(`/api/v1/workspaces/${workspaceId}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    setPipelineStatus("Workspace updated.", "success");
  } else {
    await api("/api/v1/workspaces", {
      method: "POST",
      body: JSON.stringify(body)
    });
    setPipelineStatus("Workspace created.", "success");
  }

  fillWorkspaceForm(null);
  await loadDashboard();
});

elements.workspaceResetButton.addEventListener("click", () => fillWorkspaceForm(null));

elements.sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    workspaceId: elements.sourceWorkspaceId.value,
    type: elements.sourceType.value,
    name: elements.sourceName.value.trim()
  };

  if (!body.workspaceId || !body.name) {
    setPipelineStatus("Choose a workspace and source name first.", "error");
    return;
  }

  const payload = await api("/api/v1/sources", {
    method: "POST",
    body: JSON.stringify(body)
  });

  state.latestSource = payload.source;
  persistToken(payload.source.id, payload.source.plaintextToken);
  elements.ingestionSourceToken.value = payload.source.plaintextToken;
  renderCredentialCard();
  setPipelineStatus("Source token created. Copy it into the collector you want to use.", "success");
  elements.sourceName.value = "";
  await loadDashboard();
});

elements.ingestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const sourceToken = elements.ingestionSourceToken.value.trim();
  if (!sourceToken) {
    setPipelineStatus("A source token is required for ingestion.", "error");
    return;
  }

  try {
    const payload = await readSnapshotPayload();
    const target = state.publicConfig.ingestionWebhookUrl || "/api/v1/ingestion/session";
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Source-Token": sourceToken
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Ingestion failed with ${response.status}`);
    }

    const sessionId = result.analysis?.sessionId || result.session?.id || result.ingestion?.session?.id;
    if (!state.publicConfig.ingestionWebhookUrl && result.session?.id) {
      await api("/api/v1/analysis/run", {
        method: "POST",
        body: JSON.stringify({ sessionId: result.session.id })
      });
    }

    setPipelineStatus("Payload sent successfully. Dashboard refreshed with the latest session state.", "success");
    elements.snapshotJson.value = "";
    elements.snapshotFile.value = "";
    await loadDashboard();

    if (sessionId) {
      await loadSessionDetail(sessionId);
    }
  } catch (error) {
    setPipelineStatus(error.message, "error");
  }
});

elements.importBundleButton.addEventListener("click", async () => {
  if (!elements.bundleFile.files?.length) {
    setPipelineStatus("Choose a JSON bundle file before importing.", "error");
    return;
  }

  const workspaceId = elements.bundleWorkspaceId.value;
  if (!workspaceId) {
    setPipelineStatus("Choose a target workspace for the import.", "error");
    return;
  }

  const text = await elements.bundleFile.files[0].text();
  const bundle = JSON.parse(text);
  const sessions = Array.isArray(bundle.sessions) ? bundle.sessions : [];

  await api("/api/v1/import/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      sessions,
      overwrite: elements.bundleOverwrite.checked
    })
  });

  setPipelineStatus(`Imported ${sessions.length} session${sessions.length === 1 ? "" : "s"} from the bundle.`, "success");
  elements.bundleFile.value = "";
  await loadDashboard();
});

elements.exportBundleButton.addEventListener("click", async () => {
  const bundle = await api("/api/v1/export/sessions");
  downloadJson(`intent-resurrection-sessions-${new Date().toISOString().slice(0, 10)}.json`, bundle);
  setPipelineStatus("Session bundle exported.", "success");
});

elements.rerunAnalysisButton.addEventListener("click", async () => {
  if (!state.selectedSessionId) {
    setPipelineStatus("Select a session before rerunning analysis.", "error");
    return;
  }

  await api("/api/v1/analysis/run", {
    method: "POST",
    body: JSON.stringify({ sessionId: state.selectedSessionId })
  });
  setPipelineStatus("Analysis rerun completed.", "success");
  await loadDashboard();
  await loadSessionDetail(state.selectedSessionId);
});

elements.resolveSessionButton.addEventListener("click", async () => {
  if (!state.selectedSessionId) {
    setPipelineStatus("Select a session before marking it resolved.", "error");
    return;
  }

  await api(`/api/v1/sessions/${encodeURIComponent(state.selectedSessionId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({})
  });
  setPipelineStatus("Session marked resolved.", "success");
  await loadDashboard();
  await loadSessionDetail(state.selectedSessionId);
});

elements.pinSessionButton.addEventListener("click", async () => {
  if (!state.selectedSessionId) {
    setPipelineStatus("Select a session before pinning it.", "error");
    return;
  }

  const selected = state.sessions.find((session) => session.id === state.selectedSessionId);
  await toggleSessionPinned(state.selectedSessionId, !selected?.pinned);
  setPipelineStatus(selected?.pinned ? "Session unpinned." : "Session pinned.", "success");
});

elements.markCorrectButton.addEventListener("click", async () => {
  if (!state.selectedSessionId) {
    setPipelineStatus("Select a session before saving feedback.", "error");
    return;
  }

  await saveFeedback(state.selectedSessionId, {
    verdict: "correct"
  });
  setPipelineStatus("Prediction marked as correct.", "success");
  await loadDashboard();
  await loadSessionDetail(state.selectedSessionId);
});

elements.deleteSessionButton.addEventListener("click", async () => {
  if (!state.selectedSessionId) {
    setPipelineStatus("Select a session before deleting it.", "error");
    return;
  }

  const selected = state.sessions.find((session) => session.id === state.selectedSessionId);
  const sessionLabel = selected?.title || state.selectedSessionId;
  const confirmed = window.confirm(`Delete "${sessionLabel}"? This permanently removes the session history and analysis.`);
  if (!confirmed) {
    return;
  }

  const deletedSessionId = state.selectedSessionId;
  await api(`/api/v1/sessions/${encodeURIComponent(deletedSessionId)}`, {
    method: "DELETE"
  });
  resetSessionDetail();
  setPipelineStatus("Session deleted.", "success");
  await loadDashboard();
});

elements.submitFeedbackButton.addEventListener("click", async () => {
  if (!state.selectedSessionId) {
    setPipelineStatus("Select a session before saving feedback.", "error");
    return;
  }

  await saveFeedback(state.selectedSessionId, {
    verdict: elements.feedbackVerdict.value,
    actualIntentId: elements.feedbackIntentId.value,
    note: elements.feedbackNote.value.trim()
  });
  setPipelineStatus("Feedback saved. Future evaluations will use it.", "success");
  await loadDashboard();
  await loadSessionDetail(state.selectedSessionId);
});

[
  [elements.sessionSearch, "search"],
  [elements.sessionStatusFilter, "status"],
  [elements.sessionChannelFilter, "channel"],
  [elements.sessionIntentFilter, "intent"]
].forEach(([element, key]) => {
  element.addEventListener("input", () => {
    state.filters[key] = element.value;
    renderSessions();
  });
  element.addEventListener("change", () => {
    state.filters[key] = element.value;
    renderSessions();
  });
});

[
  elements.collectorIncludeClipboard,
  elements.collectorIncludeTerminal,
  elements.collectorIncludeNotes,
  elements.collectorIncludeGitStatus,
  elements.collectorIncludeAppFocus,
  elements.collectorLocalOnlyMode,
  elements.collectorExtensions
].forEach((element) => {
  const eventName = element.tagName === "INPUT" && element.type === "text" ? "input" : "change";
  element.addEventListener(eventName, () => renderCredentialCard());
});

elements.feedbackVerdict.addEventListener("change", () => {
  if (elements.feedbackVerdict.value === "correct") {
    elements.feedbackIntentId.value = "";
  }
});

window.intentAuth.requirePageAuth()
  .then(() => loadDashboard())
  .catch((error) => {
    setPipelineStatus(`Could not load the dashboard. ${error.message}`, "error");
  });

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
  setPipelineStatus(`Dashboard action failed. ${message}`, "error");
});
