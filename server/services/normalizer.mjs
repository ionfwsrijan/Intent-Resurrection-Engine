import { randomUUID } from "node:crypto";

function limitText(value, max = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeObjectArray(value, mapper, maxItems = 40) {
  if (Array.isArray(value)) {
    return value
      .map(mapper)
      .filter(Boolean)
      .slice(0, maxItems);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n/)
      .map((entry) => mapper(entry))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  return [];
}

function normalizeTab(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return { title: limitText(entry), url: "", active: false };
  }

  return {
    title: limitText(entry.title || entry.label || entry.text),
    url: limitText(entry.url, 800),
    active: Boolean(entry.active)
  };
}

function normalizeTextEntry(entry, key = "text") {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return { [key]: limitText(entry, 900) };
  }

  return { [key]: limitText(entry[key] || entry.text || entry.command || entry.path, 900) };
}

function normalizeFileEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return { path: limitText(entry, 900), status: "unknown" };
  }

  return {
    path: limitText(entry.path || entry.file || entry.name, 900),
    status: limitText(entry.status || entry.state || "unknown", 80),
    modifiedAt: entry.modifiedAt || entry.lastWriteTime || "",
    size: Number(entry.size || 0)
  };
}

function normalizeClusterEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return {
      label: limitText(entry, 240),
      count: 1,
      sampleTitles: []
    };
  }

  const sampleTitles = Array.isArray(entry.sampleTitles)
    ? entry.sampleTitles.map((title) => limitText(title, 240)).filter(Boolean).slice(0, 6)
    : [];
  const hosts = Array.isArray(entry.hosts)
    ? entry.hosts.map((host) => limitText(host, 120)).filter(Boolean).slice(0, 6)
    : [];

  return {
    label: limitText(entry.label || entry.topic || entry.name, 240),
    count: Number(entry.count || sampleTitles.length || 1),
    hosts,
    sampleTitles
  };
}

function normalizeAppFocusEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return {
      app: limitText(entry, 160),
      windowTitle: "",
      active: true,
      observedAt: ""
    };
  }

  return {
    app: limitText(entry.app || entry.process || entry.name, 160),
    windowTitle: limitText(entry.windowTitle || entry.title, 240),
    active: Boolean(entry.active ?? true),
    observedAt: entry.observedAt || entry.timestamp || ""
  };
}

function normalizeTimelineEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return {
      kind: "note",
      label: limitText(entry, 240),
      host: "",
      observedAt: ""
    };
  }

  return {
    kind: limitText(entry.kind || entry.type || "event", 80),
    label: limitText(entry.label || entry.title || entry.text || entry.path || entry.app, 240),
    host: limitText(entry.host || entry.domain, 160),
    observedAt: entry.observedAt || entry.timestamp || entry.modifiedAt || ""
  };
}

function normalizeGitEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return { path: limitText(entry, 900), status: "unknown" };
  }

  return {
    path: limitText(entry.path || entry.file, 900),
    status: limitText(entry.status || entry.code || "unknown", 80)
  };
}

function normalizeMetrics(metrics = {}) {
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    interruptionCount: number(metrics.interruptionCount),
    pauseRatio: number(metrics.pauseRatio),
    typingBurstScore: number(metrics.typingBurstScore),
    focusSwitchCount: number(metrics.focusSwitchCount),
    idleMinutes: number(metrics.idleMinutes)
  };
}

export function normalizeSnapshot(payload, defaults = {}) {
  const traces = payload.traces ?? payload;
  const context = payload.context ?? {};
  const now = new Date().toISOString();

  const browserTabs = normalizeObjectArray(traces.browserTabs ?? traces.tabs, normalizeTab, 60);
  const browserClusters = normalizeObjectArray(traces.browserClusters ?? traces.tabClusters, normalizeClusterEntry, 24);
  const fileActivity = normalizeObjectArray(traces.fileActivity ?? traces.files ?? traces.fileRenames, normalizeFileEntry, 60);
  const clipboardFragments = normalizeObjectArray(traces.clipboardFragments ?? traces.clipboard, (entry) => normalizeTextEntry(entry, "text"), 40);
  const terminalHistory = normalizeObjectArray(traces.terminalHistory ?? traces.commands, (entry) => normalizeTextEntry(entry, "command"), 60);
  const draftNotes = normalizeObjectArray(traces.draftNotes ?? traces.notes, (entry) => normalizeTextEntry(entry, "text"), 40);
  const gitStatus = normalizeObjectArray(traces.gitStatus, normalizeGitEntry, 40);
  const appFocus = normalizeObjectArray(traces.appFocus ?? traces.windowFocus ?? traces.focus, normalizeAppFocusEntry, 20);
  const activityTimeline = normalizeObjectArray(traces.activityTimeline ?? traces.timeline ?? traces.events, normalizeTimelineEntry, 40);

  const title =
    limitText(payload.title || context.title) ||
    browserTabs[0]?.title ||
    draftNotes[0]?.text ||
    fileActivity[0]?.path ||
    "Untitled work session";

  return {
    sessionId: limitText(payload.sessionId || context.sessionId, 120) || `session-${randomUUID()}`,
    title,
    channel: limitText(payload.channel || context.channel || defaults.channel || "collector", 80),
    sourceType: limitText(payload.sourceType || context.sourceType || defaults.sourceType || "manual-api", 80),
    occurredAt: payload.occurredAt || context.occurredAt || now,
    traces: {
      browserTabs,
      browserClusters,
      fileActivity,
      clipboardFragments,
      terminalHistory,
      draftNotes,
      gitStatus,
      appFocus,
      activityTimeline
    },
    context: {
      rootPath: limitText(context.rootPath || payload.rootPath, 500),
      branch: limitText(context.branch || payload.branch, 160),
      hostname: limitText(context.hostname || payload.hostname, 160),
      userLabel: limitText(context.userLabel || payload.userLabel, 160),
      platform: limitText(context.platform || payload.platform, 80),
      sourceLabel: limitText(context.sourceLabel || payload.sourceLabel, 160)
    },
    metrics: normalizeMetrics(payload.metrics ?? payload.typingMetrics ?? {})
  };
}
