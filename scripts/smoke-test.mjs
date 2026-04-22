import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServerApp } from "../server/app.mjs";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "intent-engine-"));
const databasePath = path.join(tempDir, "smoke.db");
const webhookEvents = [];
const webhookServer = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  webhookEvents.push(body);
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});

await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
const webhookAddress = webhookServer.address();
const webhookUrl = `http://127.0.0.1:${webhookAddress.port}/hooks/intent`;

const app = await createServerApp({
  databasePath,
  port: 0,
  host: "127.0.0.1",
  appBaseUrl: "http://127.0.0.1",
  publicIngestionWebhookUrl: "http://localhost:5678/webhook/intent-resurrection-engine/ingest",
  publicStaleMonitorWebhookUrl: "http://localhost:5678/webhook/intent-resurrection-engine/stale-monitor",
  sessionIdleMinutes: 45
});

await app.listen();

try {
  const baseUrl = app.baseUrl;

  const workspaceResponse = await fetch(`${baseUrl}/api/v1/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Operations Lab",
      rootPath: "D:/Work/ops-lab",
      description: "Smoke-test workspace",
      notificationDestination: webhookUrl,
      notificationDigestMinutes: 30,
      notificationQuietStart: "12:00",
      notificationQuietEnd: "12:30",
      notificationIntentIds: ["auth_debugging"],
      notificationMinIdleMinutes: 45
    })
  });
  const workspace = await workspaceResponse.json();

  const sourceResponse = await fetch(`${baseUrl}/api/v1/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: workspace.workspace.id,
      type: "windows-workspace-collector",
      name: "Primary Windows Collector"
    })
  });
  const source = await sourceResponse.json();

  const ingestionResponse = await fetch(`${baseUrl}/api/v1/ingestion/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Source-Token": source.source.plaintextToken
    },
    body: JSON.stringify({
      sessionId: "smoke-session-001",
      title: "Investigating auth expiry in production",
      channel: "smoke-test",
      occurredAt: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
      metrics: {
        idleMinutes: 70,
        pauseRatio: 0.18,
        typingBurstScore: 0.89,
        focusSwitchCount: 13,
        interruptionCount: 5
      },
      traces: {
        browserTabs: [
          { title: "JWT refresh race condition", url: "https://docs.example.com/auth-refresh" },
          { title: "401 invalid token after refresh" }
        ],
        terminalHistory: [
          { command: "pnpm test auth -- --watch" },
          { command: "curl https://api.example.com/me -H \"Authorization: Bearer demo\"" }
        ],
        draftNotes: [
          { text: "Users are dropped after refresh token rotates." }
        ],
        clipboardFragments: [
          { text: "401 invalid token after refresh" }
        ],
        fileActivity: [
          { path: "src/auth/refresh.ts", status: "modified" }
        ],
        gitStatus: [
          { path: "src/auth/refresh.ts", status: "M" }
        ]
      },
      context: {
        rootPath: "D:/Work/ops-lab",
        branch: "fix/auth-refresh",
        hostname: "smoke-host"
      }
    })
  });
  const ingested = await ingestionResponse.json();

  const analysisResponse = await fetch(`${baseUrl}/api/v1/analysis/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: ingested.session.id })
  });
  const analysis = await analysisResponse.json();

  if (!analysis.analysis?.predictedIntent?.id) {
    throw new Error("Analysis did not return a predicted intent.");
  }

  await fetch(`${baseUrl}/api/v1/analysis/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: ingested.session.id })
  });

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/dashboard`);
  const dashboard = await dashboardResponse.json();

  if (!dashboard.metrics || dashboard.metrics.workspaces < 1 || dashboard.metrics.sources < 1) {
    throw new Error("Dashboard metrics were not populated.");
  }

  const comparisonResponse = await fetch(`${baseUrl}/api/v1/sessions/${ingested.session.id}/comparison`);
  const comparison = await comparisonResponse.json();
  if (!comparison.comparison?.changeSummary) {
    throw new Error("Comparison API did not return a change summary.");
  }

  const timelineResponse = await fetch(`${baseUrl}/api/v1/sessions/${ingested.session.id}/timeline`);
  const timeline = await timelineResponse.json();
  if (!Array.isArray(timeline.timeline) || timeline.timeline.length < 1) {
    throw new Error("Timeline API did not return recent capture history.");
  }

  const pinResponse = await fetch(`${baseUrl}/api/v1/sessions/${ingested.session.id}/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned: true })
  });
  const pinned = await pinResponse.json();
  if (!pinned.session?.pinned) {
    throw new Error("Session pin API did not persist the pinned state.");
  }

  const feedbackResponse = await fetch(`${baseUrl}/api/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: ingested.session.id,
      verdict: "correct",
      note: "Smoke test feedback"
    })
  });
  const feedback = await feedbackResponse.json();
  if (!feedback.feedback?.id) {
    throw new Error("Feedback API did not create an entry.");
  }

  const evaluationResponse = await fetch(`${baseUrl}/api/v1/evaluations/summary`);
  const evaluation = await evaluationResponse.json();
  if ((evaluation.summary?.labeledSessions || 0) < 1) {
    throw new Error("Evaluation summary did not count labeled sessions.");
  }

  const benchmarkResponse = await fetch(`${baseUrl}/api/v1/benchmarks/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const benchmark = await benchmarkResponse.json();
  if ((benchmark.run?.results?.datasetSize || 0) < 1) {
    throw new Error("Benchmark route did not produce a stored run.");
  }

  const analyticsResponse = await fetch(`${baseUrl}/api/v1/analytics`);
  const analytics = await analyticsResponse.json();
  if ((analytics.benchmarkRuns?.length || 0) < 1 || analytics.modelVersion !== "hybrid-v6-trainable") {
    throw new Error("Analytics route did not include benchmark or model-version data.");
  }

  const staleResponse = await fetch(`${baseUrl}/api/v1/automations/stale-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idleMinutes: 45 })
  });
  const stale = await staleResponse.json();

  if (!Array.isArray(stale.notifications) || stale.notifications.length < 1) {
    throw new Error("Stale-session automation did not produce notifications.");
  }

  const dispatchResponse = await fetch(`${baseUrl}/api/v1/notifications/dispatch-ready`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const dispatch = await dispatchResponse.json();
  if ((dispatch.delivered || 0) < 1 || webhookEvents.length < 1) {
    throw new Error("Notification dispatch route did not deliver any webhook events.");
  }

  const notificationLogsResponse = await fetch(`${baseUrl}/api/v1/notifications/logs`);
  const notificationLogs = await notificationLogsResponse.json();
  if ((notificationLogs.logs?.length || 0) < 1) {
    throw new Error("Notification logs route did not return delivery history.");
  }

  const exportResponse = await fetch(`${baseUrl}/api/v1/export/sessions`);
  const bundle = await exportResponse.json();
  if (!Array.isArray(bundle.sessions) || bundle.sessions.length < 1) {
    throw new Error("Session export did not return any sessions.");
  }

  const importedWorkspaceResponse = await fetch(`${baseUrl}/api/v1/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Benchmark Imports",
      rootPath: "D:/Work/benchmark-imports",
      description: "Workspace for import smoke test"
    })
  });
  const importedWorkspace = await importedWorkspaceResponse.json();

  const importResponse = await fetch(`${baseUrl}/api/v1/import/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: importedWorkspace.workspace.id,
      sessions: bundle.sessions.slice(0, 1).map((session) => ({
        ...session,
        latestSnapshot: {
          ...session.latestSnapshot,
          sessionId: `${session.sessionId}-imported`
        }
      }))
    })
  });
  const imported = await importResponse.json();
  if (!Array.isArray(imported.imported) || imported.imported.length !== 1) {
    throw new Error("Session import did not report the expected imported count.");
  }

  console.log("Smoke test passed.");
} finally {
  await app.close();
  await new Promise((resolve) => webhookServer.close(resolve));
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
  }
}
