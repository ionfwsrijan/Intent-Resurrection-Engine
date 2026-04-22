import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { createStore } from "./db.mjs";
import { resolveConfig } from "./config.mjs";
import {
  badRequest,
  createTokenHash,
  json,
  notFound,
  readJsonBody,
  serveStatic,
  serverError,
} from "./lib/http.mjs";
import { normalizeSnapshot } from "./services/normalizer.mjs";
import { createAnalysisEngine } from "./services/analysis-engine.mjs";
import {
  createAuthSessionRecord,
  hashPassword,
  verifyPassword,
} from "./services/auth-service.mjs";
import { dispatchPendingNotifications } from "./services/notification-dispatcher.mjs";

function createPlaintextToken() {
  return `src_${randomBytes(18).toString("hex")}`;
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function getSourceToken(request, body = {}) {
  return (
    request.headers["x-source-token"] || body.sourceToken || body.token || ""
  );
}

function compareLists(current = [], previous = []) {
  const currentSet = new Set(current.map(String));
  const previousSet = new Set(previous.map(String));
  return {
    added: [...currentSet].filter((value) => !previousSet.has(value)),
    removed: [...previousSet].filter((value) => !currentSet.has(value)),
  };
}

function buildComparisonPayload(session, comparison) {
  if (!comparison?.latest || !comparison.previous) {
    return null;
  }

  const latestSummary = comparison.latest.summary || {};
  const previousSummary = comparison.previous.summary || {};
  const evidenceDelta = compareLists(
    latestSummary.evidence,
    previousSummary.evidence,
  );
  const nextStepDelta = compareLists(
    latestSummary.suggestedNextSteps,
    previousSummary.suggestedNextSteps,
  );

  return {
    sessionId: session.id,
    latestAnalysis: comparison.latest,
    previousAnalysis: comparison.previous,
    changeSummary: {
      intentChanged:
        comparison.latest.predictedIntent.id !==
        comparison.previous.predictedIntent.id,
      confidenceDelta: Number(
        (
          (comparison.latest.predictedIntent.confidence || 0) -
          (comparison.previous.predictedIntent.confidence || 0)
        ).toFixed(2),
      ),
      staleDeltaMinutes: Number(
        (
          (latestSummary.staleAssessment?.idleMinutes || 0) -
          (previousSummary.staleAssessment?.idleMinutes || 0)
        ).toFixed(1),
      ),
      evidenceDelta,
      nextStepDelta,
    },
  };
}

function normalizeFeedbackVerdict(verdict = "") {
  const normalized = String(verdict).trim().toLowerCase();
  return ["correct", "partial", "wrong"].includes(normalized) ? normalized : "";
}

function parseClockMinutes(value = "") {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function isWithinQuietHours(workspace, now = new Date()) {
  const start = parseClockMinutes(workspace?.notificationQuietStart);
  const end = parseClockMinutes(workspace?.notificationQuietEnd);
  if (start === null || end === null) {
    return false;
  }

  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) {
    return false;
  }
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function enrichNotificationLogs(store, logs) {
  return logs.map((entry) => {
    const workspace = store.getWorkspaceById(entry.workspaceId);
    const session = entry.sessionId
      ? store.getSessionById(entry.sessionId)
      : null;
    return {
      ...entry,
      workspaceName: workspace?.name || "",
      sessionTitle: session?.title || entry.payload?.sessionTitle || "",
    };
  });
}

function buildAnalyticsPayload(store, analyzer, userId = "") {
  const evaluationSummary = store.getEvaluationSummary(userId);
  const benchmarkRuns = store.listBenchmarkRuns(8);
  const notificationLogs = enrichNotificationLogs(
    store,
    store.listNotificationLogs(40, userId),
  );
  const modelStats = analyzer.getModelStats(
    store.listFeedbackExamples("", userId),
  );
  const recentSessions = store.listSessions(24, userId).map((session) => ({
    id: session.id,
    title: session.title,
    status: session.status,
    channel: session.channel,
    pinned: session.pinned,
    predictedIntent: session.latestAnalysis?.predictedIntent || null,
    timelineDepth: store.listSessionTimeline(session.id, 12, userId).length,
    lastActivityAt: session.lastActivityAt,
  }));

  return {
    modelVersion: analyzer.modelVersion,
    modelStats,
    evaluationSummary,
    benchmarkRuns,
    latestBenchmark: benchmarkRuns[0] || null,
    notificationLogs,
    intents: analyzer.listIntents(),
    recentSessions,
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toCsv(rows = []) {
  return rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
}

function buildAnalyticsReport(payload) {
  const hybridRun =
    payload.latestBenchmark?.results?.runs?.find((entry) =>
      entry.strategy.includes("hybrid"),
    ) || payload.latestBenchmark?.results?.runs?.[0];
  const lines = [
    "# Intent Resurrection Engine Analytics Report",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `Model version: ${payload.modelVersion}`,
    `Seed examples: ${payload.modelStats?.seedExamples || 0}`,
    `Dynamic labeled examples: ${payload.modelStats?.dynamicExamples || 0}`,
    `Labeled sessions: ${payload.evaluationSummary?.labeledSessions || 0}`,
    "",
  ];

  if (hybridRun) {
    lines.push("## Latest Benchmark");
    lines.push(`- Strategy: ${hybridRun.strategy}`);
    lines.push(
      `- Top-1 accuracy: ${Math.round((hybridRun.top1Accuracy || 0) * 100)}%`,
    );
    lines.push(
      `- Top-3 accuracy: ${Math.round((hybridRun.top3Accuracy || 0) * 100)}%`,
    );
    lines.push(
      `- Average confidence: ${Math.round((hybridRun.averageConfidence || 0) * 100)}%`,
    );
    lines.push("");
  }

  lines.push("## Recent Sessions");
  (payload.recentSessions || []).slice(0, 8).forEach((session) => {
    lines.push(
      `- ${session.title}: ${session.predictedIntent?.label || "No prediction"} · timeline depth ${session.timelineDepth}`,
    );
  });
  lines.push("");
  lines.push("## Notification Logs");
  (payload.notificationLogs || []).slice(0, 8).forEach((log) => {
    lines.push(
      `- ${log.workspaceName || log.workspaceId}: ${log.status} via ${log.destination} (${log.attemptCount || 0} attempts)`,
    );
  });

  return lines.join("\n");
}

function buildAnalyticsReportHtml(payload) {
  const rows = (payload.recentSessions || [])
    .slice(0, 10)
    .map(
      (session) =>
        `<tr><td>${escapeHtml(session.title)}</td><td>${escapeHtml(session.channel)}</td><td>${escapeHtml(session.predictedIntent?.label || "No prediction")}</td><td>${session.timelineDepth}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Intent Resurrection Engine Analytics Report</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #221b13; }
      h1, h2 { margin-bottom: 10px; }
      table { border-collapse: collapse; width: 100%; margin-top: 12px; }
      td, th { border: 1px solid #d8cbb8; padding: 8px; text-align: left; }
      th { background: #f4e8dc; }
      .meta { color: #65594d; margin-bottom: 18px; }
    </style>
  </head>
  <body>
    <h1>Intent Resurrection Engine Analytics Report</h1>
    <p class="meta">Generated ${escapeHtml(new Date().toLocaleString())} · model ${escapeHtml(payload.modelVersion)}</p>
    <h2>Recent Sessions</h2>
    <table>
      <thead>
        <tr><th>Session</th><th>Channel</th><th>Predicted intent</th><th>Timeline depth</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

function createSessionReportRows(sessions = []) {
  return sessions.map((session) => [
    session.title,
    session.channel,
    session.status,
    session.latestAnalysis?.predictedIntent?.label || "",
    session.latestAnalysis?.predictedIntent?.confidence || "",
    session.lastActivityAt,
  ]);
}

function buildPresentationPayload(store, analyzer, userId = "") {
  const dashboard = store.getDashboard(userId);
  const analytics = buildAnalyticsPayload(store, analyzer, userId);
  return {
    generatedAt: new Date().toISOString(),
    modelVersion: analytics.modelVersion,
    metrics: dashboard.metrics,
    modelStats: analytics.modelStats,
    latestBenchmark: analytics.latestBenchmark,
    featuredSessions: dashboard.recentSessions.slice(0, 4).map((session) => ({
      title: session.title,
      channel: session.channel,
      status: session.status,
      summary: session.summary,
      predictedIntent: session.latestAnalysis?.predictedIntent || null,
      evidence: session.latestAnalysis?.summary?.evidence?.slice(0, 3) || [],
      nextSteps:
        session.latestAnalysis?.summary?.suggestedNextSteps?.slice(0, 2) || [],
    })),
    evaluationSummary: analytics.evaluationSummary,
    notificationLogs: analytics.notificationLogs.slice(0, 6),
  };
}

function extractQuoted(text) {
  const m = String(text).match(/"([^"]*)"/);
  return m?.[1] ?? "";
}

function normalizeSpaces(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function tryParseJsonFromText(text) {
  const s = String(text);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function solveLocal(query) {
  const text = normalizeSpaces(query);

  if (/\bodd\b|\beven\b/i.test(text) && /\bnumber\b/i.test(text)) {
    const nums = text.match(/-?\d+/g) || [];
    if (nums.length > 0) {
      const n = Number(nums[0]);
      if (Number.isFinite(n)) {
        const isOdd = Math.abs(n) % 2 === 1;
        const asksOdd = /\bodd\b/i.test(text);
        const asksEven = /\beven\b/i.test(text);
        if (asksOdd && !asksEven) return isOdd ? "YES" : "NO";
        if (asksEven && !asksOdd) return isOdd ? "NO" : "YES";
      }
    }
    return "";
  }

  if (/extract\s+date\s+from/i.test(text)) {
    const source = extractQuoted(text) || text;
    const month =
      "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
    const re = new RegExp(`\\b\\d{1,2}\\s+${month}\\s+\\d{4}\\b`, "i");
    const m = String(source).match(re);
    if (m) return normalizeSpaces(m[0].replace(/[.,;:!?]+$/g, ""));
    const iso = String(source).match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (iso) return iso[0];
    const slash = String(source).match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
    if (slash) return slash[0];
    return "";
  }

  if (/extract\s+/i.test(text) && /from\s*:/i.test(text)) {
    const quoted = extractQuoted(text);
    if (quoted) return quoted;
  }

  if (/\bcount\s+words\b/i.test(text)) {
    const quoted = extractQuoted(text);
    if (quoted) {
      const words = normalizeSpaces(quoted).split(" ").filter(Boolean);
      return String(words.length);
    }
    // Without quotes: "count words in hello world" — extract everything after "in"
    const inMatch = text.match(/count\s+words\s+in\s+(.+)$/i);
    if (inMatch) {
      const words = normalizeSpaces(inMatch[1]).split(" ").filter(Boolean);
      return String(words.length);
    }
  }

  if (
    /\bcount\s+characters\b/i.test(text) ||
    /\bcount\s+chars\b/i.test(text) ||
    /\bhow\s+many\s+(?:characters|letters|chars)\b/i.test(text)
  ) {
    const quoted = extractQuoted(text);
    if (quoted) return String(quoted.length);
    // Without quotes: try "in X" or "of X"
    const inMatch = text.match(/(?:in|of)\s+(\S+)\s*\??$/i);
    if (inMatch) return String(inMatch[1].length);
  }

  if (/\breverse\b/i.test(text)) {
    const quoted = extractQuoted(text);
    // With quotes
    if (quoted) return quoted.split("").reverse().join("");
    // Without quotes: "reverse the word hello" or "reverse hello"
    const wordMatch = text.match(/reverse(?:\s+the\s+\w+)?\s+(\S+)\s*$/i);
    if (wordMatch) return wordMatch[1].split("").reverse().join("");
  }

  if (/\buppercase\b/i.test(text)) {
    const quoted = extractQuoted(text);
    if (quoted) return quoted.toUpperCase();
    // Without quotes: "convert hello world to uppercase"
    const wordMatch = text.match(/convert\s+(.+?)\s+to\s+uppercase/i);
    if (wordMatch) return wordMatch[1].toUpperCase();
  }

  if (/\blowercase\b/i.test(text)) {
    const quoted = extractQuoted(text);
    if (quoted) return quoted.toLowerCase();
    const wordMatch = text.match(/convert\s+(.+?)\s+to\s+lowercase/i);
    if (wordMatch) return wordMatch[1].toLowerCase();
  }

  if (/\bremove\s+punctuation\b/i.test(text) && /".*"/.test(text)) {
    const quoted = extractQuoted(text);
    return quoted.replace(/[^\p{L}\p{N}\s]/gu, "");
  }

  if (/\brepeat\b/i.test(text) && /".*"/.test(text)) {
    const quoted = extractQuoted(text);
    const n = Number((text.match(/\b(\d+)\s+times?\b/i) || [])[1] || "");
    if (Number.isFinite(n) && n >= 0 && n <= 1000) return quoted.repeat(n);
  }

  if (/\bvalue\s+of\b/i.test(text) && /\{/.test(text) && /\}/.test(text)) {
    const obj = tryParseJsonFromText(text);
    const keyMatch = text.match(
      /\bvalue\s+of\s+["']?([a-zA-Z0-9_.-]+)["']?\b/i,
    );
    if (obj && keyMatch) {
      const key = keyMatch[1];
      const parts = key.split(".");
      let cur = obj;
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in cur) cur = cur[p];
        else return "";
      }
      if (cur === null || cur === undefined) return "";
      if (typeof cur === "string") return cur;
      if (typeof cur === "number" || typeof cur === "boolean")
        return String(cur);
      return JSON.stringify(cur);
    }
  }

  const math = text.match(
    /(-?\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(-?\d+(?:\.\d+)?)/,
  );
  if (math) {
    const a = Number(math[1]);
    const op = math[2];
    const b = Number(math[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
    let result;
    if (op === "+") result = a + b;
    else if (op === "-") result = a - b;
    else if (op === "*") result = a * b;
    else if (op === "/") result = b === 0 ? NaN : a / b;
    if (!Number.isFinite(result)) return "";
    // Return bare number — evaluator expects just the value
    const rounded = Math.round(result * 1e10) / 1e10;
    return String(rounded);
  }

  return "";
}

async function callOpenAI(apiKey, messages, model, jsonMode) {
  const body = {
    model: model || "gpt-4o",
    temperature: 0,
    messages: messages,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenAI error:", res.status, errText);
      return "";
    }
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content ?? "").trim();
  } catch (e) {
    console.error("OpenAI fetch error:", e.message);
    return "";
  }
}

async function solveWithLlm(query, assets = []) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return "";

  let assetContext = "";
  if (assets.length > 0) {
    const fetched = await Promise.all(
      assets.map(async (url) => {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          const text = await r.text();
          return "[Asset: " + url + "]\n" + text.slice(0, 8000);
        } catch {
          return "[Asset: " + url + " - could not fetch]";
        }
      }),
    );
    assetContext = fetched.join("\n\n");
  }

  const context = assetContext ? assetContext + "\n\n" : "";
  const fullQuestion = context + String(query);

  const systemPrompt = [
    'You are a precise answer engine. Respond ONLY with a JSON object: {"reasoning": "...", "answer": "..."}',
    "",
    "CRITICAL RULE: The `answer` field must contain ONLY the bare value. No sentences. No explanation. No trailing punctuation unless it is part of the value itself.",
    "",
    "=== COMPARISON (WHO/WHICH/WHAT is highest/lowest/most/least/best/worst) ===",
    "Return the NAME only.",
    "Q: Alice scored 80, Bob scored 90. Who scored highest? → answer: Bob",
    "Q: Alice scored 80, Bob scored 90. Who scored lowest? → answer: Alice",
    "Q: Tom is 25, Sara is 30, Mike is 22. Who is oldest? → answer: Sara",
    "Q: Tom is 25, Sara is 30, Mike is 22. Who is youngest? → answer: Mike",
    "Q: Red costs 5, Blue costs 3, Green costs 7. Which is cheapest? → answer: Blue",
    "Q: Red costs 5, Blue costs 3, Green costs 7. Which is most expensive? → answer: Green",
    "Q: Item X weighs 5kg, Item Y weighs 8kg, Item Z weighs 3kg. Which is heaviest? → answer: Y",
    "Q: A=10, B=20, C=15. Which variable has highest value? → answer: B",
    "Q: A=10, B=20, C=15. Which variable has lowest value? → answer: A",
    "",
    "=== RANKING (rank/sort/order multiple items) ===",
    "Return comma-space separated names/values in the requested order.",
    "Q: Alice=80, Bob=90, Carol=70. Rank highest to lowest. → answer: Bob, Alice, Carol",
    "Q: Alice=80, Bob=90, Carol=70. Rank lowest to highest. → answer: Carol, Alice, Bob",
    "Q: Numbers: 10,20,30. Sort descending. → answer: 30, 20, 10",
    "Q: Numbers: 10,20,30. Sort ascending. → answer: 10, 20, 30",
    "",
    "=== ARITHMETIC (return ONLY the number, no units unless asked) ===",
    "Q: What is 5 + 3? → answer: 8",
    "Q: What is 10 - 4? → answer: 6",
    "Q: What is 6 * 7? → answer: 42",
    "Q: What is 10 / 4? → answer: 2.5",
    "Q: What is 10 / 5? → answer: 2",
    "Q: Tom is 25, Sara is 30, Mike is 22. What is the average age? → answer: 25.67",
    "Q: Tom is 25, Sara is 30, Mike is 22. What is the age difference between oldest and youngest? → answer: 8",
    "Q: Red costs 5, Blue costs 3, Green costs 7. Total cost? → answer: 15",
    "Q: Alice ran 5km, Bob ran 3km, Carol ran 7km. Total distance? → answer: 15",
    "Q: John has 10 apples and gives 3 to Mary. How many does John have? → answer: 7",
    "Q: A train travels 60mph for 2 hours. How far? → answer: 120",
    "Q: A product costs 50 with 20% discount. Final price? → answer: 40",
    "Q: There are 5 red and 3 blue balls. Total? → answer: 8",
    "Q: A rectangle is 6 wide and 4 tall. Area? → answer: 24",
    "Q: Numbers: 2,5,8,11. Sum even numbers. → answer: 10",
    "Q: Numbers: 1,2,3,4,5. Average. → answer: 3",
    "Q: Numbers: 3,7,2,9,4. Largest number. → answer: 9",
    "Q: Numbers: 3,7,2,9,4. Smallest number. → answer: 2",
    "Q: Numbers: 1,3,4,6,9. Sum of odd numbers. → answer: 13",
    "",
    "=== WORD/NUMBER LISTS ===",
    "Return comma-space separated list of values.",
    "Q: Numbers: 1,3,4,6,9. List odd numbers. → answer: 1, 3, 9",
    "Q: Numbers: 1,3,4,6,9. List even numbers. → answer: 4, 6",
    "Q: From [apple, banana, cherry, date] list fruits with more than 5 letters. → answer: banana, cherry",
    "",
    "=== YES/NO ===",
    "Return YES or NO (uppercase).",
    "Q: Is 17 a prime number? → answer: YES",
    "Q: Is 15 a prime number? → answer: NO",
    "Q: Is 25 greater than 30? → answer: NO",
    "Q: Is 100 divisible by 4? → answer: YES",
    "Q: Is 7 odd? → answer: YES",
    "Q: Is 8 even? → answer: YES",
    "Q: Is 9 divisible by 3? → answer: YES",
    "",
    "=== STRING OPERATIONS ===",
    "Q: Reverse the word 'hello' → answer: olleh",
    "Q: Reverse hello → answer: olleh",
    "Q: How many characters in 'hello'? → answer: 5",
    "Q: How many characters in hello? → answer: 5",
    "Q: How many vowels in 'programming'? → answer: 3",
    "Q: How many letters in 'elephant'? → answer: 8",
    "Q: Convert 'hello world' to uppercase → answer: HELLO WORLD",
    "Q: Convert hello world to uppercase → answer: HELLO WORLD",
    "Q: Convert 'HELLO' to lowercase → answer: hello",
    "Q: What is the 3rd character of 'python'? → answer: t",
    "Q: First letter of 'elephant'? → answer: e",
    "Q: Last letter of 'elephant'? → answer: t",
    "Q: Count the vowels in 'education' → answer: 5",
    "",
    "=== FIZZBUZZ / CONDITIONAL ===",
    "Q: FizzBuzz for 15 → answer: FizzBuzz",
    "Q: FizzBuzz for 9 → answer: Fizz",
    "Q: FizzBuzz for 10 → answer: Buzz",
    "Q: FizzBuzz for 7 → answer: 7",
    "Q: Apply FizzBuzz to numbers 1 to 5 → answer: 1, 2, Fizz, 4, Buzz",
    "",
    "=== TRUE/FALSE ===",
    "Return True or False (title-case) unless the question asks for YES/NO.",
    "Q: Is 4 * 4 equal to 16? True or False → answer: True",
    "Q: Is 3 > 5? True or False → answer: False",
    "",
    "=== DATE / TIME ===",
    "Q: What day comes after Monday? → answer: Tuesday",
    "Q: How many days in February (non-leap year)? → answer: 28",
    "Q: How many months in a year? → answer: 12",
    "Q: What is the 3rd month of the year? → answer: March",
    "",
    "=== UNIT CONVERSION ===",
    "Return ONLY the number (and unit only if the question asks for it explicitly).",
    "Q: Convert 100 cm to meters → answer: 1",
    "Q: Convert 1 kilometer to meters → answer: 1000",
    "Q: How many seconds in an hour? → answer: 3600",
    "Q: How many minutes in a day? → answer: 1440",
    "",
    "=== EXACT FORMATTING RULES ===",
    "1. WHO/WHICH questions → name only (e.g. 'Bob', not 'Bob scored 90')",
    "2. Number questions → digits only, no units unless asked (e.g. '42' not '42 apples')",
    "3. List questions → comma-space separated (e.g. 'Bob, Alice, Carol')",
    "4. YES/NO questions → 'YES' or 'NO' (uppercase)",
    "5. True/False questions → 'True' or 'False'",
    "6. Never add period, colon, or explanation to answer field",
    "7. For averages, round to 2 decimal places max (drop trailing zeros)",
    "8. If asked for a name/word, return only that word",
  ].join("\n");

  const result = await callOpenAI(
    apiKey,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: fullQuestion },
    ],
    process.env.OPENAI_MODEL || "gpt-4o",
    true,
  );

  // Parse JSON and extract answer field
  try {
    const start = result.indexOf("{");
    const end = result.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(result.slice(start, end + 1));
      if (parsed.answer !== undefined) {
        return String(parsed.answer).trim();
      }
    }
  } catch (e) {
    console.error(
      "JSON parse failed:",
      e.message,
      "Raw:",
      result.slice(0, 200),
    );
  }

  // Fallback: extract answer field from raw text
  const answerMatch = result.match(/"answer"\s*:\s*"([^"]+)"/);
  if (answerMatch) return answerMatch[1].trim();

  return result.trim();
}

async function solve(query, assets = []) {
  // Try fast local rules first (no latency, no API cost)
  if (assets.length === 0) {
    const local = solveLocal(query);
    if (local !== "") return local;
  }
  return (await solveWithLlm(query, assets)) || "";
}

export async function createServerApp(overrides = {}) {
  const config = resolveConfig(overrides);
  const store = createStore(config.databasePath);
  const analyzer = createAnalysisEngine({
    taxonomyPath: config.taxonomyPath,
    trainingExamplesPath: config.trainingExamplesPath,
    modelArtifactPath: config.modelArtifactPath,
    staleThresholdMinutes: config.sessionIdleMinutes,
  });

  function analyzeSnapshot(snapshot, workspaceId = "", temporalHistory = []) {
    return analyzer.analyze(snapshot, {
      feedbackExamples: store.listFeedbackExamples(workspaceId),
      temporalHistory,
    });
  }

  function authEnabled() {
    return config.authRequired || store.countUsers() > 0;
  }

  function canAccessWorkspace(workspaceId, viewer) {
    const workspace = store.getWorkspaceById(
      workspaceId,
      viewer?.user?.id || "",
    );
    return Boolean(workspace);
  }

  function requireUser(response, viewer) {
    if (!viewer.enabled) {
      return true;
    }
    if (!viewer.user) {
      json(response, 401, {
        error: viewer.needsBootstrap
          ? "Bootstrap an admin account before using the dashboard."
          : "Authentication required.",
        auth: {
          enabled: viewer.enabled,
          needsBootstrap: viewer.needsBootstrap,
        },
      });
      return false;
    }
    return true;
  }

  async function resolveViewer(request) {
    const token = getBearerToken(request);
    if (!authEnabled()) {
      return {
        enabled: false,
        needsBootstrap: false,
        token,
        user: null,
      };
    }

    if (!token) {
      return {
        enabled: true,
        needsBootstrap: store.countUsers() === 0,
        token: "",
        user: null,
      };
    }

    const session = store.getAuthSessionByTokenHash(createTokenHash(token));
    const user = session ? store.getUserById(session.userId) : null;
    return {
      enabled: true,
      needsBootstrap: store.countUsers() === 0,
      token,
      user,
    };
  }

  function ensureImportSource(workspaceId, sourceId = "") {
    if (sourceId) {
      const existing = store.getSourceById(sourceId);
      if (existing) {
        return existing;
      }
    }

    const manualSource = store.findSourceForWorkspaceType(
      workspaceId,
      "manual-api",
    );
    if (manualSource) {
      return manualSource;
    }

    return store.createSource(
      {
        workspaceId,
        type: "manual-api",
        name: "Imported Session Bundle",
      },
      createPlaintextToken(),
    );
  }

  async function handleApi(request, response, url, viewer) {
    const viewerUserId = viewer.user?.id || "";

    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, {
        status: "ok",
        service: "intent-resurrection-engine",
        time: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/auth/state") {
      json(response, 200, {
        enabled: viewer.enabled,
        needsBootstrap: viewer.needsBootstrap,
        user: viewer.user,
        sessionTtlHours: config.authSessionTtlHours,
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/auth/bootstrap-admin"
    ) {
      if (store.countUsers() > 0) {
        badRequest(
          response,
          "Bootstrap is only available before the first user exists.",
        );
        return;
      }

      const body = await readJsonBody(request);
      if (!body.email || !body.password || String(body.password).length < 8) {
        badRequest(
          response,
          "email and a password with at least 8 characters are required.",
        );
        return;
      }

      const user = store.createUser({
        email: body.email,
        name: body.name || "Admin",
        passwordHash: hashPassword(body.password),
        role: "admin",
      });
      store.claimUnownedWorkspaces(user.id);
      const sessionRecord = createAuthSessionRecord({
        userId: user.id,
        ttlHours: config.authSessionTtlHours,
      });
      store.createAuthSession({
        userId: user.id,
        tokenHash: sessionRecord.tokenHash,
        expiresAt: sessionRecord.expiresAt,
      });

      json(response, 201, {
        user,
        token: sessionRecord.plaintextToken,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/auth/login") {
      const body = await readJsonBody(request);
      const userRecord = store.getUserRecordByEmail(body.email || "");
      if (
        !userRecord ||
        !verifyPassword(body.password || "", userRecord.password_hash)
      ) {
        json(response, 401, { error: "Invalid email or password." });
        return;
      }

      const user = store.getUserById(userRecord.id);
      const sessionRecord = createAuthSessionRecord({
        userId: user.id,
        ttlHours: config.authSessionTtlHours,
      });
      store.createAuthSession({
        userId: user.id,
        tokenHash: sessionRecord.tokenHash,
        expiresAt: sessionRecord.expiresAt,
      });

      json(response, 200, {
        user,
        token: sessionRecord.plaintextToken,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/auth/logout") {
      const token = getBearerToken(request);
      if (token) {
        store.deleteAuthSessionByTokenHash(createTokenHash(token));
      }
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/dashboard") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, {
        ...store.getDashboard(viewerUserId),
        intents: analyzer.listIntents(),
        modelStats: analyzer.getModelStats(
          store.listFeedbackExamples("", viewerUserId),
        ),
        auth: {
          enabled: viewer.enabled,
          user: viewer.user,
        },
        publicConfig: {
          ingestionWebhookUrl: config.publicIngestionWebhookUrl,
          staleMonitorWebhookUrl: config.publicStaleMonitorWebhookUrl,
          sessionIdleMinutes: config.sessionIdleMinutes,
          notificationThrottleMinutes: config.notificationThrottleMinutes,
        },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/analytics") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, buildAnalyticsPayload(store, analyzer, viewerUserId));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/intents") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, { intents: analyzer.listIntents() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/workspaces") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, { workspaces: store.listWorkspaces(viewerUserId) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/workspaces") {
      if (!requireUser(response, viewer)) {
        return;
      }
      const body = await readJsonBody(request);
      if (!body.name) {
        badRequest(response, "Workspace name is required.");
        return;
      }

      const workspace = store.createWorkspace({
        ...body,
        ownerUserId: viewerUserId,
      });
      json(response, 201, { workspace });
      return;
    }

    if (
      request.method === "PUT" &&
      /^\/api\/v1\/workspaces\/[^/]+$/.test(url.pathname)
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const workspaceId = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readJsonBody(request);
      const workspace = store.updateWorkspace(workspaceId, body, viewerUserId);
      if (!workspace) {
        notFound(response);
        return;
      }
      json(response, 200, { workspace });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/sources") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, { sources: store.listSources(viewerUserId) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/sources") {
      if (!requireUser(response, viewer)) {
        return;
      }
      const body = await readJsonBody(request);
      if (!body.workspaceId || !body.type || !body.name) {
        badRequest(response, "workspaceId, type, and name are required.");
        return;
      }

      const workspace = store.getWorkspaceById(body.workspaceId, viewerUserId);
      if (!workspace) {
        badRequest(response, "Workspace does not exist.");
        return;
      }

      const source = store.createSource(body, createPlaintextToken());
      json(response, 201, {
        source: {
          ...source,
          ingestionWebhookUrl: config.publicIngestionWebhookUrl,
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/ingestion/session"
    ) {
      const body = await readJsonBody(request);
      const sourceToken = getSourceToken(request, body);
      const source = store.findSourceByToken(sourceToken);
      if (!source) {
        json(response, 401, { error: "Invalid or missing source token." });
        return;
      }

      const snapshot = normalizeSnapshot(body, {
        sourceType: source.type,
        channel: body.channel || source.type,
      });

      const session = store.saveIngestion({
        workspaceId: source.workspaceId,
        sourceId: source.id,
        sessionId: snapshot.sessionId,
        title: snapshot.title,
        channel: snapshot.channel,
        occurredAt: snapshot.occurredAt,
        normalizedSnapshot: snapshot,
      });

      json(response, 201, { session, source });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/analysis/run") {
      const body = await readJsonBody(request);
      if (!body.sessionId) {
        badRequest(response, "sessionId is required.");
        return;
      }

      const session = store.getSessionById(body.sessionId);
      if (!session || !session.latestSnapshot) {
        notFound(response);
        return;
      }

      const history = store
        .listSessionTimeline(session.id, 6)
        .map((event) => event.snapshot)
        .filter((entry, index) => index > 0);
      const summary = analyzeSnapshot(
        session.latestSnapshot,
        session.workspaceId,
        history,
      );
      const analysis = store.createAnalysis({
        sessionId: session.id,
        workspaceId: session.workspaceId,
        summary,
      });

      json(response, 200, { analysis });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/analyses") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, { analyses: store.listAnalyses(25, viewerUserId) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/sessions") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, { sessions: store.listSessions(50, viewerUserId) });
      return;
    }

    if (
      request.method === "GET" &&
      /^\/api\/v1\/sessions\/[^/]+\/comparison$/.test(url.pathname)
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const sessionId = decodeURIComponent(url.pathname.split("/")[4]);
      const session = store.getSessionById(sessionId, viewerUserId);
      if (!session) {
        notFound(response);
        return;
      }

      json(response, 200, {
        comparison: buildComparisonPayload(
          session,
          store.getSessionComparison(sessionId, viewerUserId),
        ),
      });
      return;
    }

    if (
      request.method === "GET" &&
      /^\/api\/v1\/sessions\/[^/]+\/timeline$/.test(url.pathname)
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const sessionId = decodeURIComponent(url.pathname.split("/")[4]);
      const session = store.getSessionById(sessionId, viewerUserId);
      if (!session) {
        notFound(response);
        return;
      }

      json(response, 200, {
        sessionId,
        timeline: store.listSessionTimeline(sessionId, 12, viewerUserId),
      });
      return;
    }

    if (
      request.method === "GET" &&
      /^\/api\/v1\/sessions\/[^/]+$/.test(url.pathname)
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const sessionId = decodeURIComponent(url.pathname.split("/").pop());
      const session = store.getSessionById(sessionId, viewerUserId);
      if (!session) {
        notFound(response);
        return;
      }
      json(response, 200, { session });
      return;
    }

    if (
      request.method === "DELETE" &&
      /^\/api\/v1\/sessions\/[^/]+$/.test(url.pathname)
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const sessionId = decodeURIComponent(url.pathname.split("/").pop());
      const existing = store.getSessionById(sessionId, viewerUserId);
      if (!existing) {
        notFound(response);
        return;
      }
      const session = store.deleteSession(sessionId);
      if (!session) {
        notFound(response);
        return;
      }
      json(response, 200, { session });
      return;
    }

    if (
      request.method === "POST" &&
      /^\/api\/v1\/sessions\/[^/]+\/resolve$/.test(url.pathname)
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const sessionId = decodeURIComponent(url.pathname.split("/")[4]);
      if (!store.getSessionById(sessionId, viewerUserId)) {
        notFound(response);
        return;
      }
      const session = store.resolveSession(sessionId);
      if (!session) {
        notFound(response);
        return;
      }
      json(response, 200, { session });
      return;
    }

    if (
      request.method === "POST" &&
      /^\/api\/v1\/sessions\/[^/]+\/pin$/.test(url.pathname)
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const sessionId = decodeURIComponent(url.pathname.split("/")[4]);
      const body = await readJsonBody(request);
      if (!store.getSessionById(sessionId, viewerUserId)) {
        notFound(response);
        return;
      }
      const session = store.setSessionPinned(sessionId, body.pinned !== false);
      if (!session) {
        notFound(response);
        return;
      }
      json(response, 200, { session });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/feedback") {
      if (!requireUser(response, viewer)) {
        return;
      }
      const sessionId = url.searchParams.get("sessionId") || "";
      json(response, 200, {
        feedback: sessionId
          ? store.listFeedbackForSession(sessionId, viewerUserId)
          : store.listFeedback(100, viewerUserId),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/feedback") {
      if (!requireUser(response, viewer)) {
        return;
      }
      const body = await readJsonBody(request);
      const verdict = normalizeFeedbackVerdict(body.verdict);
      if (!body.sessionId || !verdict) {
        badRequest(response, "sessionId and a valid verdict are required.");
        return;
      }

      const session = store.getSessionById(body.sessionId, viewerUserId);
      if (!session) {
        notFound(response);
        return;
      }

      const actualIntentId =
        body.actualIntentId ||
        (verdict === "correct"
          ? session.latestAnalysis?.predictedIntent?.id || ""
          : "");

      const feedback = store.createFeedback({
        sessionId: session.id,
        analysisId: body.analysisId || session.latestAnalysisId,
        verdict,
        actualIntentId,
        note: body.note || "",
      });

      json(response, 201, { feedback });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/evaluations/summary"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, {
        summary: store.getEvaluationSummary(viewerUserId),
        intents: analyzer.listIntents(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/benchmarks") {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, {
        modelVersion: analyzer.modelVersion,
        runs: store.listBenchmarkRuns(10),
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/benchmarks/run"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const body = await readJsonBody(request);
      const results = analyzer.benchmark(
        store.listFeedbackExamples("", viewerUserId),
      );
      const run = store.createBenchmarkRun({
        modelVersion: analyzer.modelVersion,
        datasetLabel: body.datasetLabel || "seed-plus-feedback",
        results,
      });
      json(response, 201, { run });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/notifications/logs"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, {
        logs: enrichNotificationLogs(
          store,
          store.listNotificationLogs(60, viewerUserId),
        ),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/model/train") {
      if (!requireUser(response, viewer)) {
        return;
      }
      const body = await readJsonBody(request);
      const artifact = analyzer.trainModel(
        store.listFeedbackExamples("", viewerUserId),
        body.datasetLabel || "seed-plus-feedback",
      );
      json(response, 201, { artifact });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/export/sessions"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(response, 200, store.exportSessionsBundle(viewerUserId));
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/reports/analytics"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const payload = buildAnalyticsPayload(store, analyzer, viewerUserId);
      const format = (
        url.searchParams.get("format") || "markdown"
      ).toLowerCase();
      if (format === "json") {
        json(response, 200, payload);
        return;
      }
      if (format === "html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(buildAnalyticsReportHtml(payload));
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
      });
      response.end(buildAnalyticsReport(payload));
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/reports/sessions.csv"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const rows = [
        [
          "title",
          "channel",
          "status",
          "predicted_intent",
          "confidence",
          "last_activity_at",
        ],
        ...createSessionReportRows(store.listSessions(200, viewerUserId)),
      ];
      response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
      response.end(toCsv(rows));
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/reports/presentation"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      json(
        response,
        200,
        buildPresentationPayload(store, analyzer, viewer.user?.id || ""),
      );
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/import/sessions"
    ) {
      if (!requireUser(response, viewer)) {
        return;
      }
      const body = await readJsonBody(request);
      const sessions = Array.isArray(body.sessions) ? body.sessions : [];
      const workspaceId = body.workspaceId || body.targetWorkspaceId || "";
      if (!workspaceId || sessions.length === 0) {
        badRequest(
          response,
          "workspaceId and a non-empty sessions array are required.",
        );
        return;
      }

      const workspace = store.getWorkspaceById(workspaceId, viewerUserId);
      if (!workspace) {
        badRequest(response, "Target workspace does not exist.");
        return;
      }

      const source = ensureImportSource(workspaceId, body.sourceId);
      const overwrite = Boolean(body.overwrite);
      const imported = [];

      for (const entry of sessions) {
        const rawSnapshot = entry.latestSnapshot || entry.snapshot || entry;
        const snapshot = normalizeSnapshot(rawSnapshot, {
          sourceType: source.type,
          channel: rawSnapshot.channel || source.type,
        });

        if (overwrite && store.getSessionById(snapshot.sessionId)) {
          store.deleteSession(snapshot.sessionId);
        }

        const session = store.saveIngestion({
          workspaceId,
          sourceId: source.id,
          sessionId: snapshot.sessionId,
          title: snapshot.title,
          channel: snapshot.channel,
          occurredAt: snapshot.occurredAt,
          normalizedSnapshot: snapshot,
        });

        const summary =
          entry.latestAnalysis?.summary ||
          analyzeSnapshot(snapshot, workspaceId);
        const analysis = store.createAnalysis({
          sessionId: session.id,
          workspaceId,
          summary,
        });

        const feedbackEntries = Array.isArray(entry.feedback)
          ? entry.feedback
          : [];
        feedbackEntries.forEach((feedback) => {
          const verdict = normalizeFeedbackVerdict(feedback.verdict);
          if (!verdict) {
            return;
          }

          store.createFeedback({
            sessionId: session.id,
            analysisId: analysis.id,
            verdict,
            actualIntentId: feedback.actualIntentId || "",
            note: feedback.note || "",
          });
        });

        imported.push({
          sessionId: session.id,
          analysisId: analysis.id,
        });
      }

      json(response, 201, { imported, workspaceId, sourceId: source.id });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/automations/stale-sessions"
    ) {
      const body = await readJsonBody(request);
      const idleMinutes = Number(body.idleMinutes || config.sessionIdleMinutes);

      const notifications = [];
      const skipped = [];
      for (const session of store.listAllSessions()) {
        if (!session.latestSnapshot || session.status === "resolved") {
          continue;
        }

        const history = store
          .listSessionTimeline(session.id, 6)
          .map((event) => event.snapshot)
          .filter((entry, index) => index > 0);
        const summary = analyzeSnapshot(
          session.latestSnapshot,
          session.workspaceId,
          history,
        );
        const workspace = store.getWorkspaceById(session.workspaceId);
        const minimumIdle = Math.max(
          idleMinutes,
          workspace?.notificationMinIdleMinutes || 0,
        );

        if (
          !summary.staleAssessment.isStale ||
          summary.staleAssessment.idleMinutes < minimumIdle
        ) {
          continue;
        }

        const analysis = store.createAnalysis({
          sessionId: session.id,
          workspaceId: session.workspaceId,
          summary,
        });

        if (!workspace?.notificationWebhookUrl) {
          continue;
        }
        if (
          Array.isArray(workspace.notificationIntentIds) &&
          workspace.notificationIntentIds.length > 0 &&
          !workspace.notificationIntentIds.includes(analysis.predictedIntent.id)
        ) {
          skipped.push({
            sessionId: session.id,
            reason: "intent-filter",
            intentId: analysis.predictedIntent.id,
          });
          continue;
        }
        if (isWithinQuietHours(workspace)) {
          skipped.push({
            sessionId: session.id,
            reason: "quiet-hours",
          });
          continue;
        }

        const payload = {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          sessionId: session.id,
          sessionTitle: session.title,
          predictedIntent: analysis.predictedIntent,
          staleAssessment: analysis.summary.staleAssessment,
          evidence: analysis.evidence,
          suggestedNextSteps: analysis.suggestedNextSteps,
        };

        const notification = store.createNotification({
          analysisId: analysis.id,
          sessionId: session.id,
          workspaceId: workspace.id,
          destination: workspace.notificationWebhookUrl,
          payload,
          throttleMinutes: config.notificationThrottleMinutes,
        });

        if (notification.throttled) {
          continue;
        }

        notifications.push({
          id: notification.id,
          destination: workspace.notificationWebhookUrl,
          payload,
        });
      }

      json(response, 200, { notifications, skipped });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/notifications/dispatch-ready"
    ) {
      const result = await dispatchPendingNotifications({ store, config });
      json(response, 200, result);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/notifications/report-dispatch"
    ) {
      const body = await readJsonBody(request);
      const deliveredIds = Array.isArray(body.deliveredIds)
        ? body.deliveredIds
        : [];
      const failures = Array.isArray(body.failures) ? body.failures : [];

      if (deliveredIds.length > 0) {
        store.markNotificationsDelivered(deliveredIds);
      }
      if (failures.length > 0) {
        store.markNotificationFailures(failures);
      }

      json(response, 200, {
        delivered: deliveredIds.length,
        failed: failures.length,
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/notifications/mark-delivered"
    ) {
      const body = await readJsonBody(request);
      const notificationIds = Array.isArray(body.notificationIds)
        ? body.notificationIds
        : [];
      store.markNotificationsDelivered(notificationIds);
      json(response, 200, { delivered: notificationIds.length });
      return;
    }

    notFound(response);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", config.appBaseUrl);

    if (request.method === "OPTIONS") {
      json(response, 200, { ok: true });
      return;
    }

    try {
      if (request.method === "POST" && url.pathname === "/v1/answer") {
        const body = await readJsonBody(request);
        // Accept every possible field name the platform might use
        const query =
          body?.query ??
          body?.question ??
          body?.input ??
          body?.prompt ??
          body?.text ??
          body?.message ??
          body?.q ??
          body?.content ??
          "";
        console.log("[EVAL] BODY KEYS:", Object.keys(body || {}).join(", "));
        if (!query || !String(query).trim()) {
          badRequest(response, "query is required.");
          return;
        }
        const assets = Array.isArray(body?.assets)
          ? body.assets
          : Array.isArray(body?.urls)
            ? body.urls
            : Array.isArray(body?.documents)
              ? body.documents
              : [];
        const out = await solve(query, assets);
        console.log("[EVAL] Q: " + JSON.stringify(String(query).slice(0, 300)));
        console.log("[EVAL] A: " + JSON.stringify(String(out).slice(0, 300)));
        // API spec: respond with JSON { "output": "answer string" }
        json(response, 200, { output: String(out).trim() });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const viewer = await resolveViewer(request);
        await handleApi(request, response, url, viewer);
        return;
      }

      await serveStatic(config.frontendRoot, url.pathname, response);
    } catch (error) {
      serverError(response, error);
    }
  });

  const app = {
    config,
    store,
    server,
    baseUrl: config.appBaseUrl,
    async listen() {
      await new Promise((resolve) =>
        server.listen(config.port, config.host, resolve),
      );
      const address = server.address();
      if (typeof address === "object" && address) {
        const host = address.address === "::" ? "127.0.0.1" : address.address;
        this.baseUrl = `http://${host}:${address.port}`;
      }
      return this;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };

  return app;
}
