import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";

export interface VerifiedAuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  authTime: number;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: VerifiedAuthUser;
    }
  }
}

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedCerts: Record<string, string> = {};
let certsExpiresAtMs = 0;

function readFirebaseProjectId(): string {
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as { projectId?: string };
    if (parsed?.projectId) return parsed.projectId;
  } catch {
    // Fallback to env if config missing
  }
  return process.env.FIREBASE_PROJECT_ID || "gen-lang-client-0853462519";
}

export const FIREBASE_PROJECT_ID = readFirebaseProjectId();

function base64UrlToBuffer(segment: string): Buffer {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const padded = pad ? b64 + "=".repeat(4 - pad) : b64;
  return Buffer.from(padded, "base64");
}

async function getGoogleSecureTokenCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && Object.keys(cachedCerts).length > 0 && now < certsExpiresAtMs) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    if (Object.keys(cachedCerts).length > 0) {
      return cachedCerts;
    }
    throw new Error(`Failed to fetch Google token verification certificates (${res.status})`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;

  cachedCerts = certs;
  certsExpiresAtMs = now + maxAgeSec * 1000;
  return certs;
}

export async function verifyFirebaseIdTokenString(
  token: string,
  certsOverride?: Record<string, string>,
  projectIdOverride?: string,
  nowSecOverride?: number
): Promise<VerifiedAuthUser> {
  const projectId = projectIdOverride || FIREBASE_PROJECT_ID;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("INVALID_TOKEN_FORMAT");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
  };

  try {
    header = JSON.parse(base64UrlToBuffer(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlToBuffer(payloadB64).toString("utf8"));
  } catch {
    throw new Error("INVALID_TOKEN_JSON");
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new Error("INVALID_TOKEN_HEADER");
  }

  const certs = certsOverride || (await getGoogleSecureTokenCerts(false));
  let pem = certs[header.kid];
  if (!pem && !certsOverride) {
    const refreshed = await getGoogleSecureTokenCerts(true);
    pem = refreshed[header.kid];
  }
  if (!pem) {
    throw new Error("UNKNOWN_TOKEN_KID");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = base64UrlToBuffer(signatureB64);

  if (!verifier.verify(pem, signature)) {
    throw new Error("INVALID_TOKEN_SIGNATURE");
  }

  const nowSec = nowSecOverride ?? Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) {
    throw new Error("INVALID_TOKEN_AUDIENCE");
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("INVALID_TOKEN_ISSUER");
  }
  if (
    typeof payload.sub !== "string" ||
    payload.sub.length < 1 ||
    payload.sub.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(payload.sub)
  ) {
    throw new Error("INVALID_TOKEN_SUBJECT");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("TOKEN_EXPIRED");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) {
    throw new Error("INVALID_TOKEN_IAT");
  }
  if (typeof payload.auth_time === "number" && payload.auth_time > nowSec + 300) {
    throw new Error("INVALID_TOKEN_AUTH_TIME");
  }
  if (payload.email_verified !== true) {
    throw new Error("EMAIL_NOT_VERIFIED");
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: true,
    authTime: typeof payload.auth_time === "number" ? payload.auth_time : payload.iat,
  };
}

// Per-IP and per-UID sliding-window rate limiting + temporary auth abuse lockout
const ipWindowHits = new Map<string, number[]>();
const uidWindowHits = new Map<string, number[]>();
const ipAuthFailures = new Map<string, { count: number; firstFailAt: number; lockedUntil: number }>();

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function recordWindowHit(store: Map<string, number[]>, key: string, windowMs: number, limit: number): boolean {
  const now = Date.now();
  const existing = (store.get(key) || []).filter((ts) => now - ts < windowMs);
  if (existing.length >= limit) {
    store.set(key, existing);
    return false;
  }
  existing.push(now);
  store.set(key, existing);
  return true;
}

export function clearSecurityRateLimits(): void {
  ipWindowHits.clear();
  uidWindowHits.clear();
  ipAuthFailures.clear();
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  res.setHeader("X-XSS-Protection", "0");

  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }
  next();
}

