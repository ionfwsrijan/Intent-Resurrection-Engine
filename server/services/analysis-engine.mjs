import { readFileSync } from "node:fs";
import { createPrototypeModel } from "./prototype-model.mjs";
import { createSemanticClassifier } from "./semantic-classifier.mjs";
import { createTrainableModel } from "./trainable-model.mjs";
import { normalizeSnapshot } from "./normalizer.mjs";

const MODEL_VERSION = "hybrid-v6-trainable";

const NOISY_BROWSER_HOSTS = [
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
  /(^|\.)web\.whatsapp\.com$/i,
  /(^|\.)whatsapp\.com$/i
];

const RESEARCH_HOSTS = [
  /(^|\.)arxiv\.org$/i,
  /(^|\.)scholar\.google\./i,
  /(^|\.)semanticscholar\.org$/i,
  /(^|\.)acm\.org$/i,
  /(^|\.)ieee\.org$/i
];

const INCIDENT_HOSTS = [
  /(^|\.)grafana\./i,
  /(^|\.)datadog\./i,
  /(^|\.)sentry\./i,
  /(^|\.)pagerduty\./i
];

const LOW_SIGNAL_TERMINAL_PATTERNS = [
  /^cd(?:\s|$)/i,
  /^dir(?:\s|$)/i,
  /^ls(?:\s|$)/i,
  /^pwd$/i,
  /^clear$/i,
  /^cls$/i,
  /^npm run (?:dev|check|smoke)\b/i,
  /^npm install\b/i,
  /^pip install\b/i,
  /^python main\.py$/i,
  /^node server\/index\.mjs$/i,
  /^docker compose up\b/i,
  /^docker compose ps\b/i,
  /^get-scheduledtask\b/i,
  /^get-scheduledtaskinfo\b/i,
  /^start-scheduledtask\b/i,
  /^copy-item\b/i,
  /^\.venv\\scripts\\activate\.ps1$/i,
  /^invoke-restmethod -method get -uri "http:\/\/localhost:3000\/api\/v1\/sessions"$/i
];

