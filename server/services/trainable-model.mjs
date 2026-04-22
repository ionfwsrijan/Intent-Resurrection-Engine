import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeSnapshot } from "./normalizer.mjs";

const ARTIFACT_KIND = "intent-resurrection-centroid-v1";
const MODEL_VERSION = "trainable-v1";

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9+.#/_:-]+/)
    .filter((token) => token.length > 2);
}

function dedupeExamples(examples = []) {
  const seen = new Set();
  return examples.filter((example) => {
    const key = `${example.intentId}:${example.snapshot?.sessionId || example.snapshot?.title || JSON.stringify(example.snapshot || {})}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

function normalizeExampleSnapshot(example, sourceType = "training-example") {
  return normalizeSnapshot(example.snapshot || {}, {
    sourceType: example.snapshot?.sourceType || sourceType,
    channel: example.snapshot?.channel || sourceType
  });
}

function collectWeightedTerms(snapshot) {
  const traces = snapshot.traces || {};
  const terms = [];

  const addTerms = (value, weight = 1, prefix = "") => {
    tokenize(value).forEach((token) => {
      terms.push(token);
      if (prefix) {
        terms.push(`${prefix}${token}`);
      }
      for (let count = 1; count < weight; count += 1) {
        terms.push(token);
      }
    });
  };

  addTerms(snapshot.title || "", 3, "title:");
  addTerms(snapshot.context?.rootPath || "", 2, "path:");
  addTerms(snapshot.context?.branch || "", 2, "branch:");

  (traces.browserTabs || []).forEach((tab) => {
    const weight = tab.active ? 4 : 2;
    addTerms(tab.title || "", weight, "tab:");
    addTerms(tab.url || "", 1, "url:");
    const host = extractHost(tab.url || "");
    if (host) {
      terms.push(`host:${host}`);
    }
  });

  (traces.browserClusters || []).forEach((cluster) => {
    addTerms(cluster.label || "", 3, "cluster:");
    (cluster.sampleTitles || []).forEach((title) => addTerms(title, 2, "cluster-title:"));
    (cluster.hosts || []).forEach((host) => terms.push(`cluster-host:${String(host).toLowerCase()}`));
  });

  (traces.fileActivity || []).forEach((entry) => {
    addTerms(entry.path || "", 2, "file:");
    const extension = extractExtension(entry.path || "");
    if (extension) {
      terms.push(`ext:${extension}`);
    }
  });

  (traces.clipboardFragments || []).forEach((entry) => addTerms(entry.text || "", 1, "clip:"));
  (traces.terminalHistory || []).forEach((entry) => addTerms(entry.command || "", 1, "cmd:"));
  (traces.draftNotes || []).forEach((entry) => addTerms(entry.text || "", 2, "note:"));
  (traces.gitStatus || []).forEach((entry) => addTerms(`${entry.status} ${entry.path}`, 1, "git:"));
  (traces.appFocus || []).forEach((entry) => {
    addTerms(entry.app || "", 2, "app:");
    addTerms(entry.windowTitle || "", 1, "window:");
  });
  (traces.activityTimeline || []).forEach((entry) => {
    addTerms(`${entry.kind || ""} ${entry.label || ""} ${entry.host || ""}`, 1, "timeline:");
  });

  return terms;
}

function buildDocumentFrequency(documents) {
  const frequency = new Map();
  documents.forEach((terms) => {
    new Set(terms).forEach((term) => {
      frequency.set(term, (frequency.get(term) || 0) + 1);
    });
  });
  return frequency;
}

function buildVector(terms, vocabulary, idfMap) {
  const vector = new Map();
  const termCounts = new Map();

  terms.forEach((term) => {
    if (!vocabulary.has(term)) {
      return;
    }
    termCounts.set(term, (termCounts.get(term) || 0) + 1);
  });

  const totalTerms = [...termCounts.values()].reduce((sum, value) => sum + value, 0) || 1;
  termCounts.forEach((count, term) => {
    vector.set(term, (count / totalTerms) * (idfMap.get(term) || 1));
  });

  return vector;
}

function averageVectors(vectors) {
  const centroid = new Map();
  if (!vectors.length) {
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

function magnitude(vector) {
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
  return dot / (magnitude(left) * magnitude(right));
}

function softmax(values = []) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

function describeOverlap(snapshotVector, centroid) {
  return [...snapshotVector.entries()]
    .map(([term, value]) => ({
      term,
      score: value * (centroid.get(term) || 0)
    }))
    .filter((entry) => entry.score > 0.0008)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.term.replace(/^[a-z-]+:/, "").replace(/_/g, " "));
}

function stableOrderExamples(examples = []) {
  return [...examples].sort((left, right) => {
    const leftKey = `${left.intentId}:${left.snapshot?.sessionId || left.snapshot?.title || ""}`;
    const rightKey = `${right.intentId}:${right.snapshot?.sessionId || right.snapshot?.title || ""}`;
    return leftKey.localeCompare(rightKey);
  });
}

function splitExamples(examples = []) {
  const grouped = new Map();
  stableOrderExamples(examples).forEach((example) => {
    const bucket = grouped.get(example.intentId) || [];
    bucket.push(example);
    grouped.set(example.intentId, bucket);
  });

  const splits = {
    train: [],
    validation: [],
    test: []
  };

  grouped.forEach((entries) => {
    const size = entries.length;
    let trainCount = Math.max(1, Math.floor(size * 0.6));
    let validationCount = size >= 4 ? Math.max(1, Math.floor(size * 0.2)) : 0;
    let testCount = size - trainCount - validationCount;

    if (size >= 5 && testCount <= 0) {
      testCount = 1;
      trainCount = Math.max(1, trainCount - 1);
    }
    if (size >= 4 && validationCount <= 0) {
      validationCount = 1;
      if (trainCount > 1) {
        trainCount -= 1;
      }
    }

    const trainEnd = trainCount;
    const validationEnd = trainEnd + validationCount;
    splits.train.push(...entries.slice(0, trainEnd));
    splits.validation.push(...entries.slice(trainEnd, validationEnd));
    splits.test.push(...entries.slice(validationEnd));
  });

  return splits;
}

function buildVocabulary(trainDocuments, maxTerms = 900) {
  const counts = new Map();
  trainDocuments.forEach((document) => {
    document.terms.forEach((term) => {
      counts.set(term, (counts.get(term) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxTerms)
    .map(([term]) => term);
}

function buildCentroids(examples, vocabulary, idfMap, taxonomy) {
  const centroids = taxonomy.map((intent) => {
    const vectors = examples
      .filter((example) => example.intentId === intent.id)
      .map((example) => buildVector(example.terms, new Set(vocabulary), idfMap));
    const centroid = averageVectors(vectors);
    return {
      id: intent.id,
      label: intent.label,
      trainingCount: vectors.length,
      centroid: Object.fromEntries(centroid.entries())
    };
  });

  return centroids;
}

function scoreExample(example, artifact) {
  const vocabulary = new Set(artifact.vocabulary);
  const idfMap = new Map(Object.entries(artifact.idf || {}));
  const vector = buildVector(example.terms, vocabulary, idfMap);
  const ranked = artifact.centroids
    .map((centroid) => ({
      id: centroid.id,
      label: centroid.label,
      similarity: cosineSimilarity(vector, new Map(Object.entries(centroid.centroid || {}))),
      artifactSignals: describeOverlap(vector, new Map(Object.entries(centroid.centroid || {}))),
      trainingCount: centroid.trainingCount
    }))
    .sort((left, right) => right.similarity - left.similarity);

  return {
    ranked,
    confidence: softmax(ranked.slice(0, 4).map((entry) => entry.similarity || 0))
  };
}

function evaluateExamples(examples, artifact) {
  if (!examples.length) {
    return {
      datasetSize: 0,
      top1Accuracy: 0,
      top3Accuracy: 0,
      averageConfidence: 0,
      confusion: {}
    };
  }

  let top1 = 0;
  let top3 = 0;
  let confidenceTotal = 0;
  const confusion = {};

  examples.forEach((example) => {
    const prediction = scoreExample(example, artifact);
    const winner = prediction.ranked[0];
    const predictedIds = prediction.ranked.slice(0, 3).map((entry) => entry.id);
    confidenceTotal += prediction.confidence[0] || 0;

    if (winner?.id === example.intentId) {
      top1 += 1;
    }
    if (predictedIds.includes(example.intentId)) {
      top3 += 1;
    }

    if (!confusion[example.intentId]) {
      confusion[example.intentId] = {};
    }
    confusion[example.intentId][winner?.id || "unknown"] = (confusion[example.intentId][winner?.id || "unknown"] || 0) + 1;
  });

  return {
    datasetSize: examples.length,
    top1Accuracy: Number((top1 / examples.length).toFixed(2)),
    top3Accuracy: Number((top3 / examples.length).toFixed(2)),
    averageConfidence: Number((confidenceTotal / examples.length).toFixed(2)),
    confusion
  };
}

function normalizeExamples(examples = [], sourceType = "training-example") {
  return dedupeExamples(
    examples
      .filter((example) => example?.intentId && example?.snapshot)
      .map((example) => ({
        intentId: example.intentId,
        snapshot: normalizeExampleSnapshot(example, sourceType)
      }))
  ).map((example) => ({
    ...example,
    terms: collectWeightedTerms(example.snapshot)
  }));
}

function buildArtifact({ taxonomy, examples, datasetLabel }) {
  const splits = splitExamples(examples);
  const trainDocuments = splits.train.length ? splits.train : examples;
  const vocabulary = buildVocabulary(trainDocuments, 900);
  const vocabularySet = new Set(vocabulary);
  const documentFrequency = buildDocumentFrequency(trainDocuments.map((example) => example.terms.filter((term) => vocabularySet.has(term))));
  const totalDocs = trainDocuments.length || 1;
  const idf = Object.fromEntries(vocabulary.map((term) => [term, Math.log((1 + totalDocs) / (1 + (documentFrequency.get(term) || 0))) + 1]));
  const idfMap = new Map(Object.entries(idf));
  const centroids = buildCentroids(trainDocuments, vocabulary, idfMap, taxonomy);

  const artifact = {
    kind: ARTIFACT_KIND,
    modelVersion: MODEL_VERSION,
    datasetLabel,
    createdAt: new Date().toISOString(),
    splitSummary: {
      train: trainDocuments.length,
      validation: splits.validation.length,
      test: splits.test.length
    },
    vocabulary,
    idf,
    centroids
  };

  artifact.metrics = {
    validation: evaluateExamples(splits.validation, artifact),
    test: evaluateExamples(splits.test, artifact),
    training: evaluateExamples(trainDocuments, artifact)
  };
  return artifact;
}

export function trainModelArtifact({
  taxonomyPath,
  trainingExamplesPath,
  modelArtifactPath,
  feedbackExamples = [],
  datasetLabel = "seed-plus-feedback"
}) {
  const taxonomy = safeReadJson(taxonomyPath, []);
  const seedExamples = normalizeExamples(safeReadJson(trainingExamplesPath, []), "seed-example");
  const dynamicExamples = normalizeExamples(feedbackExamples, "feedback");
  const artifact = buildArtifact({
    taxonomy,
    examples: [...seedExamples, ...dynamicExamples],
    datasetLabel
  });

  if (modelArtifactPath) {
    writeJson(modelArtifactPath, artifact);
  }

  return artifact;
}

export function createTrainableModel({ taxonomyPath, trainingExamplesPath, modelArtifactPath }) {
  const taxonomy = safeReadJson(taxonomyPath, []);
  const seedExamples = normalizeExamples(safeReadJson(trainingExamplesPath, []), "seed-example");
  let artifact = safeReadJson(modelArtifactPath, null);

  if (!artifact || artifact.kind !== ARTIFACT_KIND) {
    artifact = buildArtifact({
      taxonomy,
      examples: seedExamples,
      datasetLabel: "seed-only"
    });
  }

  function ensureArtifact() {
    return artifact;
  }

  function rankSnapshot(snapshot) {
    const normalized = normalizeSnapshot(snapshot, {
      sourceType: snapshot?.sourceType || snapshot?.context?.sourceType || "manual-api",
      channel: snapshot?.channel || snapshot?.context?.channel || "manual-api"
    });
    const example = {
      intentId: "",
      snapshot: normalized,
      terms: collectWeightedTerms(normalized)
    };
    return {
      artifact: ensureArtifact(),
      ranked: scoreExample(example, ensureArtifact()).ranked
    };
  }

  function reloadArtifact() {
    const loaded = safeReadJson(modelArtifactPath, null);
    if (loaded?.kind === ARTIFACT_KIND) {
      artifact = loaded;
    }
    return artifact;
  }

  function trainAndPersist(feedbackExamples = [], datasetLabel = "seed-plus-feedback") {
    artifact = trainModelArtifact({
      taxonomyPath,
      trainingExamplesPath,
      modelArtifactPath,
      feedbackExamples,
      datasetLabel
    });
    return artifact;
  }

  function getArtifactStats() {
    const current = ensureArtifact();
    return {
      modelVersion: current.modelVersion,
      createdAt: current.createdAt,
      datasetLabel: current.datasetLabel,
      splitSummary: current.splitSummary,
      vocabularySize: current.vocabulary?.length || 0,
      metrics: current.metrics || {}
    };
  }

  return {
    modelVersion: MODEL_VERSION,
    rankSnapshot,
    trainAndPersist,
    reloadArtifact,
    getArtifactStats
  };
}