export function apiCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const allowedOrigins = new Set<string>([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  if (process.env.APP_URL) {
    try {
      allowedOrigins.add(new URL(process.env.APP_URL).origin);
    } catch {
      // Ignore invalid APP_URL
    }
  }
  if (host) {
    allowedOrigins.add(`https://${host}`);
    allowedOrigins.add(`http://${host}`);
  }

  if (origin) {
    if (!allowedOrigins.has(origin)) {
      res.status(403).json({
        error: "Origin not authorized to access Oopsie API.",
        code: "CORS_FORBIDDEN",
      });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Oopsie-AI-Paused");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function validateAndSanitizeBody(value: unknown, depth = 0): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (depth > 12) {
    return { ok: false, reason: "Payload nesting limit exceeded." };
  }
  if (value === null || value === undefined) {
    return { ok: true, value };
  }
  if (typeof value !== "object") {
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    const cleanArr: unknown[] = [];
    for (const item of value) {
      const checked = validateAndSanitizeBody(item, depth + 1);
      if (!checked.ok) return checked;
      cleanArr.push(checked.value);
    }
    return { ok: true, value: cleanArr };
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key) || key.startsWith("$") || key.includes(".")) {
      return { ok: false, reason: `Disallowed payload property key: ${key.slice(0, 32)}` };
    }
    const checked = validateAndSanitizeBody((value as Record<string, unknown>)[key], depth + 1);
    if (!checked.ok) return checked;
    out[key] = checked.value;
  }
  return { ok: true, value: out };
}

export function apiSanitizeAndContentTypeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const clientIp = getClientIp(req);
  if (!recordWindowHit(ipWindowHits, clientIp, 60_000, 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({
      error: "Rate limit reached. Please wait a minute before trying again.",
      code: "RATE_LIMITED",
    });
    return;
  }

  if (req.method === "POST") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      res.status(415).json({
        error: "Content-Type must be application/json.",
        code: "UNSUPPORTED_MEDIA_TYPE",
      });
      return;
    }

    const sanitized = validateAndSanitizeBody(req.body);
    if (!sanitized.ok) {
      res.status(400).json({
        error: sanitized.reason,
        code: "INVALID_PAYLOAD",
      });
      return;
    }
    req.body = sanitized.value;
  }
  next();
}

export async function requireVerifiedAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const clientIp = getClientIp(req);
  const now = Date.now();
  const failRecord = ipAuthFailures.get(clientIp);
  if (failRecord && failRecord.lockedUntil > now) {
    res.setHeader("Retry-After", String(Math.ceil((failRecord.lockedUntil - now) / 1000)));
    res.status(429).json({
      error: "Too many failed authentication attempts. Temporarily locked for 60 seconds.",
      code: "AUTH_LOCKOUT",
    });
    return;
  }

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    recordAuthFailure(clientIp);
    res.status(401).json({
      error: "Authentication required. Please sign in with Google.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    recordAuthFailure(clientIp);
    res.status(401).json({
      error: "Authentication token is missing.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  try {
    const verified = await verifyFirebaseIdTokenString(token);
    ipAuthFailures.delete(clientIp);

    if (!recordWindowHit(uidWindowHits, verified.uid, 60_000, 45)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({
        error: "Account rate limit exceeded. Please wait briefly before retrying.",
        code: "USER_RATE_LIMITED",
      });
      return;
    }

    req.authUser = verified;
    next();
  } catch (err) {
    recordAuthFailure(clientIp);
    const code = err instanceof Error ? err.message : "INVALID_TOKEN";
    res.status(401).json({
      error:
        code === "EMAIL_NOT_VERIFIED"
          ? "A verified email address is required."
          : "Your session token is invalid or expired. Please sign in again.",
      code: "AUTH_INVALID",
    });
  }
}

function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const prev = ipAuthFailures.get(ip);
  if (!prev || now - prev.firstFailAt > 5 * 60_000) {
    ipAuthFailures.set(ip, { count: 1, firstFailAt: now, lockedUntil: 0 });
    return;
  }
  const nextCount = prev.count + 1;
  ipAuthFailures.set(ip, {
    count: nextCount,
    firstFailAt: prev.firstFailAt,
    lockedUntil: nextCount >= 10 ? now + 60_000 : 0,
  });
}

export function enforceAiNotPaused(req: Request, res: Response, next: NextFunction): void {
  const headerPaused = String(req.headers["x-oopsie-ai-paused"] || "").toLowerCase() === "true";
  const body = (req.body || {}) as Record<string, unknown>;
  const bodyPaused = body.aiAnalysisPaused === true;
  if (headerPaused || bodyPaused) {
    res.status(403).json({
      error: "AI analysis is paused in your Privacy & Security Centre.",
      code: "AI_PAUSED",
    });
    return;
  }
  next();
}

export function fenceUntrustedText(raw: string, maxLen = 14000): string {
  const trimmed = String(raw || "").slice(0, maxLen);
  const neutralized = trimmed.replace(/<\/?untrusted_input>/gi, "[redacted_tag]");
  return `<untrusted_input>\n${neutralized}\n</untrusted_input>`;
}

export const ALLOWED_TEXT_EXTENSIONS = new Set([".txt", ".json", ".csv", ".eml", ".srt", ".vtt"]);
export const ALLOWED_AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".webm", ".ogg", ".aac", ".flac"]);

