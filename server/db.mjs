import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createTokenHash, parseJsonRow } from "./lib/http.mjs";

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeIntentIds(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseWorkspace(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.owner_user_id || "",
    rootPath: row.root_path,
    description: row.description,
    notificationWebhookUrl: row.notification_webhook_url,
    notificationDigestMinutes: Number(row.notification_digest_minutes || 0),
    notificationQuietStart: row.notification_quiet_start || "",
    notificationQuietEnd: row.notification_quiet_end || "",
    notificationIntentIds: parseJsonRow(row.notification_intents_json, []),
    notificationMinIdleMinutes: Number(row.notification_min_idle_minutes || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseSource(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    name: row.name,
    tokenPreview: row.token_preview,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}

function parseAnalysis(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    predictedIntent: {
      id: row.predicted_intent_id,
      label: row.predicted_intent_label,
      confidence: row.confidence
    },
    staleScore: row.stale_score,
    evidence: parseJsonRow(row.evidence_json, []),
    suggestedNextSteps: parseJsonRow(row.next_steps_json, []),
    summary: parseJsonRow(row.summary_json, {}),
    createdAt: row.created_at
  };
}

function parseFeedback(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    analysisId: row.analysis_id,
    verdict: row.verdict,
    actualIntentId: row.actual_intent_id,
    note: row.note,
    createdAt: row.created_at
  };
}

function parseNotification(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    analysisId: row.analysis_id,
    workspaceId: row.workspace_id,
    destination: row.destination,
    status: row.status,
    payload: parseJsonRow(row.payload_json, {}),
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    lastAttemptAt: row.last_attempt_at,
    attemptCount: Number(row.attempt_count || 0),
    lastError: row.last_error || ""
  };
}

function parseIngestionEvent(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    sourceId: row.source_id,
    snapshot: parseJsonRow(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function parseBenchmarkRun(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    modelVersion: row.model_version,
    datasetLabel: row.dataset_label,
    results: parseJsonRow(row.results_json, {}),
    createdAt: row.created_at
  };
}

function parseAuthSession(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

function parseSession(row, latestAnalysis = null, latestFeedback = null) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    channel: row.channel,
    status: row.status,
    title: row.title,
    summary: row.summary,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at,
    pinned: Boolean(row.pinned),
    pinnedAt: row.pinned_at,
    latestSnapshot: parseJsonRow(row.latest_snapshot_json, null),
    latestAnalysisId: row.latest_analysis_id,
    latestAnalysis,
    latestFeedback
  };
}

function workspaceVisibleToUser(row, userId = "") {
  if (!row) {
    return false;
  }
  if (!userId) {
    return true;
  }
  return !row.owner_user_id || row.owner_user_id === userId;
}

