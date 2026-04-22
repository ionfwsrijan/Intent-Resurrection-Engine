import path from "node:path";

export function resolveConfig(overrides = {}) {
  const cwd = process.cwd();

  const resolvedPort = Number(
    overrides.port ?? process.env.PORT ?? process.env.APP_PORT ?? 3000,
  );

  return {
    host: overrides.host ?? process.env.APP_HOST ?? "0.0.0.0",
    port: resolvedPort,
    appBaseUrl:
      overrides.appBaseUrl ??
      process.env.APP_BASE_URL ??
      "http://localhost:3000",
    databasePath: path.resolve(
      cwd,
      overrides.databasePath ??
        process.env.DATABASE_PATH ??
        "./data/intent-resurrection.db",
    ),
    modelArtifactPath: path.resolve(
      cwd,
      overrides.modelArtifactPath ??
        process.env.MODEL_ARTIFACT_PATH ??
        "./data/model-artifact.json",
    ),
    sessionIdleMinutes: Number(
      overrides.sessionIdleMinutes ?? process.env.SESSION_IDLE_MINUTES ?? 60,
    ),
    notificationThrottleMinutes: Number(
      overrides.notificationThrottleMinutes ??
        process.env.NOTIFICATION_THROTTLE_MINUTES ??
        90,
    ),
    defaultDigestMinutes: Number(
      overrides.defaultDigestMinutes ??
        process.env.DEFAULT_NOTIFICATION_DIGEST_MINUTES ??
        0,
    ),
    publicIngestionWebhookUrl:
      overrides.publicIngestionWebhookUrl ??
      process.env.PUBLIC_INGESTION_WEBHOOK_URL ??
      "",
    publicStaleMonitorWebhookUrl:
      overrides.publicStaleMonitorWebhookUrl ??
      process.env.PUBLIC_STALE_MONITOR_WEBHOOK_URL ??
      "",
    authRequired:
      String(
        overrides.authRequired ?? process.env.AUTH_REQUIRED ?? "false",
      ).toLowerCase() === "true",
    authSessionTtlHours: Number(
      overrides.authSessionTtlHours ??
        process.env.AUTH_SESSION_TTL_HOURS ??
        168,
    ),
    authCookieName:
      overrides.authCookieName ?? process.env.AUTH_COOKIE_NAME ?? "intent_auth",
    reportsOutputDir: path.resolve(
      cwd,
      overrides.reportsOutputDir ??
        process.env.REPORTS_OUTPUT_DIR ??
        "./outputs",
    ),
    frontendRoot: path.resolve(cwd, "frontend"),
    taxonomyPath: path.resolve(cwd, "config", "intents.json"),
    trainingExamplesPath: path.resolve(
      cwd,
      overrides.trainingExamplesPath ??
        process.env.TRAINING_EXAMPLES_PATH ??
        "./config/training-examples.json",
    ),
    smtp: {
      host: overrides.smtpHost ?? process.env.SMTP_HOST ?? "",
      port: Number(overrides.smtpPort ?? process.env.SMTP_PORT ?? 465),
      secure:
        String(
          overrides.smtpSecure ?? process.env.SMTP_SECURE ?? "true",
        ).toLowerCase() !== "false",
      user: overrides.smtpUser ?? process.env.SMTP_USER ?? "",
      pass: overrides.smtpPass ?? process.env.SMTP_PASS ?? "",
      from: overrides.smtpFrom ?? process.env.SMTP_FROM ?? "",
      startTls:
        String(
          overrides.smtpStartTls ?? process.env.SMTP_STARTTLS ?? "false",
        ).toLowerCase() === "true",
    },
  };
}
