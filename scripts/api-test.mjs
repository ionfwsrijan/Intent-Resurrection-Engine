import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServerApp } from "../server/app.mjs";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "intent-engine-api-"));
const databasePath = path.join(tempDir, "api.db");
const modelArtifactPath = path.join(tempDir, "artifact.json");

const app = await createServerApp({
  databasePath,
  modelArtifactPath,
  port: 0,
  host: "127.0.0.1",
  appBaseUrl: "http://127.0.0.1",
  authRequired: true
});

await app.listen();

async function jsonRequest(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }
  return data;
}

try {
  const baseUrl = app.baseUrl;
  const bootstrap = await jsonRequest(baseUrl, "/api/v1/auth/bootstrap-admin", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@example.com",
      password: "strong-pass-123",
      name: "Admin"
    })
  });

  if (!bootstrap.token || !bootstrap.user?.id) {
    throw new Error("Bootstrap route did not issue a token.");
  }

  const authHeaders = {
    Authorization: `Bearer ${bootstrap.token}`
  };

  const workspace = await jsonRequest(baseUrl, "/api/v1/workspaces", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: "Secured Workspace",
      rootPath: "D:/Secured",
      notificationIntentIds: ["auth_debugging"]
    })
  });

  const source = await jsonRequest(baseUrl, "/api/v1/sources", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      workspaceId: workspace.workspace.id,
      type: "manual-api",
      name: "Authorized Source"
    })
  });

  await jsonRequest(baseUrl, "/api/v1/ingestion/session", {
    method: "POST",
    headers: {
      "X-Source-Token": source.source.plaintextToken
    },
    body: JSON.stringify({
      sessionId: "secured-session",
      title: "Secure auth debugging",
      channel: "manual-api",
      traces: {
        terminalHistory: [{ command: "pnpm test auth" }],
        fileActivity: [{ path: "src/auth/login.ts", status: "modified" }],
        draftNotes: [{ text: "session token rotation bug" }]
      },
      context: {
        rootPath: "D:/Secured",
        branch: "fix/auth-cookie"
      }
    })
  });

  await jsonRequest(baseUrl, "/api/v1/analysis/run", {
    method: "POST",
    body: JSON.stringify({ sessionId: "secured-session" })
  });

  const dashboard = await jsonRequest(baseUrl, "/api/v1/dashboard", {
    headers: authHeaders
  });
  if ((dashboard.workspaces?.length || 0) !== 1) {
    throw new Error("Dashboard did not filter secured workspaces correctly.");
  }

  const trained = await jsonRequest(baseUrl, "/api/v1/model/train", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({})
  });
  if (!trained.artifact?.createdAt) {
    throw new Error("Model train route did not persist an artifact.");
  }

  const reportResponse = await fetch(`${baseUrl}/api/v1/reports/analytics?format=markdown`, {
    headers: authHeaders
  });
  const report = await reportResponse.text();
  if (!report.includes("Intent Resurrection Engine Analytics Report")) {
    throw new Error("Analytics report route did not return markdown.");
  }

  const csvResponse = await fetch(`${baseUrl}/api/v1/reports/sessions.csv`, {
    headers: authHeaders
  });
  const csv = await csvResponse.text();
  if (!csv.includes("secured-session") && !csv.includes("Secure auth debugging")) {
    throw new Error("CSV session report did not include the secured session.");
  }

  console.log("API auth/report/model checks passed.");
} finally {
  await app.close();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
  }
}
