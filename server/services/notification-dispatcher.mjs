import { sendSmtpMail } from "./smtp-client.mjs";

function splitRecipients(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDestination(destination = "") {
  const value = String(destination || "").trim();
  if (!value) {
    return { kind: "unknown", raw: value };
  }

  if (value.startsWith("slack:")) {
    return { kind: "slack", url: value.slice("slack:".length) };
  }
  if (value.startsWith("discord:")) {
    return { kind: "discord", url: value.slice("discord:".length) };
  }
  if (value.startsWith("email:")) {
    return { kind: "email", recipients: splitRecipients(value.slice("email:".length)) };
  }
  if (/hooks\.slack\.com/i.test(value)) {
    return { kind: "slack", url: value };
  }
  if (/discord(?:app)?\.com\/api\/webhooks/i.test(value)) {
    return { kind: "discord", url: value };
  }
  if (/^https?:\/\//i.test(value)) {
    return { kind: "webhook", url: value };
  }

  return { kind: "unknown", raw: value };
}

function summarizeBatch(workspace, notifications, digest) {
  const intents = [...new Set(notifications.map((notification) => notification.payload?.predictedIntent?.label).filter(Boolean))];
  const sessions = notifications.map((notification) => ({
    sessionId: notification.sessionId,
    sessionTitle: notification.payload?.sessionTitle || notification.payload?.title || notification.sessionId,
    predictedIntent: notification.payload?.predictedIntent || null,
    evidence: notification.payload?.evidence || [],
    suggestedNextSteps: notification.payload?.suggestedNextSteps || [],
    staleAssessment: notification.payload?.staleAssessment || {}
  }));

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    digest,
    sessionCount: sessions.length,
    intents,
    sessions
  };
}

function buildPlainText(summary) {
  const header = summary.digest
    ? `Intent Resurrection digest for ${summary.workspaceName}`
    : `Intent Resurrection alert for ${summary.workspaceName}`;

  const sessionLines = summary.sessions.flatMap((session, index) => {
    const evidence = session.evidence.slice(0, 2).map((item) => `  - ${item}`);
    const nextSteps = session.suggestedNextSteps.slice(0, 2).map((item) => `  - ${item}`);
    return [
      `${index + 1}. ${session.sessionTitle}`,
      `   Intent: ${session.predictedIntent?.label || "Unknown"} (${Math.round((session.predictedIntent?.confidence || 0) * 100)}%)`,
      `   Idle: ${session.staleAssessment?.idleMinutes || 0} minutes`,
      evidence.length ? "   Evidence:" : null,
      ...evidence,
      nextSteps.length ? "   Next steps:" : null,
      ...nextSteps
    ].filter(Boolean);
  });

  return [header, "", ...sessionLines].join("\n");
}

function buildSlackPayload(summary) {
  const intro = summary.digest
    ? `*${summary.workspaceName}* has ${summary.sessionCount} stale sessions ready for recovery.`
    : `*${summary.workspaceName}* has a stale session ready for recovery.`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: intro
      }
    }
  ];

  summary.sessions.slice(0, 8).forEach((session) => {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${session.sessionTitle}*\nIntent: ${session.predictedIntent?.label || "Unknown"} (${Math.round((session.predictedIntent?.confidence || 0) * 100)}%)\nIdle: ${session.staleAssessment?.idleMinutes || 0} minutes`
      }
    });
    if (session.suggestedNextSteps?.length) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Next: ${session.suggestedNextSteps[0]}`
          }
        ]
      });
    }
  });

  return {
    text: intro,
    blocks
  };
}

