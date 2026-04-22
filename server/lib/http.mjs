import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

export function json(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Source-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
  });
  response.end(body);
}

export function text(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Source-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
  });
  response.end(payload);
}

export async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

export function notFound(response) {
  json(response, 404, { error: "Not Found" });
}

export function badRequest(response, message) {
  json(response, 400, { error: message });
}

export function serverError(response, error) {
  json(response, 500, {
    error: "Internal Server Error",
    message: error instanceof Error ? error.message : String(error)
  });
}

export async function serveStatic(frontendRoot, pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(frontendRoot, `.${requestedPath}`);

  if (!resolved.startsWith(frontendRoot)) {
    notFound(response);
    return;
  }

  try {
    const contents = await readFile(resolved);
    const ext = path.extname(resolved);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream"
    });
    response.end(contents);
  } catch (error) {
    if (requestedPath !== "/index.html" && !path.extname(requestedPath)) {
      await serveStatic(frontendRoot, "/", response);
      return;
    }

    notFound(response);
  }
}

export function createTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseJsonRow(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}
