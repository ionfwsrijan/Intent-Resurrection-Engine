const SETTINGS_KEY = "intent-resurrection-settings";
const TIMELINE_KEY = "intent-resurrection-activity-timeline";
const NOISY_HOST_PATTERNS = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)netflix\.com$/i,
  /(^|\.)spotify\.com$/i,
  /(^|\.)primevideo\.com$/i,
  /(^|\.)hotstar\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)discord\.com$/i,
  /(^|\.)whatsapp\.com$/i
];

const TOPIC_RULES = [
  {
    label: "research",
    hosts: [/arxiv\.org$/i, /scholar\.google/i, /semanticscholar\.org$/i, /ieee\.org$/i, /acm\.org$/i],
    keywords: ["paper", "research", "citation", "literature", "study", "survey"]
  },
  {
    label: "pricing",
    hosts: [/docs\.google/i, /notion/i],
    keywords: ["pricing", "quote", "proposal", "deck", "slides", "renewal", "commercial"]
  },
  {
    label: "planning",
    hosts: [/notion/i, /linear/i, /jira/i, /trello/i],
    keywords: ["roadmap", "backlog", "planning", "prd", "milestone", "launch", "scope"]
  },
  {
    label: "coding",
    hosts: [/github\.com$/i, /gitlab\.com$/i, /stackoverflow\.com$/i, /localhost$/i],
    keywords: ["pull request", "diff", "repo", "issue", "code", "debug", "localhost", "api"]
  },
  {
    label: "incident",
    hosts: [/sentry/i, /datadog/i, /grafana/i, /pagerduty/i],
    keywords: ["incident", "rollback", "deploy", "outage", "alert", "release", "hotfix"]
  },
  {
    label: "job-application",
    hosts: [/greenhouse/i, /lever\.co/i, /linkedin\.com$/i],
    keywords: ["resume", "job", "application", "cover letter", "interview", "candidate"]
  }
];

const DEFAULT_SETTINGS = {
  ingestionUrl: "",
  sourceToken: "",
  sessionLabel: "primary-browser",
  userLabel: "",
  autoSend: true,
  captureIntervalMinutes: 5,
  ignoreNoisyTabs: true,
  allowedHosts: "",
  blockedHosts: "",
  redactUrls: false,
  localOnlyMode: false,
  includeTabTitles: true,
  includeTabUrls: true,
  includeClusters: true,
  includeTimeline: true
};

async function readSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_KEY] || {})
  };
}

async function writeSettings(settings) {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...settings } });
}

async function readTimeline() {
  const result = await chrome.storage.local.get(TIMELINE_KEY);
  return Array.isArray(result[TIMELINE_KEY]) ? result[TIMELINE_KEY] : [];
}

async function writeTimeline(entries) {
  await chrome.storage.local.set({ [TIMELINE_KEY]: entries.slice(-18) });
}

async function recordTimelineEvent(entry) {
  const existing = await readTimeline();
  existing.push({
    kind: entry.kind || "tab-switch",
    label: entry.label || "",
    host: entry.host || "",
    observedAt: entry.observedAt || new Date().toISOString()
  });
  await writeTimeline(existing);
}

async function ensureAlarm() {
  const settings = await readSettings();
  if (settings.autoSend && settings.captureIntervalMinutes > 0) {
    await chrome.alarms.create("intent-resurrection-auto-send", {
      periodInMinutes: Number(settings.captureIntervalMinutes)
    });
  } else {
    await chrome.alarms.clear("intent-resurrection-auto-send");
  }
}

function sanitizeSessionLabel(value) {
  return String(value || "primary-browser")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "primary-browser";
}