const PRESENTATION_EXTENSIONS = new Set(["ppt", "pptx", "key", "pdf", "doc", "docx"]);
const PRODUCT_PLANNING_FILES = new Set(["md", "txt", "doc", "docx"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .split(/[^a-z0-9+.#/_:-]+/)
    .filter((token) => token.length > 2);
}

function containsKeyword(entryTokens, haystack, keyword) {
  if (!keyword) {
    return false;
  }

  if (entryTokens.has(keyword)) {
    return true;
  }

  const keywordPattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(keyword)}(?:$|[^a-z0-9])`, "i");
  return keywordPattern.test(haystack);
}

function redactSecrets(value) {
  return String(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/\b(?:sk|pk|rk|ghp|gho|github_pat)_[A-Za-z0-9_-]{10,}\b/gi, "[REDACTED_SECRET]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED_JWT]")
    .replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
}

function normalizeBehaviorContribution(key, value) {
  if (!value) {
    return 0;
  }

  if (key.toLowerCase().includes("ratio") || key.toLowerCase().includes("score")) {
    return clamp(Number(value), 0, 1);
  }

  return clamp(Number(value) / 10, 0, 1.2);
}

function extractHostname(url) {
  if (!url) {
    return "";
  }

  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractFileName(filePath = "") {
  return String(filePath).split(/[\\/]/).pop() || "";
}

function extractFileExtension(filePath = "") {
  const fileName = extractFileName(filePath);
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function isNoisyBrowserHost(hostname) {
  return NOISY_BROWSER_HOSTS.some((pattern) => pattern.test(hostname));
}

function isLowSignalTerminalCommand(command) {
  return LOW_SIGNAL_TERMINAL_PATTERNS.some((pattern) => pattern.test(String(command || "").trim()));
}

function countPatternMatches(values, patterns) {
  return values.reduce((count, value) => {
    const haystack = String(value).toLowerCase();
    return count + patterns.filter((pattern) => pattern.test(haystack)).length;
  }, 0);
}

function collectSnapshotTokens(snapshot) {
  const traces = snapshot.traces || {};
  const values = [
    snapshot.context.rootPath || "",
    snapshot.context.branch || "",
    ...(traces.browserTabs || []).flatMap((entry) => [entry.title || "", entry.url || ""]),
    ...(traces.browserClusters || []).flatMap((entry) => [entry.label || "", ...(entry.sampleTitles || []), ...(entry.hosts || [])]),
    ...(traces.fileActivity || []).flatMap((entry) => [entry.path || "", entry.status || ""]),
    ...(traces.clipboardFragments || []).map((entry) => entry.text || ""),
    ...(traces.terminalHistory || []).map((entry) => entry.command || ""),
    ...(traces.draftNotes || []).map((entry) => entry.text || ""),
    ...(traces.gitStatus || []).flatMap((entry) => [entry.status || "", entry.path || ""]),
    ...(traces.appFocus || []).flatMap((entry) => [entry.app || "", entry.windowTitle || ""]),
    ...(traces.activityTimeline || []).flatMap((entry) => [entry.kind || "", entry.label || "", entry.host || ""])
  ];

  return tokenize(values.join(" "));
}

function buildFeedbackProfiles(feedbackExamples = []) {
  const profiles = new Map();

  feedbackExamples.slice(0, 60).forEach((example) => {
    if (!example?.intentId || !example?.snapshot) {
      return;
    }

    const tokens = collectSnapshotTokens(example.snapshot);
    if (tokens.length === 0) {
      return;
    }

    const profile = profiles.get(example.intentId) || { count: 0, tokens: new Map() };
    profile.count += 1;
    tokens.forEach((token) => {
      profile.tokens.set(token, (profile.tokens.get(token) || 0) + 1);
    });
    profiles.set(example.intentId, profile);
  });

  return profiles;
}

function computeFeedbackBoost(intentId, snapshot, feedbackProfiles) {
  const profile = feedbackProfiles.get(intentId);
  if (!profile || profile.tokens.size === 0) {
    return 0;
  }

  const currentTokens = new Set(collectSnapshotTokens(snapshot));
  const topTokens = [...profile.tokens.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 18)
    .map(([token]) => token);

  const overlap = topTokens.filter((token) => currentTokens.has(token)).length;
  if (overlap === 0) {
    return 0;
  }

  return Math.min((overlap / topTokens.length) * (1.15 + profile.count * 0.12), 1.8);
}

function gatherContextFeatures(snapshot) {
  const traces = snapshot.traces || {};
  const rootPath = snapshot.context.rootPath?.toLowerCase() ?? "";
  const filePaths = (traces.fileActivity || []).map((entry) => String(entry.path || "").toLowerCase());
  const fileExtensions = (traces.fileActivity || []).map((entry) => extractFileExtension(entry.path)).filter(Boolean);
  const browserTabs = (traces.browserTabs || []).map((entry) => ({
    title: String(entry.title || ""),
    url: String(entry.url || ""),
    host: extractHostname(entry.url || ""),
    active: Boolean(entry.active)
  }));
  const productiveBrowserTabs = browserTabs.filter((entry) => entry.host && !isNoisyBrowserHost(entry.host));
  const browserTexts = productiveBrowserTabs.map((entry) => `${entry.title} ${entry.url}`.trim().toLowerCase());
  const browserClusterTexts = (traces.browserClusters || []).flatMap((entry) => [
    String(entry.label || "").toLowerCase(),
    ...(entry.sampleTitles || []).map((value) => String(value || "").toLowerCase()),
    ...(entry.hosts || []).map((value) => String(value || "").toLowerCase())
  ]);
  const noteTexts = (traces.draftNotes || []).map((entry) => String(entry.text || "").toLowerCase());
  const clipboardTexts = (traces.clipboardFragments || []).map((entry) => String(entry.text || "").toLowerCase());
  const terminalCommands = (traces.terminalHistory || [])
    .map((entry) => String(entry.command || ""))
    .filter((command) => command && !isLowSignalTerminalCommand(command))
    .map((command) => command.toLowerCase());
  const focusTexts = (traces.appFocus || []).flatMap((entry) => [
    String(entry.app || "").toLowerCase(),
    String(entry.windowTitle || "").toLowerCase()
  ]);
  const timelineTexts = (traces.activityTimeline || []).flatMap((entry) => [
    String(entry.kind || "").toLowerCase(),
    String(entry.label || "").toLowerCase(),
    String(entry.host || "").toLowerCase()
  ]);

  return {
    rootPath,
    filePaths,
    fileExtensions,
    browserTabs,
    browserTexts,
    browserClusterTexts,
    noteTexts,
    clipboardTexts,
    terminalCommands,
    focusTexts,
    timelineTexts
  };
}

function buildTemporalSignals(history = []) {
  const normalizedHistory = history
    .filter(Boolean)
    .map((snapshot) => normalizeSnapshot(snapshot, {
      sourceType: snapshot?.sourceType || snapshot?.context?.sourceType || "history",
      channel: snapshot?.channel || snapshot?.context?.channel || "history"
    }))
    .slice(-6);

  const features = normalizedHistory.map(gatherContextFeatures);
  const searchableTexts = features.flatMap((entry) => [
    entry.rootPath,
    ...entry.filePaths,
    ...entry.browserTexts,
    ...entry.browserClusterTexts,
    ...entry.noteTexts,
    ...entry.clipboardTexts,
    ...entry.terminalCommands,
    ...entry.focusTexts,
    ...entry.timelineTexts
  ]);

  const activeHosts = features.flatMap((entry) => entry.browserTabs.filter((tab) => tab.active).map((tab) => tab.host));
  const extensions = features.flatMap((entry) => entry.fileExtensions);
  const clusterLabels = features.flatMap((entry) => entry.browserClusterTexts);

  return {
    snapshotCount: normalizedHistory.length,
    searchableTexts,
    activeHosts,
    extensions,
    clusterLabels,
    continuityScore: normalizedHistory.length ? clamp(normalizedHistory.length / 5, 0, 1.2) : 0,
    officeAssetCount: extensions.filter((extension) => PRESENTATION_EXTENSIONS.has(extension)).length,
    authMatches: countPatternMatches(searchableTexts, [/\bauth\b/i, /\btoken\b/i, /\bjwt\b/i, /\boauth\b/i, /\bsession\b/i]),
    commercialMatches: countPatternMatches(searchableTexts, [/\bpitch\b/i, /\bdeck\b/i, /\bpricing\b/i, /\bproposal\b/i, /\bquote\b/i]),
    researchMatches: countPatternMatches(searchableTexts, [/\bresearch\b/i, /\bliterature\b/i, /\bcitation\b/i, /\bstudy\b/i]),
    planningMatches: countPatternMatches(searchableTexts, [/\broadmap\b/i, /\bbacklog\b/i, /\bprd\b/i, /\bplanning\b/i]),
    incidentMatches: countPatternMatches(searchableTexts, [/\bincident\b/i, /\brollback\b/i, /\bdeploy\b/i, /\bhotfix\b/i]),
    jobMatches: countPatternMatches(searchableTexts, [/\bresume\b/i, /\bapplication\b/i, /\bcover letter\b/i, /\binterview\b/i]),
    researchHosts: activeHosts.filter((host) => RESEARCH_HOSTS.some((pattern) => pattern.test(host))).length,
    incidentHosts: activeHosts.filter((host) => INCIDENT_HOSTS.some((pattern) => pattern.test(host))).length
  };
}

function computeContextualBoost(intent, snapshot) {
  const features = gatherContextFeatures(snapshot);
  const searchableTexts = [
    features.rootPath,
    ...features.filePaths,
    ...features.browserTexts,
    ...features.browserClusterTexts,
    ...features.noteTexts,
    ...features.clipboardTexts,
    ...features.terminalCommands,
    ...features.focusTexts,
    ...features.timelineTexts
  ];
  const officeAssetCount = features.fileExtensions.filter((extension) => PRESENTATION_EXTENSIONS.has(extension)).length;

  if (intent.id === "client_pitch_pricing") {
    const commercialMatches = countPatternMatches(searchableTexts, [
      /\bpitch\b/i,
      /\bdeck\b/i,
      /\bslides?\b/i,
      /\bproposal\b/i,
      /\bpricing\b/i,
      /\bquote\b/i,
      /\bcustomer\b/i,
      /\bexecutive summary\b/i,
      /\bpresentation\b/i,
      /\bcommercial\b/i
    ]);

    let boost = 0;
    if (/\bppts?\b|\bslides?\b|\bpresentation\b|\bdeck\b/.test(features.rootPath)) {
      boost += 2.2;
    }
    boost += Math.min(officeAssetCount * 0.45, 2.3);
    boost += Math.min(commercialMatches * 0.55, 3.3);
    return boost;
  }

  if (intent.id === "auth_debugging") {
    const authMatches = countPatternMatches(searchableTexts, [
      /\bauth\b/i,
      /\btoken\b/i,
      /\bjwt\b/i,
      /\boauth\b/i,
      /\bbearer\b/i,
      /\brefresh\b/i,
      /\bcookie\b/i,
      /\blogin\b/i,
      /\b401\b/i,
      /\bsession expiry\b/i
    ]);

    const authPathMatches = countPatternMatches(features.filePaths, [
      /[\\/](auth|login|oauth|jwt|token)[\\/]/i,
      /\b(auth|login|oauth|jwt|token)\b/i
    ]);

    return Math.min(authMatches * 0.45 + authPathMatches * 0.4, 3.4);
  }

  if (intent.id === "research_review") {
    const hostMatches = features.browserTabs.filter((entry) => RESEARCH_HOSTS.some((pattern) => pattern.test(entry.host))).length;
    const synthesisMatches = countPatternMatches(searchableTexts, [
      /\bpaper\b/i,
      /\bresearch\b/i,
      /\bstudy\b/i,
      /\bcitation\b/i,
      /\bliterature\b/i,
      /\bmethod\b/i,
      /\bsurvey\b/i
    ]);

    return Math.min(hostMatches * 1.0 + synthesisMatches * 0.45, 3.6);
  }

  if (intent.id === "incident_response") {
    const branch = snapshot.context.branch?.toLowerCase() ?? "";
    const incidentMatches = countPatternMatches(searchableTexts, [
      /\bincident\b/i,
      /\brollback\b/i,
      /\bdeploy\b/i,
      /\brelease\b/i,
      /\bhotfix\b/i,
      /\balert\b/i,
      /\boutage\b/i,
      /\bdegraded\b/i,
      /\bkubectl\b/i,
      /\bhelm\b/i
    ]);
    const incidentHosts = features.browserTabs.filter((entry) => INCIDENT_HOSTS.some((pattern) => pattern.test(entry.host))).length;

    let boost = Math.min(incidentMatches * 0.45 + incidentHosts * 0.8, 3.5);
    if (/(hotfix|rollback|incident|release)/.test(branch)) {
      boost += 1.5;
    }
    return boost;
  }

  if (intent.id === "product_planning") {
    const planningMatches = countPatternMatches(searchableTexts, [
      /\broadmap\b/i,
      /\bbacklog\b/i,
      /\bprd\b/i,
      /\bspec\b/i,
      /\bmilestone\b/i,
      /\bplanning\b/i,
      /\blaunch\b/i,
      /\brequirement\b/i,
      /\bscope\b/i
    ]);
    const planningDocs = features.fileExtensions.filter((extension) => PRODUCT_PLANNING_FILES.has(extension)).length;

    return Math.min(planningMatches * 0.45 + planningDocs * 0.12, 2.8);
  }

  if (intent.id === "job_application") {
    const jobMatches = countPatternMatches(searchableTexts, [
      /\bresume\b/i,
      /\bcv\b/i,
      /\bcover letter\b/i,
      /\bjob description\b/i,
      /\bapplication\b/i,
      /\binterview\b/i,
      /\bportfolio\b/i,
      /\bgreenhouse\b/i,
      /\blever\b/i
    ]);

    return Math.min(jobMatches * 0.55, 3.2);
  }

  return 0;
}

function computeTemporalBoost(intent, temporalSignals) {
  if (!temporalSignals.snapshotCount) {
    return 0;
  }

  if (intent.id === "client_pitch_pricing") {
    return Math.min(temporalSignals.continuityScore * 0.5 + temporalSignals.officeAssetCount * 0.22 + temporalSignals.commercialMatches * 0.12, 2.5);
  }
  if (intent.id === "auth_debugging") {
    return Math.min(temporalSignals.continuityScore * 0.4 + temporalSignals.authMatches * 0.16, 2.2);
  }
  if (intent.id === "research_review") {
    return Math.min(temporalSignals.continuityScore * 0.4 + temporalSignals.researchMatches * 0.15 + temporalSignals.researchHosts * 0.28, 2.4);
  }
  if (intent.id === "incident_response") {
    return Math.min(temporalSignals.continuityScore * 0.35 + temporalSignals.incidentMatches * 0.16 + temporalSignals.incidentHosts * 0.28, 2.4);
  }
  if (intent.id === "product_planning") {
    return Math.min(temporalSignals.continuityScore * 0.35 + temporalSignals.planningMatches * 0.14, 2.1);
  }
  if (intent.id === "job_application") {
    return Math.min(temporalSignals.continuityScore * 0.32 + temporalSignals.jobMatches * 0.18, 2);
  }

  return 0;
}

function formatOverlapSignals(signals = []) {
  return signals
    .filter(Boolean)
    .map((signal) => signal.replace(/^[a-z-]+:/, "").replace(/_/g, " "))
    .slice(0, 3);
}

function sanitizeSnapshot(snapshot) {
  const redactedFields = new Set();
  let redactionCount = 0;

  const sanitizeEntries = (entries = [], key) => entries.map((entry) => {
    const clone = { ...entry };

    Object.keys(clone).forEach((field) => {
      if (typeof clone[field] === "string") {
        const before = clone[field];
        const after = redactSecrets(before);
        if (after !== before) {
          redactionCount += 1;
          redactedFields.add(key);
        }
        clone[field] = after;
      } else if (Array.isArray(clone[field])) {
        clone[field] = clone[field].map((value) => {
          if (typeof value !== "string") {
            return value;
          }
          const before = value;
          const after = redactSecrets(before);
          if (after !== before) {
            redactionCount += 1;
            redactedFields.add(key);
          }
          return after;
        });
      }
    });

    return clone;
  });

  return {
    snapshot: {
      ...snapshot,
      traces: {
        browserTabs: sanitizeEntries(snapshot.traces?.browserTabs || [], "browserTabs"),
        browserClusters: sanitizeEntries(snapshot.traces?.browserClusters || [], "browserClusters"),
        fileActivity: sanitizeEntries(snapshot.traces?.fileActivity || [], "fileActivity"),
        clipboardFragments: sanitizeEntries(snapshot.traces?.clipboardFragments || [], "clipboardFragments"),
        terminalHistory: sanitizeEntries(snapshot.traces?.terminalHistory || [], "terminalHistory"),
        draftNotes: sanitizeEntries(snapshot.traces?.draftNotes || [], "draftNotes"),
        gitStatus: sanitizeEntries(snapshot.traces?.gitStatus || [], "gitStatus"),
        appFocus: sanitizeEntries(snapshot.traces?.appFocus || [], "appFocus"),
        activityTimeline: sanitizeEntries(snapshot.traces?.activityTimeline || [], "activityTimeline")
      }
    },
    privacySummary: {
      status: redactionCount > 0 ? "sanitized" : "clean",
      redactionCount,
      redactedFields: Array.from(redactedFields)
    }
  };
}

function flattenTraces(snapshot) {
  const traces = snapshot.traces || {};
  return [
    ...(traces.browserTabs || []).map((entry) => {
      const hostname = extractHostname(entry.url || "");
      return {
        field: "browserTabs",
        text: `${entry.title} ${entry.url}`.trim(),
        metadata: {
          active: Boolean(entry.active),
          hostname,
          noisy: isNoisyBrowserHost(hostname)
        }
      };
    }),
    ...(traces.browserClusters || []).map((entry) => ({
      field: "browserClusters",
      text: `${entry.label} ${(entry.sampleTitles || []).join(" ")} ${(entry.hosts || []).join(" ")}`.trim(),
      metadata: {
        count: Number(entry.count || 0)
      }
    })),
    ...(traces.fileActivity || []).map((entry) => ({
      field: "fileActivity",
      text: `${entry.path} ${entry.status}`.trim(),
      metadata: {
        extension: extractFileExtension(entry.path),
        fileName: extractFileName(entry.path)
      }
    })),
    ...(traces.clipboardFragments || []).map((entry) => ({
      field: "clipboardFragments",
      text: entry.text,
      metadata: {
        length: String(entry.text || "").length
      }
    })),
    ...(traces.terminalHistory || []).map((entry) => ({
      field: "terminalHistory",
      text: entry.command,
      metadata: {
        generic: isLowSignalTerminalCommand(entry.command || "")
      }
    })),
    ...(traces.draftNotes || []).map((entry) => ({ field: "draftNotes", text: entry.text, metadata: {} })),
    ...(traces.gitStatus || []).map((entry) => ({ field: "gitStatus", text: `${entry.status} ${entry.path}`.trim(), metadata: {} })),
    ...(traces.appFocus || []).map((entry) => ({
      field: "appFocus",
      text: `${entry.app} ${entry.windowTitle}`.trim(),
      metadata: {
        active: Boolean(entry.active)
      }
    })),
    ...(traces.activityTimeline || []).map((entry) => ({
      field: "activityTimeline",
      text: `${entry.kind} ${entry.label} ${entry.host}`.trim(),
      metadata: {}
    }))
  ].filter((entry) => entry.text);
}

function getEntrySignalMultiplier(entry) {
  let multiplier = 1;

  if (entry.field === "browserTabs") {
    if (entry.metadata.noisy) {
      multiplier *= 0.08;
    } else if (entry.metadata.active) {
      multiplier *= 1.15;
    }
  }

  if (entry.field === "browserClusters") {
    multiplier *= 1.2 + Math.min(Number(entry.metadata.count || 0) * 0.08, 0.45);
  }

  if (entry.field === "appFocus" && entry.metadata.active) {
    multiplier *= 1.08;
  }

  if (entry.field === "terminalHistory" && entry.metadata.generic) {
    multiplier *= 0.12;
  }

  if (entry.field === "clipboardFragments" && entry.metadata.length < 24) {
    multiplier *= 0.8;
  }

  if (entry.field === "activityTimeline") {
    multiplier *= 1.1;
  }

  return multiplier;
}

function scoreIntent(intent, entries, metrics, context, sanitizedSnapshot, feedbackProfiles, temporalSignals) {
  let score = 0;
  const matchedEntries = [];
  const fieldWeights = intent.fieldWeights ?? {};

  for (const entry of entries) {
    const haystack = entry.text.toLowerCase();
    const entryTokens = new Set(tokenize(haystack));
    const matches = intent.keywords.filter((keyword) => containsKeyword(entryTokens, haystack, keyword));
    const phraseMatches = (intent.phrases ?? []).filter((phrase) => haystack.includes(phrase));

    if (matches.length > 0 || phraseMatches.length > 0) {
      const fieldWeight = fieldWeights[entry.field] ?? 1;
      const signalMultiplier = getEntrySignalMultiplier(entry);
      const contribution = (matches.length * 1.08 + phraseMatches.length * 1.42) * fieldWeight * signalMultiplier;

      if (contribution > 0.08) {
        score += contribution;
        matchedEntries.push({
          field: entry.field,
          text: entry.text,
          contribution: Number(contribution.toFixed(2))
        });
      }
    }
  }

  for (const [metricKey, coefficient] of Object.entries(intent.behaviorBoosts ?? {})) {
    const behaviorValue = normalizeBehaviorContribution(metricKey, metrics[metricKey]);
    score += behaviorValue * coefficient;
  }

  score += computeContextualBoost(intent, sanitizedSnapshot);
  score += computeFeedbackBoost(intent.id, sanitizedSnapshot, feedbackProfiles);
  score += computeTemporalBoost(intent, temporalSignals);

  const branch = context.branch?.toLowerCase() ?? "";
  if (intent.id === "incident_response" && /(hotfix|rollback|incident|release)/.test(branch)) {
    score += 1.4;
  }
  if (intent.id === "auth_debugging" && /(auth|token|session|oauth)/.test(branch)) {
    score += 1.0;
  }

  return {
    id: intent.id,
    label: intent.label,
    recoveryFocus: intent.recoveryFocus,
    nextSteps: intent.nextSteps,
    ruleScore: score,
    matches: matchedEntries.sort((left, right) => right.contribution - left.contribution).slice(0, 6)
  };
}

function softmaxScores(values) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

function getConfidenceCalibration(topScore, secondScore, confidence, signalQualityBand) {
  const margin = topScore - secondScore;
  const uncertain = signalQualityBand === "low" || margin < 0.55 || confidence < 0.58;
  const adjustedConfidence = uncertain
    ? Math.min(confidence, signalQualityBand === "low" ? 0.54 : 0.61)
    : confidence;

  return {
    confidence: Number(adjustedConfidence.toFixed(2)),
    band: adjustedConfidence >= 0.78 ? "high" : adjustedConfidence >= 0.58 ? "medium" : "low",
    uncertain,
    reason: uncertain
      ? (signalQualityBand === "low"
          ? "This session has a light signal footprint, so the prediction is only a leaning."
          : "Top intent candidates are close together, so the prediction should be treated as tentative.")
      : "The session has a clear intent signature."
  };
}

function buildTemporalSummary(temporalSignals) {
  if (!temporalSignals.snapshotCount) {
    return "No recent temporal history available.";
  }

  const signals = [];
  if (temporalSignals.officeAssetCount > 0) {
    signals.push(`${temporalSignals.officeAssetCount} presentation/document assets across recent captures`);
  }
  if (temporalSignals.authMatches > 0) {
    signals.push(`${temporalSignals.authMatches} recent auth-oriented signals`);
  }
  if (temporalSignals.researchHosts > 0) {
    signals.push(`${temporalSignals.researchHosts} research host visits across recent captures`);
  }
  if (temporalSignals.incidentHosts > 0) {
    signals.push(`${temporalSignals.incidentHosts} incident-monitoring visits across recent captures`);
  }

  return signals.length
    ? `Recent history spans ${temporalSignals.snapshotCount} captures with ${signals.slice(0, 2).join(" and ")}.`
    : `Recent history spans ${temporalSignals.snapshotCount} captures with steady continuity.`;
}

function summarizeRanking(ranked, strategy) {
  const topScores = softmaxScores(ranked.slice(0, 4).map((entry) => entry.score));
  return ranked.slice(0, 4).map((entry, index) => ({
    id: entry.id,
    label: entry.label,
    confidence: Number((topScores[index] || 0).toFixed(2)),
    strategy
  }));
}

function buildBenchmarkMetrics(strategy, examples, predict) {
  if (examples.length === 0) {
    return {
      strategy,
      datasetSize: 0,
      top1Accuracy: 0,
      top3Accuracy: 0,
      averageConfidence: 0,
      perIntent: [],
      confusion: {},
      calibration: []
    };
  }

  let top1Hits = 0;
  let top3Hits = 0;
  let confidenceTotal = 0;
  const confusion = {};
  const intentMetrics = new Map();
  const calibrationBuckets = new Map();

  examples.forEach((example) => {
    const prediction = predict(example.snapshot, strategy);
    const predictedId = prediction.predictedIntent.id;
    const alternatives = [prediction.predictedIntent.id, ...prediction.alternativeIntents.map((entry) => entry.id)];
    confidenceTotal += prediction.predictedIntent.confidence || 0;

    if (predictedId === example.intentId) {
      top1Hits += 1;
    }
    if (alternatives.includes(example.intentId)) {
      top3Hits += 1;
    }

    if (!confusion[example.intentId]) {
      confusion[example.intentId] = {};
    }
    confusion[example.intentId][predictedId] = (confusion[example.intentId][predictedId] || 0) + 1;

    const bucketKey = prediction.predictedIntent.confidence >= 0.85
      ? "0.85-1.00"
      : prediction.predictedIntent.confidence >= 0.7
        ? "0.70-0.84"
        : prediction.predictedIntent.confidence >= 0.55
          ? "0.55-0.69"
          : "0.00-0.54";
    const bucket = calibrationBuckets.get(bucketKey) || { bucket: bucketKey, total: 0, correct: 0 };
    bucket.total += 1;
    if (predictedId === example.intentId) {
      bucket.correct += 1;
    }
    calibrationBuckets.set(bucketKey, bucket);

    const actualIntent = intentMetrics.get(example.intentId) || { actual: example.intentId, tp: 0, fp: 0, fn: 0 };
    if (predictedId === example.intentId) {
      actualIntent.tp += 1;
    } else {
      actualIntent.fn += 1;
      const predictedIntent = intentMetrics.get(predictedId) || { actual: predictedId, tp: 0, fp: 0, fn: 0 };
      predictedIntent.fp += 1;
      intentMetrics.set(predictedId, predictedIntent);
    }
    intentMetrics.set(example.intentId, actualIntent);
  });

  return {
    strategy,
    datasetSize: examples.length,
    top1Accuracy: Number((top1Hits / examples.length).toFixed(2)),
    top3Accuracy: Number((top3Hits / examples.length).toFixed(2)),
    averageConfidence: Number((confidenceTotal / examples.length).toFixed(2)),
    perIntent: [...intentMetrics.values()].map((entry) => ({
      intentId: entry.actual,
      precision: Number((entry.tp / Math.max(entry.tp + entry.fp, 1)).toFixed(2)),
      recall: Number((entry.tp / Math.max(entry.tp + entry.fn, 1)).toFixed(2))
    })),
    confusion,
    calibration: [...calibrationBuckets.values()].map((bucket) => ({
      bucket: bucket.bucket,
      total: bucket.total,
      accuracy: Number((bucket.correct / Math.max(bucket.total, 1)).toFixed(2))
    }))
  };
}

export function createAnalysisEngine({ taxonomyPath, trainingExamplesPath, modelArtifactPath, staleThresholdMinutes }) {
  const intents = safeReadJson(taxonomyPath, []);
  const seedExamples = safeReadJson(trainingExamplesPath, [])
    .filter((example) => example?.intentId && example?.snapshot)
    .map((example) => ({
      intentId: example.intentId,
      snapshot: normalizeSnapshot(example.snapshot, {
        sourceType: example.snapshot?.sourceType || "seed-example",
        channel: example.snapshot?.channel || "seed-example"
      })
  }));
  const prototypeModel = createPrototypeModel({ taxonomyPath, trainingExamplesPath });
  const semanticClassifier = createSemanticClassifier({ taxonomyPath, trainingExamplesPath });
  const trainableModel = createTrainableModel({ taxonomyPath, trainingExamplesPath, modelArtifactPath });

  function rankSnapshot(snapshot, options = {}) {
    const { snapshot: sanitized, privacySummary } = sanitizeSnapshot(normalizeSnapshot(snapshot, {
      sourceType: snapshot?.sourceType || snapshot?.context?.sourceType || "manual-api",
      channel: snapshot?.channel || snapshot?.context?.channel || "manual-api"
    }));
    const entries = flattenTraces(sanitized);
    const feedbackProfiles = buildFeedbackProfiles(options.feedbackExamples || []);
    const prototypeRanking = prototypeModel.rankSnapshot(sanitized, options.feedbackExamples || []);
    const semanticRanking = semanticClassifier.rankSnapshot(sanitized, options.feedbackExamples || []);
    const trainableRanking = trainableModel.rankSnapshot(sanitized);
    const prototypeByIntent = new Map(prototypeRanking.ranked.map((entry) => [entry.id, entry]));
    const semanticByIntent = new Map(semanticRanking.ranked.map((entry) => [entry.id, entry]));
    const trainableByIntent = new Map(trainableRanking.ranked.map((entry) => [entry.id, entry]));
    const temporalSignals = buildTemporalSignals(options.temporalHistory || []);

    const ranked = intents
      .map((intent) => {
        const rule = scoreIntent(intent, entries, sanitized.metrics, sanitized.context, sanitized, feedbackProfiles, temporalSignals);
        const prototype = prototypeByIntent.get(intent.id) || {
          similarity: 0,
          prototypeSignals: [],
          trainingCount: 0
        };
        const semantic = semanticByIntent.get(intent.id) || {
          similarity: 0,
          semanticSignals: [],
          trainingCount: 0
        };
        const trainable = trainableByIntent.get(intent.id) || {
          similarity: 0,
          artifactSignals: [],
          trainingCount: 0
        };

        const strategy = options.modeOverride || MODEL_VERSION;
        let score = rule.ruleScore + computeTemporalBoost(intent, temporalSignals);

        if (strategy === "prototype-v1") {
          score = prototype.similarity * 8.2 + Math.min(prototype.trainingCount * 0.08, 0.55);
        } else if (strategy === "semantic-v1") {
          score = semantic.similarity * 8.6 + Math.min(semantic.trainingCount * 0.08, 0.55);
        } else if (strategy === "trainable-v1") {
          score = trainable.similarity * 9.2 + Math.min(trainable.trainingCount * 0.08, 0.75);
        } else if (strategy === "rules-v2") {
          score = rule.ruleScore + computeTemporalBoost(intent, temporalSignals);
        } else {
          score = rule.ruleScore
            + prototype.similarity * 5.2
            + semantic.similarity * 5.0
            + trainable.similarity * 5.4
            + Math.min((prototype.trainingCount + semantic.trainingCount + trainable.trainingCount) * 0.04, 0.82)
            + computeTemporalBoost(intent, temporalSignals);
        }

        return {
          ...rule,
          prototypeScore: prototype.similarity,
          semanticScore: semantic.similarity,
          trainableScore: trainable.similarity,
          prototypeSignals: formatOverlapSignals(prototype.prototypeSignals),
          semanticSignals: formatOverlapSignals(semantic.semanticSignals),
          artifactSignals: formatOverlapSignals(trainable.artifactSignals),
          trainingCount: Math.max(prototype.trainingCount, semantic.trainingCount, trainable.trainingCount),
          score
        };
      })
      .sort((left, right) => right.score - left.score);

    return {
      ranked,
      sanitized,
      privacySummary,
      temporalSignals,
      prototypeRanking,
      semanticRanking,
      trainableRanking
    };
  }

  function analyze(snapshot, options = {}) {
    const ranking = rankSnapshot(snapshot, options);
    const { ranked, sanitized, privacySummary, temporalSignals, prototypeRanking, semanticRanking, trainableRanking } = ranking;
    const winner = ranked[0];
    const runnerUp = ranked[1] || { score: 0 };
    const scoreDistribution = softmaxScores(ranked.slice(0, 4).map((entry) => entry.score));
    const rawConfidence = clamp(0.28 + scoreDistribution[0] * 0.62 + Math.min(winner.score - runnerUp.score, 4) * 0.04, 0.12, 0.97);
    const calibration = getConfidenceCalibration(winner.score, runnerUp.score, rawConfidence, prototypeRanking.signalQuality.band);

    const occurredAt = new Date(sanitized.occurredAt).getTime();
    const ageMinutes = Number.isFinite(occurredAt) ? Math.max(0, (Date.now() - occurredAt) / 60000) : 0;
    const idleMinutes = Math.max(ageMinutes, sanitized.metrics.idleMinutes || 0);
    const isStale = idleMinutes >= staleThresholdMinutes;

    const evidence = [
      calibration.uncertain
        ? `${calibration.reason} Current best match leans toward ${winner.label.toLowerCase()}.`
        : `The strongest signal cluster matches ${winner.label.toLowerCase()}.`,
      `Recovery focus points to ${winner.recoveryFocus}.`,
      buildTemporalSummary(temporalSignals),
      ...winner.prototypeSignals.map((signal) => `prototype overlap: ${signal}`),
      ...winner.semanticSignals.map((signal) => `semantic overlap: ${signal}`),
      ...winner.artifactSignals.map((signal) => `trained-model overlap: ${signal}`),
      ...winner.matches.map((match) => `${match.field}: ${match.text}`)
    ].slice(0, 9);

    const alternatives = summarizeRanking(ranked, options.modeOverride || MODEL_VERSION).slice(1, 3);

    const traceSummary = Object.fromEntries(
      Object.entries(sanitized.traces).map(([key, values]) => [key, values.length])
    );

    return {
      modelVersion: options.modeOverride || MODEL_VERSION,
      predictedIntent: {
        id: winner.id,
        label: winner.label,
        confidence: calibration.confidence,
        confidenceBand: calibration.band,
        uncertain: calibration.uncertain,
        uncertaintyReason: calibration.reason,
        recoveryFocus: winner.recoveryFocus
      },
      alternativeIntents: alternatives,
      evidence,
      suggestedNextSteps: calibration.uncertain
        ? [`Confidence is ${calibration.band}. Review the strongest evidence before acting.`, ...winner.nextSteps.slice(0, 2)]
        : winner.nextSteps,
      privacySummary,
      traceSummary,
      staleAssessment: {
        isStale,
        idleMinutes: Number(idleMinutes.toFixed(1)),
        thresholdMinutes: staleThresholdMinutes
      },
      behaviorMetrics: sanitized.metrics,
      temporalSummary: {
        snapshotCount: temporalSignals.snapshotCount,
        continuityScore: Number(temporalSignals.continuityScore.toFixed(2)),
        summary: buildTemporalSummary(temporalSignals)
      },
      modelDiagnostics: {
        modelVersion: options.modeOverride || MODEL_VERSION,
        signalQuality: prototypeRanking.signalQuality,
        winnerModelScore: Number(winner.prototypeScore.toFixed(3)),
        winnerSemanticScore: Number(winner.semanticScore.toFixed(3)),
        winnerTrainableScore: Number(winner.trainableScore.toFixed(3)),
        winnerRuleScore: Number(winner.ruleScore.toFixed(3)),
        trainingExamples: winner.trainingCount,
        artifact: trainableModel.getArtifactStats()
      },
      browserClusterSummary: sanitized.traces.browserClusters.slice(0, 4),
      sanitizedSnapshotPreview: {
        browserTabs: sanitized.traces.browserTabs.slice(0, 5),
        browserClusters: sanitized.traces.browserClusters.slice(0, 4),
        fileActivity: sanitized.traces.fileActivity.slice(0, 5),
        terminalHistory: sanitized.traces.terminalHistory.slice(0, 5),
        draftNotes: sanitized.traces.draftNotes.slice(0, 4),
        appFocus: sanitized.traces.appFocus.slice(0, 4),
        activityTimeline: sanitized.traces.activityTimeline.slice(0, 8)
      }
    };
  }

  function benchmark(feedbackExamples = []) {
    const dynamicExamples = feedbackExamples
      .filter((example) => example?.intentId && example?.snapshot)
      .map((example) => ({
        intentId: example.intentId,
        snapshot: normalizeSnapshot(example.snapshot, {
          sourceType: example.snapshot?.sourceType || "feedback",
          channel: example.snapshot?.channel || "feedback"
        })
      }));
    const dataset = [...seedExamples, ...dynamicExamples];

    const strategies = ["rules-v2", "prototype-v1", "semantic-v1", "trainable-v1", MODEL_VERSION];
    const predict = (snapshot, strategy) => analyze(snapshot, {
      feedbackExamples,
      temporalHistory: [],
      modeOverride: strategy
    });

    return {
      modelVersion: MODEL_VERSION,
      datasetSize: dataset.length,
      generatedAt: new Date().toISOString(),
      artifact: trainableModel.getArtifactStats(),
      runs: strategies.map((strategy) => buildBenchmarkMetrics(strategy, dataset, predict))
    };
  }

  return {
    modelVersion: MODEL_VERSION,
    listIntents() {
      return intents.map((intent) => ({
        id: intent.id,
        label: intent.label,
        recoveryFocus: intent.recoveryFocus
      }));
    },
    getModelStats(feedbackExamples = []) {
      const prototypeStats = prototypeModel.getTrainingStats(feedbackExamples);
      const semanticStats = semanticClassifier.getTrainingStats(feedbackExamples);
      const trainableStats = trainableModel.getArtifactStats();
      return {
        modelVersion: MODEL_VERSION,
        seedExamples: prototypeStats.seedExamples,
        dynamicExamples: prototypeStats.dynamicExamples,
        semanticVocabularyCoverage: semanticStats.vocabularyCoverage,
        intentCoverage: prototypeStats.intentCoverage,
        artifact: trainableStats
      };
    },
    trainModel(feedbackExamples = [], datasetLabel = "seed-plus-feedback") {
      return trainableModel.trainAndPersist(feedbackExamples, datasetLabel);
    },
    reloadModelArtifact() {
      return trainableModel.reloadArtifact();
    },
    benchmark,
    analyze
  };
}