export function validateUploadedFilePayload(input: {
  fileName?: string;
  kind?: "text" | "audio";
  sizeBytes?: number;
  headerSampleBase64?: string;
  textPreview?: string;
}): { ok: true; safeFileName: string; ext: string } | { ok: false; reason: string } {
  const rawName = String(input.fileName || "").trim();
  if (!rawName || rawName.length > 180) {
    return { ok: false, reason: "Invalid file name length." };
  }
  if (rawName.includes("..") || rawName.includes("/") || rawName.includes("\\") || rawName.includes("\0")) {
    return { ok: false, reason: "File name contains disallowed path traversal characters." };
  }

  const safeFileName = rawName.replace(/[^a-zA-Z0-9._\-\s]/g, "_");
  const ext = path.extname(safeFileName).toLowerCase();
  const kind = input.kind === "audio" ? "audio" : "text";
  const sizeBytes = Number(input.sizeBytes || 0);

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, reason: "Uploaded file is empty." };
  }

  if (kind === "text") {
    if (!ALLOWED_TEXT_EXTENSIONS.has(ext)) {
      return { ok: false, reason: `File type ${ext || "(none)"} is not allowed. Use .txt, .json, .csv, .eml, .srt, or .vtt.` };
    }
    if (sizeBytes > 2 * 1024 * 1024) {
      return { ok: false, reason: "Conversation export files must be under 2 MB." };
    }
  } else {
    if (!ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
      return { ok: false, reason: `Audio format ${ext || "(none)"} is not supported.` };
    }
    if (sizeBytes > 10 * 1024 * 1024) {
      return { ok: false, reason: "Audio files must be under 10 MB." };
    }
  }

  if (input.headerSampleBase64) {
    try {
      const bytes = Buffer.from(input.headerSampleBase64, "base64");
      const magicAscii = bytes.subarray(0, 4).toString("latin1");
      if (magicAscii.startsWith("MZ") || magicAscii.startsWith("\x7fELF") || magicAscii.startsWith("#!")) {
        return { ok: false, reason: "Executable or script binaries are blocked." };
      }
      if (magicAscii.startsWith("PK\x03\x04")) {
        return { ok: false, reason: "Archive or executable zip containers are not permitted." };
      }
      if (kind === "text" && bytes.includes(0)) {
        return { ok: false, reason: "Binary content detected inside text upload." };
      }
    } catch {
      return { ok: false, reason: "Malformed file header sample." };
    }
  }

  if (kind === "text" && typeof input.textPreview === "string") {
    const sample = input.textPreview.slice(0, 4000);
    if (/<script\b|javascript:|<iframe\b|<svg\b[^>]*on\w+=/i.test(sample)) {
      return { ok: false, reason: "Potentially unsafe active script tags detected inside file." };
    }
  }

  return { ok: true, safeFileName, ext };
}
