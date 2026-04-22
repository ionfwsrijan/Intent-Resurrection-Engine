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

function normalizeExampleSnapshot(example) {
  return normalizeSnapshot(example.snapshot || {}, {
    sourceType: example.snapshot?.sourceType || "seed-example",
    channel: example.snapshot?.channel || "seed-example"
  });
}

function collectDocumentTerms(snapshot) {
  const traces = snapshot.traces || {};
  const terms = [];

  const addTerms = (value, weight = 1, prefix = "") => {
    tokenize(value).forEach((token) => {
      for (let index = 0; index < weight; index += 1) {
        terms.push(`${prefix}${token}`);
      }
      terms.push(token);
    });
  };

  addTerms(snapshot.title || "", 3, "title:");
  addTerms(snapshot.context?.rootPath || "", 2, "path:");
  addTerms(snapshot.context?.branch || "", 2, "branch:");

  (traces.browserTabs || []).forEach((tab) => {
    const weight = tab.active ? 3 : 2;
    addTerms(tab.title || "", weight, "tab:");
    addTerms(tab.url || "", 1, "url:");
    const host = extractHost(tab.url || "");
    if (host) {
      terms.push(`host:${host}`);
    }
  });

  (traces.browserClusters || []).forEach((cluster) => {
    addTerms(cluster.label || "", 3, "cluster:");
    (cluster.sampleTitles || []).forEach((title) => addTerms(title, 1, "cluster-title:"));
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

function buildVector(terms, documentFrequency, totalDocs) {
  const tf = new Map();
  terms.forEach((term) => {
    tf.set(term, (tf.get(term) || 0) + 1);
  });

  const vector = new Map();
  const totalTerms = terms.length || 1;
  tf.forEach((count, term) => {
    const idf = Math.log((1 + totalDocs) / (1 + (documentFrequency.get(term) || 0))) + 1;
    vector.set(term, (count / totalTerms) * idf);
  });
  return vector;
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

export function createSemanticClassifier({ taxonomyPath, trainingExamplesPath }) {
  const taxonomy = safeReadJson(taxonomyPath, []);
  const seedExamples = safeReadJson(trainingExamplesPath, [])
    .filter((example) => example?.intentId && example?.snapshot)
    .map((example) => ({
      intentId: example.intentId,
      snapshot: normalizeExampleSnapshot(example)
    }));

  function buildCorpus(dynamicExamples = []) {
    const taxonomyDocs = taxonomy.map((intent) => ({
      intentId: intent.id,
      terms: collectDocumentTerms(normalizeSnapshot({
        title: intent.label,
        traces: {
          draftNotes: [{ text: intent.recoveryFocus || "" }],
          clipboardFragments: [],
          terminalHistory: [],
          browserTabs: [],
          browserClusters: [],
          fileActivity: [],
          gitStatus: [],
          appFocus: [],
          activityTimeline: []
        },
        context: {
          rootPath: "",
          branch: ""
        }
      }, {
        sourceType: "taxonomy",
        channel: "taxonomy"
      }))
    }));

    const exampleDocs = [
      ...seedExamples.map((example) => ({
        intentId: example.intentId,
        terms: collectDocumentTerms(example.snapshot)
      })),
      ...dynamicExamples
        .filter((example) => example?.intentId && example?.snapshot)
        .map((example) => ({
          intentId: example.intentId,
          terms: collectDocumentTerms(normalizeSnapshot(example.snapshot, {
            sourceType: example.snapshot?.sourceType || "feedback",
            channel: example.snapshot?.channel || "feedback"
          }))
        }))
    ];

    return [...taxonomyDocs, ...exampleDocs];
  }

  function buildIntentCentroids(dynamicExamples = []) {
    const corpus = buildCorpus(dynamicExamples);
    const documentFrequency = buildDocumentFrequency(corpus.map((entry) => entry.terms));
    const totalDocs = corpus.length || 1;

    return taxonomy.map((intent) => {
      const vectors = corpus
        .filter((entry) => entry.intentId === intent.id)
        .map((entry) => buildVector(entry.terms, documentFrequency, totalDocs));

      return {
        id: intent.id,
        label: intent.label,
        trainingCount: Math.max(vectors.length - 1, 0),
        centroid: averageVectors(vectors)
      };
    });
  }

  return {
    getTrainingStats(dynamicExamples = []) {
      const centroids = buildIntentCentroids(dynamicExamples);
      return {
        seedExamples: seedExamples.length,
        dynamicExamples: dynamicExamples.length,
        vocabularyCoverage: centroids.reduce((sum, centroid) => sum + centroid.centroid.size, 0),
        intentCoverage: centroids.map((centroid) => ({
          id: centroid.id,
          trainingCount: centroid.trainingCount
        }))
      };
    },
    rankSnapshot(snapshot, dynamicExamples = []) {
      const normalized = normalizeSnapshot(snapshot, {
        sourceType: snapshot?.sourceType || snapshot?.context?.sourceType || "manual-api",
        channel: snapshot?.channel || snapshot?.context?.channel || "manual-api"
      });
      const centroids = buildIntentCentroids(dynamicExamples);
      const snapshotTerms = collectDocumentTerms(normalized);
      const corpus = buildCorpus(dynamicExamples);
      const documentFrequency = buildDocumentFrequency(corpus.map((entry) => entry.terms));
      const totalDocs = corpus.length || 1;
      const snapshotVector = buildVector(snapshotTerms, documentFrequency, totalDocs);

      return {
        ranked: centroids
          .map((centroid) => ({
            id: centroid.id,
            label: centroid.label,
            similarity: Number(cosineSimilarity(snapshotVector, centroid.centroid).toFixed(4)),
            trainingCount: centroid.trainingCount,
            semanticSignals: describeOverlap(snapshotVector, centroid.centroid)
          }))
          .sort((left, right) => right.similarity - left.similarity)
      };
    }
  };
}
