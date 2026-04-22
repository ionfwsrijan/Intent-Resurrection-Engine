import { resolveConfig } from "../server/config.mjs";
import { createStore } from "../server/db.mjs";
import { trainModelArtifact } from "../server/services/trainable-model.mjs";

function parseArg(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const config = resolveConfig();
const datasetLabel = parseArg("--dataset-label", "seed-plus-feedback");
const databasePath = parseArg("--database", config.databasePath);
const artifactPath = parseArg("--artifact", config.modelArtifactPath);
const store = createStore(databasePath);

try {
  const feedbackExamples = store.listFeedbackExamples();
  const artifact = trainModelArtifact({
    taxonomyPath: config.taxonomyPath,
    trainingExamplesPath: config.trainingExamplesPath,
    modelArtifactPath: artifactPath,
    feedbackExamples,
    datasetLabel
  });

  console.log(JSON.stringify({
    modelVersion: artifact.modelVersion,
    outputPath: artifactPath,
    datasetLabel: artifact.datasetLabel,
    createdAt: artifact.createdAt,
    splitSummary: artifact.splitSummary,
    metrics: artifact.metrics
  }, null, 2));
} finally {
  store.close();
}
