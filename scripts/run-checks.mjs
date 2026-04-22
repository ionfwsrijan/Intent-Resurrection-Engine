import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    return stats.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

const jsFiles = walk(root)
  .filter((file) => /\.(mjs|js)$/i.test(file))
  .filter((file) => !file.includes(`${path.sep}data${path.sep}`));

for (const file of jsFiles) {
  const source = readFileSync(file, "utf8");
  try {
    const scriptSource = file.endsWith(".mjs")
      ? `(async () => {\n${source
          .replace(/^\s*import\s.+?;?\s*$/gm, "")
          .replace(/^\s*export\s+/gm, "")}\n})();`
      : source;

    new vm.Script(scriptSource, { filename: file });
  } catch (error) {
    throw new Error(`Syntax check failed for ${file}: ${error.message}`);
  }
}

const intents = JSON.parse(readFileSync(path.join(root, "config", "intents.json"), "utf8"));
if (!Array.isArray(intents) || intents.length < 4) {
  throw new Error("Intent taxonomy must contain at least four intents.");
}

for (const intent of intents) {
  if (!intent.id || !intent.label || !Array.isArray(intent.keywords) || !Array.isArray(intent.nextSteps)) {
    throw new Error(`Invalid intent definition for ${intent.id || "unknown-intent"}`);
  }
}

const trainingExamples = JSON.parse(readFileSync(path.join(root, "config", "training-examples.json"), "utf8"));
if (!Array.isArray(trainingExamples) || trainingExamples.length < 20) {
  throw new Error("Training examples must contain at least twenty seed examples.");
}

const validIntentIds = new Set(intents.map((intent) => intent.id));
for (const example of trainingExamples) {
  if (!example.intentId || !validIntentIds.has(example.intentId) || !example.snapshot) {
    throw new Error(`Invalid training example for ${example.intentId || "unknown-intent"}`);
  }
}

const workflowDir = path.join(root, "n8n", "workflows");
const workflowFiles = readdirSync(workflowDir).filter((file) => file.endsWith(".json"));
for (const file of workflowFiles) {
  const workflow = JSON.parse(readFileSync(path.join(workflowDir, file), "utf8"));
  if (!workflow.name || !Array.isArray(workflow.nodes) || !workflow.connections) {
    throw new Error(`Invalid n8n workflow structure in ${file}`);
  }
}

console.log(`Checked ${jsFiles.length} JavaScript files, ${workflowFiles.length} workflows, the intent taxonomy, and ${trainingExamples.length} seed training examples.`);
