const elements = {
  modelVersion: document.querySelector("#modelVersion"),
  trainModelButton: document.querySelector("#trainModelButton"),
  runBenchmarkButton: document.querySelector("#runBenchmarkButton"),
  exportMarkdownButton: document.querySelector("#exportMarkdownButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  benchmarkStatus: document.querySelector("#benchmarkStatus"),
  benchmarkRuns: document.querySelector("#benchmarkRuns"),
  confusionMatrix: document.querySelector("#confusionMatrix"),
  calibrationBuckets: document.querySelector("#calibrationBuckets"),
  notificationLogs: document.querySelector("#notificationLogs"),
  timelineCoverage: document.querySelector("#timelineCoverage")
};

async function api(path, options = {}) {
  return window.intentAuth.api(path, options);
}

function triggerDownload(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setStatus(message, tone = "idle") {
  elements.benchmarkStatus.textContent = message;
  elements.benchmarkStatus.className = `status-banner ${tone}`;
}

function renderEmpty(container, message) {
  container.replaceChildren();
  const copy = document.createElement("p");
  copy.className = "support-copy";
  copy.textContent = message;
  container.appendChild(copy);
}

function createTable(headers, rows) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((header) => {
    const cell = document.createElement("th");
    cell.textContent = header;
    headRow.appendChild(cell);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

function renderBenchmarkRuns(runs = []) {
  elements.benchmarkRuns.replaceChildren();
  if (!runs.length) {
    renderEmpty(elements.benchmarkRuns, "No benchmark runs yet.");
    return;
  }

  runs.slice(0, 3).forEach((run) => {
    const card = document.createElement("article");
    card.className = "detail-card";
    const label = document.createElement("p");
    label.className = "label";
    label.textContent = `${run.datasetLabel} · ${new Date(run.createdAt).toLocaleString()}`;
    const title = document.createElement("h3");
    title.textContent = run.modelVersion;
    const list = document.createElement("ul");
    list.className = "bullet-list";
    (run.results?.runs || []).forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.strategy}: top-1 ${Math.round((entry.top1Accuracy || 0) * 100)}%, top-3 ${Math.round((entry.top3Accuracy || 0) * 100)}%, avg confidence ${Math.round((entry.averageConfidence || 0) * 100)}%`;
      list.appendChild(item);
    });
    card.append(label, title, list);
    elements.benchmarkRuns.appendChild(card);
  });
}

function renderConfusionMatrix(summary, intents) {
  elements.confusionMatrix.replaceChildren();
  const actualIntents = Object.keys(summary?.confusion || {});
  if (!actualIntents.length) {
    renderEmpty(elements.confusionMatrix, "No labeled confusion data yet.");
    return;
  }

  const intentLabels = new Map((intents || []).map((intent) => [intent.id, intent.label]));
  const predictedIds = [...new Set(actualIntents.flatMap((actual) => Object.keys(summary.confusion[actual] || {})))];
  const headers = ["Actual \\ Predicted", ...predictedIds.map((id) => intentLabels.get(id) || id)];
  const rows = actualIntents.map((actual) => [
    intentLabels.get(actual) || actual,
    ...predictedIds.map((predicted) => String(summary.confusion?.[actual]?.[predicted] || 0))
  ]);

  elements.confusionMatrix.appendChild(createTable(headers, rows));
}

function renderCalibration(latestBenchmark) {
  elements.calibrationBuckets.replaceChildren();
  const hybridRun = latestBenchmark?.results?.runs?.find((entry) => entry.strategy.includes("hybrid")) || latestBenchmark?.results?.runs?.[0];
  const buckets = hybridRun?.calibration || [];
  if (!buckets.length) {
    renderEmpty(elements.calibrationBuckets, "No calibration buckets yet.");
    return;
  }

  buckets.forEach((bucket) => {
    const row = document.createElement("div");
    row.className = "chart-row";
    const meta = document.createElement("div");
    meta.className = "chart-meta";
    const label = document.createElement("strong");
    label.textContent = bucket.bucket;
    const value = document.createElement("span");
    value.textContent = `${Math.round((bucket.accuracy || 0) * 100)}% over ${bucket.total} labeled session${bucket.total === 1 ? "" : "s"}`;
    meta.append(label, value);
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max(8, Math.round((bucket.accuracy || 0) * 100))}%`;
    track.appendChild(fill);
    row.append(meta, track);
    elements.calibrationBuckets.appendChild(row);
  });
}

function renderNotificationLogs(logs = []) {
  elements.notificationLogs.replaceChildren();
  if (!logs.length) {
    renderEmpty(elements.notificationLogs, "No delivery logs yet.");
    return;
  }

  const rows = logs.slice(0, 20).map((entry) => [
    entry.workspaceName || entry.workspaceId,
    entry.sessionTitle || entry.sessionId || "n/a",
    entry.status,
    entry.destination.startsWith("http") ? "webhook" : entry.destination.split(":")[0],
    String(entry.attemptCount || 0),
    entry.lastError || "none",
    new Date(entry.lastAttemptAt || entry.deliveredAt || entry.createdAt).toLocaleString()
  ]);

  elements.notificationLogs.appendChild(createTable(
    ["Workspace", "Session", "Status", "Channel", "Attempts", "Last error", "Last event"],
    rows
  ));
}

function renderTimelineCoverage(sessions = []) {
  elements.timelineCoverage.replaceChildren();
  if (!sessions.length) {
    renderEmpty(elements.timelineCoverage, "No sessions available.");
    return;
  }

  sessions.slice(0, 8).forEach((session) => {
    const card = document.createElement("article");
    card.className = "detail-card";
    const label = document.createElement("p");
    label.className = "label";
    label.textContent = `${session.channel} · ${new Date(session.lastActivityAt).toLocaleString()}`;
    const title = document.createElement("strong");
    title.textContent = `${session.pinned ? "★ " : ""}${session.title}`;
    const summary = document.createElement("p");
    summary.className = "support-copy";
    summary.textContent = `${session.predictedIntent?.label || "No prediction"} · timeline depth ${session.timelineDepth} capture${session.timelineDepth === 1 ? "" : "s"}`;
    card.append(label, title, summary);
    elements.timelineCoverage.appendChild(card);
  });
}

async function loadAnalytics() {
  const payload = await api("/api/v1/analytics");
  elements.modelVersion.textContent = payload.modelVersion || "unknown";
  renderBenchmarkRuns(payload.benchmarkRuns || []);
  renderConfusionMatrix(payload.evaluationSummary, payload.intents);
  renderCalibration(payload.latestBenchmark);
  renderNotificationLogs(payload.notificationLogs || []);
  renderTimelineCoverage(payload.recentSessions || []);

  if (payload.latestBenchmark) {
    setStatus(`Latest benchmark uses ${payload.latestBenchmark.modelVersion} with ${payload.latestBenchmark.results?.datasetSize || 0} labeled examples.`, "success");
  } else {
    setStatus("No benchmark has been run yet.", "idle");
  }
}

elements.trainModelButton.addEventListener("click", async () => {
  setStatus("Training and persisting the model artifact...", "idle");
  try {
    const payload = await api("/api/v1/model/train", {
      method: "POST",
      body: JSON.stringify({})
    });
    setStatus(`Model artifact updated at ${new Date(payload.artifact.createdAt).toLocaleString()}.`, "success");
    await loadAnalytics();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.runBenchmarkButton.addEventListener("click", async () => {
  setStatus("Running benchmark over seed and labeled sessions...", "idle");
  try {
    await api("/api/v1/benchmarks/run", {
      method: "POST",
      body: JSON.stringify({})
    });
    setStatus("Benchmark completed and stored.", "success");
    await loadAnalytics();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.exportMarkdownButton.addEventListener("click", async () => {
  try {
    const content = await api("/api/v1/reports/analytics?format=markdown", {
      headers: {
        Accept: "text/markdown"
      }
    });
    triggerDownload(`intent-analytics-${new Date().toISOString().slice(0, 10)}.md`, typeof content === "string" ? content : JSON.stringify(content, null, 2), "text/markdown");
    setStatus("Analytics report exported.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.exportCsvButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/v1/reports/sessions.csv", {
      headers: {
        Authorization: `Bearer ${window.intentAuth.token}`
      }
    });
    const content = await response.text();
    if (!response.ok) {
      throw new Error(content || `Request failed with ${response.status}`);
    }
    triggerDownload(`intent-sessions-${new Date().toISOString().slice(0, 10)}.csv`, content, "text/csv");
    setStatus("Session CSV exported.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

window.intentAuth.requirePageAuth()
  .then(() => loadAnalytics())
  .catch((error) => {
    setStatus(`Could not load analytics. ${error.message}`, "error");
  });
