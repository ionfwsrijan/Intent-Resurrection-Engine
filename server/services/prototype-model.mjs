import { readFileSync } from "node:fs";
import { normalizeSnapshot } from "./normalizer.mjs";

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9+.#/_:-]+/)
    .filter((token) => token.length > 2);
}

function addWeight(vector, token, weight) {
  if (!token || !Number.isFinite(weight) || weight <= 0) {
    return;
  }
  vector.set(token, (vector.get(token) || 0) + weight);
}

function extractHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractExtension(filePath = "") {
  const fileName = String(filePath).split(/[\\/]/).pop() || "";
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function addTokens(vector, value, weight, prefix = "") {
  tokenize(value).forEach((token) => {
    addWeight(vector, `${prefix}${token}`, weight);
    addWeight(vector, token, Math.max(weight * 0.72, 0.18));
  });
}

function normalizeExampleSnapshot(example) {
  return normalizeSnapshot(example.snapshot || {}, {
    sourceType: example.snapshot?.sourceType || "seed-example",
    channel: example.snapshot?.channel || "seed-example"
  });
}

function vectorMagnitude(vector) {
  let total = 0;
  vector.forEach((value) => {
    total += value * value;
  });
  return Math.sqrt(total) || 1;
}

function cosineSimilarity(left, right) {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  smaller.forEach((value, key) => {
    const other = larger.get(key);
    if (other) {
      dot += value * other;
    }
  });
  return dot / (vectorMagnitude(left) * vectorMagnitude(right));
}

function averageVectors(vectors) {
  const centroid = new Map();
  if (vectors.length === 0) {
    return centroid;
  }

  vectors.forEach((vector) => {
    vector.forEach((value, key) => {
      centroid.set(key, (centroid.get(key) || 0) + value);
    });
  });

  centroid.forEach((value, key) => {
    centroid.set(key, value / vectors.length);
  });

  return centroid;
}

function getSignalQuality(snapshot) {
  const traces = snapshot.traces || {};
  const rawCount =
    (traces.browserTabs?.length || 0) * 1.1 +
    (traces.browserClusters?.length || 0) * 1.4 +
    (traces.fileActivity?.length || 0) * 1.2 +
    (traces.clipboardFragments?.length || 0) * 0.9 +
    (traces.terminalHistory?.length || 0) * 0.75 +
    (traces.draftNotes?.length || 0) * 1.1 +
    (traces.gitStatus?.length || 0) * 0.6 +
    (traces.appFocus?.length || 0) * 0.9 +
    (traces.activityTimeline?.length || 0) * 0.85;

  return {
    rawCount,
    band: rawCount >= 11 ? "high" : rawCount >= 5 ? "medium" : "low"
  };
}

function buildSnapshotVector(snapshot) {
  const vector = new Map();
  const traces = snapshot.traces || {};

  addTokens(vector, snapshot.title || "", 1.35, "title:");
  addTokens(vector, snapshot.context?.rootPath || "", 1.15, "path:");
  addTokens(vector, snapshot.context?.branch || "", 0.95, "branch:");

  (traces.browserTabs || []).forEach((tab) => {
    const activeWeight = tab.active ? 1.45 : 1.1;
    addTokens(vector, tab.title || "", activeWeight, "tab:");
    addTokens(vector, tab.url || "", activeWeight * 0.7, "url:");
    const host = extractHost(tab.url || "");
    if (host) {
      addWeight(vector, `host:${host}`, activeWeight * 1.2);
      host.split(".").forEach((part) => addWeight(vector, `hostpart:${part}`, activeWeight * 0.5));
    }
  });

  (traces.browserClusters || []).forEach((cluster) => {
    const clusterWeight = 1.4 + Math.min(Number(cluster.count || 1) * 0.15, 0.9);
    addTokens(vector, cluster.label || "", clusterWeight, "cluster:");
    (cluster.sampleTitles || []).forEach((title) => addTokens(vector, title, clusterWeight * 0.65, "cluster-title:"));
    (cluster.hosts || []).forEach((host) => addWeight(vector, `cluster-host:${String(host).toLowerCase()}`, clusterWeight * 0.9));
  });

  (traces.fileActivity || []).forEach((entry) => {
    addTokens(vector, entry.path || "", 1.2, "file:");
    addTokens(vector, entry.status || "", 0.4, "filestate:");
    const ext = extractExtension(entry.path || "");
    if (ext) {
      addWeight(vector, `ext:${ext}`, 1.25);
    }
  });

  (traces.clipboardFragments || []).forEach((entry) => addTokens(vector, entry.text || "", 0.95, "clip:"));
  (traces.terminalHistory || []).forEach((entry) => addTokens(vector, entry.command || "", 0.8, "cmd:"));
  (traces.draftNotes || []).forEach((entry) => addTokens(vector, entry.text || "", 1.05, "note:"));
  (traces.gitStatus || []).forEach((entry) => addTokens(vector, `${entry.status} ${entry.path}`, 0.75, "git:"));

  (traces.appFocus || []).forEach((entry) => {
    const focusWeight = entry.active ? 1.2 : 0.85;
    addTokens(vector, entry.app || "", focusWeight, "app:");
    addTokens(vector, entry.windowTitle || entry.title || "", focusWeight, "window:");
  });

  (traces.activityTimeline || []).forEach((entry) => {
    addTokens(vector, `${entry.kind || ""} ${entry.label || ""} ${entry.host || ""}`, 0.9, "timeline:");
  });

  return vector;
}

function buildPrototypeSeed(intent) {
  const vector = new Map();
  addTokens(vector, intent.label || "", 1.2, "label:");
  addTokens(vector, intent.recoveryFocus || "", 0.85, "focus:");
  (intent.keywords || []).forEach((keyword) => {
    addWeight(vector, keyword.toLowerCase(), 1.45);
    addWeight(vector, `keyword:${keyword.toLowerCase()}`, 1.3);
  });
  (intent.phrases || []).forEach((phrase) => addTokens(vector, phrase, 1.15, "phrase:"));
  (intent.nextSteps || []).forEach((step) => addTokens(vector, step, 0.45, "step:"));
  return vector;
}

function buildTopOverlapSignals(snapshotVector, prototypeVector) {
  return [...snapshotVector.entries()]
    .map(([token, value]) => ({
      token,
      score: value * (prototypeVector.get(token) || 0)
    }))
    .filter((entry) => entry.score > 0.08)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.token.replace(/^[a-z-]+:/, "").replace(/_/g, " "));
}