export function createStore(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      owner_user_id TEXT,
      root_path TEXT,
      description TEXT,
      notification_webhook_url TEXT,
      notification_digest_minutes INTEGER NOT NULL DEFAULT 0,
      notification_quiet_start TEXT,
      notification_quiet_end TEXT,
      notification_intents_json TEXT NOT NULL DEFAULT '[]',
      notification_min_idle_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token_preview TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      latest_snapshot_json TEXT NOT NULL,
      latest_analysis_id TEXT,
      started_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      ended_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS ingestion_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      predicted_intent_id TEXT NOT NULL,
      predicted_intent_label TEXT NOT NULL,
      confidence REAL NOT NULL,
      stale_score REAL NOT NULL,
      evidence_json TEXT NOT NULL,
      next_steps_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS feedback_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      analysis_id TEXT,
      verdict TEXT NOT NULL,
      actual_intent_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      destination TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY,
      model_version TEXT NOT NULL,
      dataset_label TEXT NOT NULL,
      results_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  }

  function ensureColumn(table, column, definition) {
    if (!hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  ensureColumn("notifications", "session_id", "TEXT");
  ensureColumn("notifications", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("notifications", "last_attempt_at", "TEXT");
  ensureColumn("notifications", "last_error", "TEXT");
  ensureColumn("workspaces", "owner_user_id", "TEXT");
  ensureColumn("workspaces", "notification_digest_minutes", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("workspaces", "notification_quiet_start", "TEXT");
  ensureColumn("workspaces", "notification_quiet_end", "TEXT");
  ensureColumn("workspaces", "notification_intents_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("workspaces", "notification_min_idle_minutes", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("sessions", "pinned", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("sessions", "pinned_at", "TEXT");

  const statements = {
    insertWorkspace: db.prepare(`
      INSERT INTO workspaces (
        id, name, slug, owner_user_id, root_path, description, notification_webhook_url, notification_digest_minutes,
        notification_quiet_start, notification_quiet_end, notification_intents_json, notification_min_idle_minutes,
        created_at, updated_at
      )
      VALUES (
        @id, @name, @slug, @ownerUserId, @rootPath, @description, @notificationWebhookUrl, @notificationDigestMinutes,
        @notificationQuietStart, @notificationQuietEnd, @notificationIntentIdsJson, @notificationMinIdleMinutes,
        @createdAt, @updatedAt
      )
    `),
    updateWorkspace: db.prepare(`
      UPDATE workspaces
      SET name = @name,
          slug = @slug,
          owner_user_id = COALESCE(@ownerUserId, owner_user_id),
          root_path = @rootPath,
          description = @description,
          notification_webhook_url = @notificationWebhookUrl,
          notification_digest_minutes = @notificationDigestMinutes,
          notification_quiet_start = @notificationQuietStart,
          notification_quiet_end = @notificationQuietEnd,
          notification_intents_json = @notificationIntentIdsJson,
          notification_min_idle_minutes = @notificationMinIdleMinutes,
          updated_at = @updatedAt
      WHERE id = @id
    `),
    selectWorkspaceById: db.prepare(`SELECT * FROM workspaces WHERE id = ?`),
    listWorkspaces: db.prepare(`SELECT * FROM workspaces ORDER BY created_at DESC`),
    insertUser: db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
      VALUES (@id, @email, @name, @passwordHash, @role, @createdAt, @updatedAt)
    `),
    selectUserById: db.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`),
    selectUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`),
    countUsers: db.prepare(`SELECT COUNT(*) AS count FROM users`),
    insertAuthSession: db.prepare(`
      INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
      VALUES (@id, @userId, @tokenHash, @createdAt, @expiresAt)
    `),
    selectAuthSessionByTokenHash: db.prepare(`
      SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1
    `),
    deleteAuthSessionByTokenHash: db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`),
    claimUnownedWorkspaces: db.prepare(`UPDATE workspaces SET owner_user_id = ? WHERE owner_user_id IS NULL OR owner_user_id = ''`),
    insertSource: db.prepare(`
      INSERT INTO sources (id, workspace_id, type, name, token_hash, token_preview, created_at, last_seen_at)
      VALUES (@id, @workspaceId, @type, @name, @tokenHash, @tokenPreview, @createdAt, @lastSeenAt)
    `),
    selectSourceById: db.prepare(`SELECT * FROM sources WHERE id = ? LIMIT 1`),
    listSources: db.prepare(`SELECT * FROM sources ORDER BY created_at DESC`),
    selectSourceByHash: db.prepare(`SELECT * FROM sources WHERE token_hash = ? LIMIT 1`),
    selectSourceForWorkspaceType: db.prepare(`
      SELECT * FROM sources WHERE workspace_id = ? AND type = ? ORDER BY created_at ASC LIMIT 1
    `),
    touchSource: db.prepare(`UPDATE sources SET last_seen_at = ? WHERE id = ?`),
    selectSessionById: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
    insertSession: db.prepare(`
      INSERT INTO sessions (id, workspace_id, source_id, channel, status, title, summary, latest_snapshot_json, latest_analysis_id, started_at, last_activity_at, ended_at)
      VALUES (@id, @workspaceId, @sourceId, @channel, @status, @title, @summary, @latestSnapshotJson, @latestAnalysisId, @startedAt, @lastActivityAt, @endedAt)
    `),
    updateSession: db.prepare(`
      UPDATE sessions
      SET title = @title,
          channel = @channel,
          status = @status,
          summary = @summary,
          latest_snapshot_json = @latestSnapshotJson,
          last_activity_at = @lastActivityAt,
          ended_at = @endedAt,
          latest_analysis_id = COALESCE(@latestAnalysisId, latest_analysis_id)
      WHERE id = @id
    `),
    resolveSession: db.prepare(`
      UPDATE sessions
      SET status = 'resolved',
          ended_at = @endedAt
      WHERE id = @id
    `),
    setSessionPinned: db.prepare(`
      UPDATE sessions
      SET pinned = @pinned,
          pinned_at = @pinnedAt
      WHERE id = @id
    `),
    listSessions: db.prepare(`SELECT * FROM sessions ORDER BY pinned DESC, COALESCE(pinned_at, '') DESC, last_activity_at DESC LIMIT ?`),
    listAllSessions: db.prepare(`SELECT * FROM sessions ORDER BY pinned DESC, COALESCE(pinned_at, '') DESC, last_activity_at DESC`),
    insertIngestionEvent: db.prepare(`
      INSERT INTO ingestion_events (id, session_id, source_id, payload_json, created_at)
      VALUES (@id, @sessionId, @sourceId, @payloadJson, @createdAt)
    `),
    selectIngestionEventsForSession: db.prepare(`
      SELECT * FROM ingestion_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    `),
    listAnalyses: db.prepare(`SELECT * FROM analyses ORDER BY created_at DESC LIMIT ?`),
    selectAnalysisById: db.prepare(`SELECT * FROM analyses WHERE id = ?`),
    selectAnalysesForSession: db.prepare(`
      SELECT * FROM analyses WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    `),
    selectLatestAnalysisForSession: db.prepare(`SELECT * FROM analyses WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`),
    insertAnalysis: db.prepare(`
      INSERT INTO analyses (id, session_id, workspace_id, predicted_intent_id, predicted_intent_label, confidence, stale_score, evidence_json, next_steps_json, summary_json, created_at)
      VALUES (@id, @sessionId, @workspaceId, @predictedIntentId, @predictedIntentLabel, @confidence, @staleScore, @evidenceJson, @nextStepsJson, @summaryJson, @createdAt)
    `),
    attachAnalysisToSession: db.prepare(`
      UPDATE sessions
      SET latest_analysis_id = @analysisId,
          summary = @summary,
          status = @status
      WHERE id = @sessionId
    `),
    insertFeedback: db.prepare(`
      INSERT INTO feedback_entries (id, session_id, analysis_id, verdict, actual_intent_id, note, created_at)
      VALUES (@id, @sessionId, @analysisId, @verdict, @actualIntentId, @note, @createdAt)
    `),
    listFeedback: db.prepare(`SELECT * FROM feedback_entries ORDER BY created_at DESC LIMIT ?`),
    selectFeedbackForSession: db.prepare(`
      SELECT * FROM feedback_entries WHERE session_id = ? ORDER BY created_at DESC
    `),
    selectLatestFeedbackForSession: db.prepare(`
      SELECT * FROM feedback_entries WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
    `),
    insertNotification: db.prepare(`
      INSERT INTO notifications (
        id, session_id, analysis_id, workspace_id, destination, status, payload_json, delivered_at, created_at, last_attempt_at, attempt_count, last_error
      )
      VALUES (@id, @sessionId, @analysisId, @workspaceId, @destination, @status, @payloadJson, @deliveredAt, @createdAt, @lastAttemptAt, @attemptCount, @lastError)
    `),
    selectNotificationByAnalysisAndDestination: db.prepare(`
      SELECT * FROM notifications WHERE analysis_id = ? AND destination = ? LIMIT 1
    `),
    selectLatestNotificationForSessionAndDestination: db.prepare(`
      SELECT * FROM notifications
      WHERE session_id = ? AND destination = ?
      ORDER BY COALESCE(last_attempt_at, delivered_at, created_at) DESC, created_at DESC
      LIMIT 1
    `),
    listPendingNotifications: db.prepare(`
      SELECT * FROM notifications
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `),
    listNotifications: db.prepare(`
      SELECT * FROM notifications
      ORDER BY COALESCE(last_attempt_at, delivered_at, created_at) DESC
      LIMIT ?
    `),
    markNotificationDelivered: db.prepare(`
      UPDATE notifications
      SET status = 'delivered',
          delivered_at = @deliveredAt,
          last_attempt_at = @deliveredAt,
          attempt_count = attempt_count + 1,
          last_error = ''
      WHERE id = @id
    `),
    markNotificationFailed: db.prepare(`
      UPDATE notifications
      SET status = 'failed',
          last_attempt_at = @lastAttemptAt,
          attempt_count = attempt_count + 1,
          last_error = @lastError
      WHERE id = @id
    `),
    deleteNotificationsForSession: db.prepare(`
      DELETE FROM notifications
      WHERE analysis_id IN (SELECT id FROM analyses WHERE session_id = ?)
         OR session_id = ?
    `),
    deleteAnalysesForSession: db.prepare(`
      DELETE FROM analyses WHERE session_id = ?
    `),
    deleteFeedbackForSession: db.prepare(`
      DELETE FROM feedback_entries WHERE session_id = ?
    `),
    deleteIngestionEventsForSession: db.prepare(`
      DELETE FROM ingestion_events WHERE session_id = ?
    `),
    deleteSession: db.prepare(`
      DELETE FROM sessions WHERE id = ?
    `),
    insertBenchmarkRun: db.prepare(`
      INSERT INTO benchmark_runs (id, model_version, dataset_label, results_json, created_at)
      VALUES (@id, @modelVersion, @datasetLabel, @resultsJson, @createdAt)
    `),
    listBenchmarkRuns: db.prepare(`
      SELECT * FROM benchmark_runs ORDER BY created_at DESC LIMIT ?
    `)
  };

  function getWorkspaceById(id, userId = "") {
    const row = statements.selectWorkspaceById.get(id);
    if (!workspaceVisibleToUser(row, userId)) {
      return null;
    }
    return parseWorkspace(row);
  }

  function getSourceById(id, userId = "") {
    const source = parseSource(statements.selectSourceById.get(id));
    if (!source) {
      return null;
    }
    return getWorkspaceById(source.workspaceId, userId) ? source : null;
  }

  function createWorkspace(input) {
    const timestamp = nowIso();
    const record = {
      id: randomUUID(),
      name: input.name,
      slug: slugify(input.name),
      ownerUserId: input.ownerUserId || null,
      rootPath: input.rootPath || "",
      description: input.description || "",
      notificationWebhookUrl: input.notificationDestination ?? input.notificationWebhookUrl ?? "",
      notificationDigestMinutes: Number(input.notificationDigestMinutes || 0),
      notificationQuietStart: input.notificationQuietStart || "",
      notificationQuietEnd: input.notificationQuietEnd || "",
      notificationIntentIdsJson: JSON.stringify(normalizeIntentIds(input.notificationIntentIds)),
      notificationMinIdleMinutes: Number(input.notificationMinIdleMinutes || 0),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    statements.insertWorkspace.run(record);
    return getWorkspaceById(record.id, input.ownerUserId || "");
  }

  function updateWorkspace(id, input, userId = "") {
    const existing = getWorkspaceById(id, userId);
    if (!existing) {
      return null;
    }

    const record = {
      id,
      name: input.name ?? existing.name,
      slug: slugify(input.name ?? existing.name),
      ownerUserId: input.ownerUserId ?? existing.ownerUserId ?? null,
      rootPath: input.rootPath ?? existing.rootPath ?? "",
      description: input.description ?? existing.description ?? "",
      notificationWebhookUrl: input.notificationDestination ?? input.notificationWebhookUrl ?? existing.notificationWebhookUrl ?? "",
      notificationDigestMinutes: Number(input.notificationDigestMinutes ?? existing.notificationDigestMinutes ?? 0),
      notificationQuietStart: input.notificationQuietStart ?? existing.notificationQuietStart ?? "",
      notificationQuietEnd: input.notificationQuietEnd ?? existing.notificationQuietEnd ?? "",
      notificationIntentIdsJson: JSON.stringify(
        input.notificationIntentIds !== undefined
          ? normalizeIntentIds(input.notificationIntentIds)
          : (existing.notificationIntentIds ?? [])
      ),
      notificationMinIdleMinutes: Number(input.notificationMinIdleMinutes ?? existing.notificationMinIdleMinutes ?? 0),
      updatedAt: nowIso()
    };
    statements.updateWorkspace.run(record);
    return getWorkspaceById(id, userId);
  }

  function listWorkspaces(userId = "") {
    return statements.listWorkspaces.all()
      .filter((row) => workspaceVisibleToUser(row, userId))
      .map(parseWorkspace);
  }

  function countUsers() {
    return Number(statements.countUsers.get().count || 0);
  }

  function getUserById(id) {
    return parseUser(statements.selectUserById.get(id));
  }

  function getUserByEmail(email) {
    return parseUser(statements.selectUserByEmail.get(String(email || "").toLowerCase()));
  }

  function getUserRecordByEmail(email) {
    return statements.selectUserByEmail.get(String(email || "").toLowerCase()) || null;
  }

  function createUser({ email, name, passwordHash, role = "admin" }) {
    const timestamp = nowIso();
    const record = {
      id: randomUUID(),
      email: String(email || "").toLowerCase(),
      name,
      passwordHash,
      role,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    statements.insertUser.run(record);
    return getUserById(record.id);
  }

  function createAuthSession({ userId, tokenHash, expiresAt }) {
    const record = {
      id: randomUUID(),
      userId,
      tokenHash,
      createdAt: nowIso(),
      expiresAt
    };
    statements.insertAuthSession.run(record);
    return parseAuthSession({
      id: record.id,
      user_id: record.userId,
      token_hash: record.tokenHash,
      created_at: record.createdAt,
      expires_at: record.expiresAt
    });
  }

  function getAuthSessionByTokenHash(tokenHash) {
    return parseAuthSession(statements.selectAuthSessionByTokenHash.get(tokenHash, nowIso()));
  }

  function deleteAuthSessionByTokenHash(tokenHash) {
    statements.deleteAuthSessionByTokenHash.run(tokenHash);
  }

  function claimUnownedWorkspaces(userId) {
    statements.claimUnownedWorkspaces.run(userId);
  }

  function createSource(input, plaintextToken) {
    const timestamp = nowIso();
    const record = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      type: input.type,
      name: input.name,
      tokenHash: createTokenHash(plaintextToken),
      tokenPreview: `${plaintextToken.slice(0, 8)}...${plaintextToken.slice(-4)}`,
      createdAt: timestamp,
      lastSeenAt: null
    };
    statements.insertSource.run(record);
    return {
      ...parseSource(statements.selectSourceByHash.get(record.tokenHash)),
      plaintextToken
    };
  }

  function listSources(userId = "") {
    return statements.listSources.all()
      .map(parseSource)
      .filter((source) => getWorkspaceById(source.workspaceId, userId));
  }

  function findSourceByToken(token) {
    if (!token) {
      return null;
    }

    return parseSource(statements.selectSourceByHash.get(createTokenHash(token)));
  }

  function findSourceForWorkspaceType(workspaceId, type) {
    return parseSource(statements.selectSourceForWorkspaceType.get(workspaceId, type));
  }

  function getAnalysisById(id) {
    return parseAnalysis(statements.selectAnalysisById.get(id));
  }

  function getLatestAnalysisForSession(sessionId) {
    return parseAnalysis(statements.selectLatestAnalysisForSession.get(sessionId));
  }

  function listAnalysesForSession(sessionId, limit = 10, userId = "") {
    return getSessionById(sessionId, userId)
      ? statements.selectAnalysesForSession.all(sessionId, limit).map(parseAnalysis)
      : [];
  }

  function getLatestFeedbackForSession(sessionId) {
    return parseFeedback(statements.selectLatestFeedbackForSession.get(sessionId));
  }

  function listFeedbackForSession(sessionId, userId = "") {
    return getSessionById(sessionId, userId)
      ? statements.selectFeedbackForSession.all(sessionId).map(parseFeedback)
      : [];
  }

  function hydrateSession(row) {
    if (!row) {
      return null;
    }

    const latestAnalysis = getLatestAnalysisForSession(row.id) || (row.latest_analysis_id ? getAnalysisById(row.latest_analysis_id) : null);
    const latestFeedback = getLatestFeedbackForSession(row.id);
    const derivedStatus = row.status === "resolved"
      ? "resolved"
      : (latestAnalysis?.summary?.staleAssessment?.isStale ? "stale" : "active");
    const derivedSummary = latestAnalysis
      ? `${latestAnalysis.predictedIntent.label} at ${Math.round((latestAnalysis.predictedIntent.confidence || 0) * 100)}% confidence`
      : row.summary;

    return parseSession(
      {
        ...row,
        latest_analysis_id: latestAnalysis?.id ?? row.latest_analysis_id,
        status: derivedStatus,
        summary: derivedSummary
      },
      latestAnalysis,
      latestFeedback
    );
  }

  function getSessionById(id, userId = "") {
    const hydrated = hydrateSession(statements.selectSessionById.get(id));
    if (!hydrated) {
      return null;
    }
    return getWorkspaceById(hydrated.workspaceId, userId) ? hydrated : null;
  }

  function saveIngestion({ workspaceId, sourceId, sessionId, title, channel, occurredAt, normalizedSnapshot }) {
    const existing = getSessionById(sessionId);
    const status = existing?.status === "resolved" ? "resolved" : "active";
    const summary = existing?.summary || "";

    if (!existing) {
      statements.insertSession.run({
        id: sessionId,
        workspaceId,
        sourceId,
        channel,
        status,
        title,
        summary,
        latestSnapshotJson: JSON.stringify(normalizedSnapshot),
        latestAnalysisId: null,
        startedAt: occurredAt,
        lastActivityAt: occurredAt,
        endedAt: null
      });
    } else {
      statements.updateSession.run({
        id: sessionId,
        title,
        channel,
        status: existing.status === "resolved" ? "active" : status,
        summary,
        latestSnapshotJson: JSON.stringify(normalizedSnapshot),
        lastActivityAt: occurredAt,
        endedAt: null,
        latestAnalysisId: existing.latestAnalysisId
      });
    }

    statements.insertIngestionEvent.run({
      id: randomUUID(),
      sessionId,
      sourceId,
      payloadJson: JSON.stringify(normalizedSnapshot),
      createdAt: occurredAt
    });
    statements.touchSource.run(occurredAt, sourceId);
    return getSessionById(sessionId);
  }

  function createAnalysis({ sessionId, workspaceId, summary }) {
    const timestamp = nowIso();
    const analysisId = randomUUID();

    statements.insertAnalysis.run({
      id: analysisId,
      sessionId,
      workspaceId,
      predictedIntentId: summary.predictedIntent.id,
      predictedIntentLabel: summary.predictedIntent.label,
      confidence: summary.predictedIntent.confidence,
      staleScore: summary.staleAssessment.idleMinutes,
      evidenceJson: JSON.stringify(summary.evidence),
      nextStepsJson: JSON.stringify(summary.suggestedNextSteps),
      summaryJson: JSON.stringify(summary),
      createdAt: timestamp
    });

    statements.attachAnalysisToSession.run({
      analysisId,
      sessionId,
      summary: `${summary.predictedIntent.label} at ${Math.round(summary.predictedIntent.confidence * 100)}% confidence`,
      status: summary.staleAssessment.isStale ? "stale" : "active"
    });

    return getAnalysisById(analysisId);
  }

  function listSessions(limit = 20, userId = "") {
    return statements.listSessions.all(limit)
      .map(hydrateSession)
      .filter((session) => getWorkspaceById(session.workspaceId, userId));
  }

  function listAllSessions(userId = "") {
    return statements.listAllSessions.all()
      .map(hydrateSession)
      .filter((session) => getWorkspaceById(session.workspaceId, userId));
  }

  function listAnalyses(limit = 20, userId = "") {
    return statements.listAnalyses.all(limit)
      .map(parseAnalysis)
      .filter((analysis) => getWorkspaceById(analysis.workspaceId, userId));
  }

  function resolveSession(sessionId) {
    statements.resolveSession.run({
      id: sessionId,
      endedAt: nowIso()
    });
    return getSessionById(sessionId);
  }

  function setSessionPinned(sessionId, pinned) {
    const existing = getSessionById(sessionId);
    if (!existing) {
      return null;
    }

    statements.setSessionPinned.run({
      id: sessionId,
      pinned: pinned ? 1 : 0,
      pinnedAt: pinned ? nowIso() : null
    });
    return getSessionById(sessionId);
  }

  function deleteSession(sessionId) {
    const existing = getSessionById(sessionId);
    if (!existing) {
      return null;
    }

    statements.deleteNotificationsForSession.run(sessionId, sessionId);
    statements.deleteFeedbackForSession.run(sessionId);
    statements.deleteAnalysesForSession.run(sessionId);
    statements.deleteIngestionEventsForSession.run(sessionId);
    statements.deleteSession.run(sessionId);
    return existing;
  }

  function createFeedback({ sessionId, analysisId, verdict, actualIntentId, note }) {
    const record = {
      id: randomUUID(),
      sessionId,
      analysisId: analysisId || null,
      verdict,
      actualIntentId: actualIntentId || null,
      note: note || "",
      createdAt: nowIso()
    };
    statements.insertFeedback.run(record);
    return {
      id: record.id,
      sessionId: record.sessionId,
      analysisId: record.analysisId,
      verdict: record.verdict,
      actualIntentId: record.actualIntentId,
      note: record.note,
      createdAt: record.createdAt
    };
  }

  function listFeedback(limit = 50, userId = "") {
    return statements.listFeedback.all(limit)
      .map(parseFeedback)
      .filter((feedback) => getSessionById(feedback.sessionId, userId));
  }

  function listFeedbackExamples(workspaceId = "", userId = "") {
    const sessions = workspaceId
      ? listAllSessions(userId).filter((session) => session.workspaceId === workspaceId)
      : listAllSessions(userId);

    return sessions
      .map((session) => {
        const feedback = getLatestFeedbackForSession(session.id);
        if (!feedback || !session.latestSnapshot) {
          return null;
        }

        const actualIntentId = feedback.actualIntentId || (feedback.verdict === "correct" ? session.latestAnalysis?.predictedIntent?.id : "");
        if (!actualIntentId) {
          return null;
        }

        return {
          sessionId: session.id,
          intentId: actualIntentId,
          verdict: feedback.verdict,
          snapshot: session.latestSnapshot
        };
      })
      .filter(Boolean);
  }

  function createNotification({ analysisId, sessionId, workspaceId, destination, payload, throttleMinutes = 90 }) {
    const existingByAnalysis = statements.selectNotificationByAnalysisAndDestination.get(analysisId, destination);
    if (existingByAnalysis) {
      return {
        ...parseNotification(existingByAnalysis),
        throttled: false
      };
    }

    const latestForSession = statements.selectLatestNotificationForSessionAndDestination.get(sessionId, destination);
    if (latestForSession) {
      const latestTimestamp = latestForSession.last_attempt_at || latestForSession.delivered_at || latestForSession.created_at;
      const ageMinutes = latestTimestamp ? (Date.now() - new Date(latestTimestamp).getTime()) / 60000 : Number.POSITIVE_INFINITY;
      if (ageMinutes < throttleMinutes) {
        return {
          ...parseNotification(latestForSession),
          throttled: true
        };
      }
    }

    const record = {
      id: randomUUID(),
      sessionId,
      analysisId,
      workspaceId,
      destination,
      status: "pending",
      payloadJson: JSON.stringify(payload),
      deliveredAt: null,
      createdAt: nowIso(),
      lastAttemptAt: null,
      attemptCount: 0,
      lastError: ""
    };

    statements.insertNotification.run(record);
    return {
      id: record.id,
      sessionId: record.sessionId,
      analysisId: record.analysisId,
      workspaceId: record.workspaceId,
      destination: record.destination,
      status: record.status,
      payload,
      deliveredAt: record.deliveredAt,
      createdAt: record.createdAt,
      lastAttemptAt: record.lastAttemptAt,
      attemptCount: record.attemptCount,
      lastError: record.lastError,
      throttled: false
    };
  }

  function markNotificationsDelivered(ids) {
    const deliveredAt = nowIso();
    ids.forEach((id) => {
      statements.markNotificationDelivered.run({ id, deliveredAt });
    });
  }

  function markNotificationFailures(results) {
    const lastAttemptAt = nowIso();
    results.forEach((result) => {
      statements.markNotificationFailed.run({
        id: result.id,
        lastAttemptAt,
        lastError: result.error || "Unknown dispatch failure"
      });
    });
  }

  function listPendingNotifications(limit = 50) {
    return statements.listPendingNotifications.all(limit).map(parseNotification);
  }

  function listNotificationLogs(limit = 50, userId = "") {
    return statements.listNotifications.all(limit)
      .map(parseNotification)
      .filter((notification) => getWorkspaceById(notification.workspaceId, userId));
  }

  function listSessionTimeline(sessionId, limit = 8, userId = "") {
    if (!getSessionById(sessionId, userId)) {
      return [];
    }
    return statements.selectIngestionEventsForSession.all(sessionId, limit).map(parseIngestionEvent);
  }

  function getSessionComparison(sessionId, userId = "") {
    const analyses = listAnalysesForSession(sessionId, 2, userId);
    if (analyses.length < 2) {
      return null;
    }

    return {
      latest: analyses[0],
      previous: analyses[1]
    };
  }

  function getEvaluationSummary(userId = "") {
    const sessions = listAllSessions(userId);
    const latestFeedback = sessions
      .map((session) => ({
        session,
        feedback: getLatestFeedbackForSession(session.id)
      }))
      .filter((entry) => entry.feedback && entry.session.latestAnalysis);

    const verdictCounts = {
      correct: 0,
      partial: 0,
      wrong: 0
    };
    const confusion = {};

    latestFeedback.forEach(({ session, feedback }) => {
      const predicted = session.latestAnalysis.predictedIntent.id;
      const actual = feedback.actualIntentId || (feedback.verdict === "correct" ? predicted : "unlabeled");

      if (feedback.verdict in verdictCounts) {
        verdictCounts[feedback.verdict] += 1;
      }

      if (!confusion[actual]) {
        confusion[actual] = {};
      }
      confusion[actual][predicted] = (confusion[actual][predicted] || 0) + 1;
    });

    const labeledSessions = latestFeedback.length;
    const exactMatches = Object.entries(confusion).reduce((sum, [actual, predictedCounts]) => sum + (predictedCounts[actual] || 0), 0);

    return {
      labeledSessions,
      verdictCounts,
      exactAccuracy: labeledSessions ? Number((exactMatches / labeledSessions).toFixed(2)) : 0,
      confusion,
      examples: latestFeedback.slice(0, 20).map(({ session, feedback }) => ({
        sessionId: session.id,
        title: session.title,
        predictedIntentId: session.latestAnalysis.predictedIntent.id,
        actualIntentId: feedback.actualIntentId || session.latestAnalysis.predictedIntent.id,
        verdict: feedback.verdict,
        note: feedback.note
      }))
    };
  }

  function exportSessionsBundle(userId = "") {
    const sessions = listAllSessions(userId).map((session) => ({
      sessionId: session.id,
      title: session.title,
      workspaceId: session.workspaceId,
      sourceId: session.sourceId,
      channel: session.channel,
      latestSnapshot: session.latestSnapshot,
      latestAnalysis: session.latestAnalysis,
      feedback: listFeedbackForSession(session.id, userId)
    }));

    return {
      exportedAt: nowIso(),
      workspaces: listWorkspaces(userId),
      sources: listSources(userId),
      sessions
    };
  }

  function getDashboard(userId = "") {
    const workspaces = listWorkspaces(userId);
    const sources = listSources(userId);
    const sessions = listSessions(24, userId);
    const analyses = listAnalyses(24, userId);
    const feedback = listFeedback(24, userId);

    return {
      metrics: {
        workspaces: workspaces.length,
        sources: sources.length,
        activeSessions: sessions.filter((session) => session.status === "active").length,
        staleSessions: sessions.filter((session) => session.status === "stale").length,
        analyses: analyses.length,
        pinnedSessions: sessions.filter((session) => session.pinned).length,
        labeledSessions: getEvaluationSummary(userId).labeledSessions
      },
      workspaces,
      sources,
      recentSessions: sessions,
      recentAnalyses: analyses,
      recentFeedback: feedback,
      recentBenchmarks: listBenchmarkRuns(6),
      notificationLogs: listNotificationLogs(12, userId),
      evaluationSummary: getEvaluationSummary(userId)
    };
  }

  function createBenchmarkRun({ modelVersion, datasetLabel, results }) {
    const record = {
      id: randomUUID(),
      modelVersion,
      datasetLabel,
      resultsJson: JSON.stringify(results),
      createdAt: nowIso()
    };
    statements.insertBenchmarkRun.run(record);
    return {
      id: record.id,
      modelVersion: record.modelVersion,
      datasetLabel: record.datasetLabel,
      results,
      createdAt: record.createdAt
    };
  }

  function listBenchmarkRuns(limit = 10) {
    return statements.listBenchmarkRuns.all(limit).map(parseBenchmarkRun);
  }

  return {
    close() {
      db.close();
    },
    countUsers,
    createUser,
    getUserById,
    getUserByEmail,
    getUserRecordByEmail,
    createAuthSession,
    getAuthSessionByTokenHash,
    deleteAuthSessionByTokenHash,
    claimUnownedWorkspaces,
    getWorkspaceById,
    getSourceById,
    createWorkspace,
    updateWorkspace,
    listWorkspaces,
    createSource,
    listSources,
    findSourceByToken,
    findSourceForWorkspaceType,
    saveIngestion,
    getSessionById,
    listSessions,
    listAllSessions,
    createAnalysis,
    getLatestAnalysisForSession,
    listAnalyses,
    listAnalysesForSession,
    resolveSession,
    setSessionPinned,
    deleteSession,
    createFeedback,
    listFeedback,
    listFeedbackForSession,
    listFeedbackExamples,
    getSessionComparison,
    getEvaluationSummary,
    exportSessionsBundle,
    createNotification,
    listPendingNotifications,
    listNotificationLogs,
    markNotificationsDelivered,
    markNotificationFailures,
    listSessionTimeline,
    createBenchmarkRun,
    listBenchmarkRuns,
    getDashboard
  };
}
