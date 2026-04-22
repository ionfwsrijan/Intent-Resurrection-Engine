import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function assertContains(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`Expected ${label} to include ${needle}`);
  }
}

const indexHtml = read("frontend/index.html");
const analyticsHtml = read("frontend/analytics.html");
const loginHtml = read("frontend/login.html");
const appJs = read("frontend/app.js");
const analyticsJs = read("frontend/analytics.js");

assertContains(indexHtml, 'id="workspaceNotificationIntentIds"', "dashboard notification intent UI");
assertContains(indexHtml, 'src="./auth-client.js"', "dashboard auth bootstrap");
assertContains(analyticsHtml, 'id="trainModelButton"', "analytics train button");
assertContains(analyticsHtml, 'id="exportMarkdownButton"', "analytics markdown export");
assertContains(loginHtml, 'id="authForm"', "login form");
assertContains(appJs, "renderNotificationIntentChips", "dashboard chip rendering");
assertContains(analyticsJs, "/api/v1/model/train", "analytics train-model integration");

console.log("Frontend structural checks passed.");