function buildDiscordPayload(summary) {
  return {
    content: summary.digest
      ? `${summary.workspaceName}: ${summary.sessionCount} stale sessions`
      : `${summary.workspaceName}: stale session ready for recovery`,
    embeds: summary.sessions.slice(0, 10).map((session) => ({
      title: session.sessionTitle,
      description: session.evidence?.[0] || "Recovery guidance available.",
      fields: [
        {
          name: "Intent",
          value: `${session.predictedIntent?.label || "Unknown"} (${Math.round((session.predictedIntent?.confidence || 0) * 100)}%)`,
          inline: true
        },
        {
          name: "Idle",
          value: `${session.staleAssessment?.idleMinutes || 0} minutes`,
          inline: true
        },
        {
          name: "Next Step",
          value: session.suggestedNextSteps?.[0] || "Open the session and continue.",
          inline: false
        }
      ]
    }))
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Dispatch failed with ${response.status}${text ? `: ${text}` : ""}`);
  }
}

async function dispatchGroup(summary, destination, config) {
  const parsed = parseDestination(destination);

  if (parsed.kind === "slack") {
    await postJson(parsed.url, buildSlackPayload(summary));
    return { channel: "slack" };
  }

  if (parsed.kind === "discord") {
    await postJson(parsed.url, buildDiscordPayload(summary));
    return { channel: "discord" };
  }

  if (parsed.kind === "email") {
    await sendSmtpMail(config.smtp, {
      to: parsed.recipients,
      subject: summary.digest
        ? `${summary.workspaceName}: ${summary.sessionCount} stale sessions`
        : `${summary.workspaceName}: stale session recovery`,
      text: buildPlainText(summary)
    });
    return { channel: "email" };
  }

  if (parsed.kind === "webhook") {
    await postJson(parsed.url, summary);
    return { channel: "webhook" };
  }

  throw new Error(`Unsupported notification destination: ${destination}`);
}

function groupPendingNotifications(notifications, workspaces, defaultDigestMinutes) {
  const workspaceMap = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const groups = new Map();

  notifications.forEach((notification) => {
    const workspace = workspaceMap.get(notification.workspaceId);
    if (!workspace) {
      return;
    }

    const key = `${notification.workspaceId}::${notification.destination}`;
    const existing = groups.get(key) || {
      workspace,
      destination: notification.destination,
      digestMinutes: Number(workspace.notificationDigestMinutes ?? defaultDigestMinutes ?? 0),
      notifications: []
    };
    existing.notifications.push(notification);
    groups.set(key, existing);
  });

  return [...groups.values()];
}

function parseClockMinutes(value = "") {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
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
  if (start === null || end === null || start === end) {
    return false;
  }

  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

export async function dispatchPendingNotifications({ store, config }) {
  const pending = store.listPendingNotifications(120);
  const workspaces = store.listWorkspaces();
  const groups = groupPendingNotifications(pending, workspaces, config.defaultDigestMinutes);
  const deliveredIds = [];
  const failures = [];
  const batches = [];

  for (const group of groups) {
    if (isWithinQuietHours(group.workspace)) {
      batches.push({
        workspaceId: group.workspace.id,
        destination: group.destination,
        channel: "deferred",
        digest: group.digestMinutes > 0 || group.notifications.length > 1,
        notificationCount: group.notifications.length,
        skippedReason: "quiet-hours"
      });
      continue;
    }

    const digest = group.digestMinutes > 0 || group.notifications.length > 1;

    if (digest) {
      const summary = summarizeBatch(group.workspace, group.notifications, true);
      try {
        const result = await dispatchGroup(summary, group.destination, config);
        deliveredIds.push(...group.notifications.map((notification) => notification.id));
        batches.push({
          workspaceId: group.workspace.id,
          destination: group.destination,
          channel: result.channel,
          digest: true,
          notificationCount: group.notifications.length
        });
      } catch (error) {
        group.notifications.forEach((notification) => {
          failures.push({
            id: notification.id,
            error: error.message
          });
        });
      }
      continue;
    }

    for (const notification of group.notifications) {
      const summary = summarizeBatch(group.workspace, [notification], false);
      try {
        const result = await dispatchGroup(summary, group.destination, config);
        deliveredIds.push(notification.id);
        batches.push({
          workspaceId: group.workspace.id,
          destination: group.destination,
          channel: result.channel,
          digest: false,
          notificationCount: 1
        });
      } catch (error) {
        failures.push({
          id: notification.id,
          error: error.message
        });
      }
    }
  }

  if (deliveredIds.length > 0) {
    store.markNotificationsDelivered(deliveredIds);
  }
  if (failures.length > 0) {
    store.markNotificationFailures(failures);
  }

  return {
    pending: pending.length,
    delivered: deliveredIds.length,
    failed: failures.length,
    batches,
    failures
  };
}
