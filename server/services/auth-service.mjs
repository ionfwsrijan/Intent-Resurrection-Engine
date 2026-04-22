import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createTokenHash } from "../lib/http.mjs";

const PASSWORD_PREFIX = "scrypt";

function bufferToString(value) {
  return Buffer.isBuffer(value) ? value.toString("hex") : String(value || "");
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(String(password || ""), salt, 64);
  return `${PASSWORD_PREFIX}:${bufferToString(salt)}:${bufferToString(derived)}`;
}

export function verifyPassword(password, storedHash) {
  const [scheme, saltHex, hashHex] = String(storedHash || "").split(":");
  if (scheme !== PASSWORD_PREFIX || !saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password || ""), salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export function issueAuthToken() {
  return `iat_${randomBytes(24).toString("hex")}`;
}

export function createAuthSessionRecord({ userId, ttlHours = 168 }) {
  const plaintextToken = issueAuthToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  return {
    userId,
    plaintextToken,
    tokenHash: createTokenHash(plaintextToken),
    expiresAt
  };
}