function splitHostPatterns(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sanitizeUrl(url, redactUrls) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    if (redactUrls) {
      return `${parsed.protocol}//${parsed.hostname}`;
    }

    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isCapturableTab(tab) {
  return /^https?:\/\//i.test(tab.url || "");
}

function isNoisyTab(tab) {
  const host = getHost(tab.url || "");
  return NOISY_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function matchesHostFilter(host, patterns) {
  if (patterns.length === 0) {
    return true;
  }

  return patterns.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
}

function classifyTabTopic(tab) {
  const host = getHost(tab.url || "");
  const haystack = `${tab.title || ""} ${host}`.toLowerCase();

  const match = TOPIC_RULES.find((rule) =>
    rule.hosts.some((pattern) => pattern.test(host))
    || rule.keywords.some((keyword) => haystack.includes(keyword))
  );

  return match?.label || "general";
}

function buildDomainSummary(tabs) {
  const counts = new Map();
  tabs.forEach((tab) => {
    const host = getHost(tab.url || "");
    if (!host) {
      return;
    }
    counts.set(host, (counts.get(host) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([host, count]) => `${host} (${count} tab${count === 1 ? "" : "s"})`);
}

function buildBrowserClusters(tabs) {
  const groups = new Map();

  tabs.forEach((tab) => {
    const label = classifyTabTopic(tab);
    const existing = groups.get(label) || {
      label,
      count: 0,
      hosts: new Set(),
      sampleTitles: []
    };
    existing.count += 1;
    const host = getHost(tab.url || "");
    if (host) {
      existing.hosts.add(host);
    }
    if (existing.sampleTitles.length < 4 && tab.title) {
      existing.sampleTitles.push(tab.title);
    }
    groups.set(label, existing);
  });

  return [...groups.values()]
    .sort((left, right) => right.count - left.count)
    .map((group) => ({
      label: group.label,
      count: group.count,
      hosts: [...group.hosts].slice(0, 4),
      sampleTitles: group.sampleTitles
    }));
}

async function captureTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const settings = await readSettings();
  const allowedHosts = splitHostPatterns(settings.allowedHosts);
  const blockedHosts = splitHostPatterns(settings.blockedHosts);
  const validTabs = tabs.filter(isCapturableTab);

  const filteredTabs = validTabs.filter((tab) => {
    const host = getHost(tab.url || "");
    if (!host) {
      return false;
    }
    if (blockedHosts.length > 0 && matchesHostFilter(host, blockedHosts)) {
      return false;
    }
    if (allowedHosts.length > 0 && !matchesHostFilter(host, allowedHosts)) {
      return false;
    }
    if (settings.ignoreNoisyTabs && isNoisyTab(tab)) {
      return false;
    }
    return true;
  });

  const capturedTabs = (filteredTabs.length > 0 ? filteredTabs : validTabs)
    .map((tab) => ({
      ...tab,
      host: getHost(tab.url || "")
    }))
    .sort((left, right) => {
      if (Boolean(right.active) !== Boolean(left.active)) {
        return Number(Boolean(right.active)) - Number(Boolean(left.active));
      }
      return left.host.localeCompare(right.host);
    });

  const sessionLabel = settings.sessionLabel && settings.sessionLabel !== "browser-session"
    ? settings.sessionLabel
    : (settings.userLabel || "primary-browser");
  const domainSummary = buildDomainSummary(capturedTabs);
  const browserClusters = settings.includeClusters ? buildBrowserClusters(capturedTabs) : [];
  const activeTab = capturedTabs.find((tab) => tab.active) || capturedTabs[0] || null;
  const activityTimeline = settings.includeTimeline
    ? (await readTimeline()).map((entry) => ({
      kind: entry.kind,
      label: settings.localOnlyMode ? "" : entry.label,
      host: entry.host,
      observedAt: entry.observedAt
    }))
    : [];

  const rawBrowserTabs = settings.localOnlyMode
    ? []
    : capturedTabs.map((tab) => ({
      title: settings.includeTabTitles ? (tab.title || "") : "",
      url: settings.includeTabUrls ? sanitizeUrl(tab.url || "", settings.redactUrls) : "",
      active: Boolean(tab.active)
    }));

  return {
    sessionId: `browser-${sanitizeSessionLabel(sessionLabel)}`,
    title: `Browser capture for ${sessionLabel}`,
    sourceType: "browser-extension",
    channel: "browser-extension",
    occurredAt: new Date().toISOString(),
    context: {
      sourceLabel: "Browser Extension",
      userLabel: settings.userLabel || "",
      platform: "browser"
    },
    metrics: {
      idleMinutes: 0,
      pauseRatio: 0,
      typingBurstScore: 0,
      focusSwitchCount: activityTimeline.length || capturedTabs.length,
      interruptionCount: 0
    },
    traces: {
      browserTabs: rawBrowserTabs,
      browserClusters,
      draftNotes: domainSummary.length > 0
        ? [{ text: `Top domains: ${domainSummary.join(", ")}` }]
        : [],
      appFocus: activeTab
        ? [{
          app: "browser",
          windowTitle: settings.localOnlyMode ? "" : (settings.includeTabTitles ? (activeTab.title || "") : activeTab.host),
          active: true,
          observedAt: new Date().toISOString()
        }]
        : [],
      activityTimeline
    }
  };
}

async function sendCapture() {
  const settings = await readSettings();
  if (!settings.ingestionUrl || !settings.sourceToken) {
    return { ok: false, message: "Missing ingestion URL or source token." };
  }

  const payload = await captureTabs();
  const response = await fetch(settings.ingestionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Source-Token": settings.sourceToken
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Intake failed with ${response.status}`);
  }

  await chrome.storage.local.set({
    lastCaptureAt: new Date().toISOString(),
    lastCaptureStatus: "success",
    lastCaptureSummary: data.analysis?.analysis?.predictedIntent?.label || data.analysis?.predictedIntent?.label || "Capture sent"
  });

  return { ok: true, data };
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isCapturableTab(tab)) {
      return;
    }
    await recordTimelineEvent({
      kind: "tab-switch",
      label: tab.title || "",
      host: getHost(tab.url || "")
    });
  } catch {
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "intent-resurrection-auto-send") {
    return;
  }

  try {
    await sendCapture();
  } catch (error) {
    await chrome.storage.local.set({
      lastCaptureAt: new Date().toISOString(),
      lastCaptureStatus: "error",
      lastCaptureSummary: error.message
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "save-settings") {
    writeSettings(message.payload)
      .then(ensureAlarm)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message.type === "get-settings") {
    readSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message.type === "send-capture") {
    sendCapture()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message.type === "capture-preview") {
    captureTabs()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message.type === "get-last-status") {
    chrome.storage.local.get(["lastCaptureAt", "lastCaptureStatus", "lastCaptureSummary"])
      .then((result) => sendResponse({ ok: true, status: result }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  return false;
});