export function createPrototypeModel({ taxonomyPath, trainingExamplesPath }) {
  const taxonomy = safeReadJson(taxonomyPath, []);
  const seedExamples = safeReadJson(trainingExamplesPath, []);
  const normalizedSeedExamples = seedExamples
    .filter((example) => example?.intentId && example?.snapshot)
    .map((example) => ({
      intentId: example.intentId,
      snapshot: normalizeExampleSnapshot(example)
    }));

  function buildIntentPrototypes(dynamicExamples = []) {
    return taxonomy.map((intent) => {
      const vectors = [buildPrototypeSeed(intent)];

      normalizedSeedExamples
        .filter((example) => example.intentId === intent.id)
        .forEach((example) => vectors.push(buildSnapshotVector(example.snapshot)));

      dynamicExamples
        .filter((example) => example.intentId === intent.id && example.snapshot)
        .forEach((example) => vectors.push(buildSnapshotVector(normalizeSnapshot(example.snapshot, {
          sourceType: example.snapshot?.sourceType || "feedback",
          channel: example.snapshot?.channel || "feedback"
        }))));

      return {
        id: intent.id,
        label: intent.label,
        centroid: averageVectors(vectors),
        trainingCount: vectors.length - 1
      };
    });
  }

  return {
    getTrainingStats(dynamicExamples = []) {
      const prototypes = buildIntentPrototypes(dynamicExamples);
      return {
        seedExamples: normalizedSeedExamples.length,
        dynamicExamples: dynamicExamples.length,
        intentCoverage: prototypes.map((prototype) => ({
          id: prototype.id,
          trainingCount: prototype.trainingCount
        }))
      };
    },
    rankSnapshot(snapshot, dynamicExamples = []) {
      const normalized = normalizeSnapshot(snapshot, {
        sourceType: snapshot?.sourceType || snapshot?.context?.sourceType || "manual-api",
        channel: snapshot?.channel || snapshot?.context?.channel || "manual-api"
      });
      const snapshotVector = buildSnapshotVector(normalized);
      const prototypes = buildIntentPrototypes(dynamicExamples);
      const signalQuality = getSignalQuality(normalized);

      return {
        signalQuality,
        ranked: prototypes
          .map((prototype) => ({
            id: prototype.id,
            label: prototype.label,
            similarity: Number(cosineSimilarity(snapshotVector, prototype.centroid).toFixed(4)),
            trainingCount: prototype.trainingCount,
            prototypeSignals: buildTopOverlapSignals(snapshotVector, prototype.centroid)
          }))
          .sort((left, right) => right.similarity - left.similarity)
      };
    }
  };
}
