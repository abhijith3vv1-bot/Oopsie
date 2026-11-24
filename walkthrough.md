# Security Summary

This document summarizes the multi-layered security, privacy, and data isolation controls implemented across **Oopsie**:

1. **Database & User Data Isolation (`firestore.rules`, `firebase-blueprint.json`, `src/services/firestoreSync.ts`)**
   - Every user record lives strictly under `/users/{userId}` with subcollections (`reminders`, `sessions`, `privacySettings`, `auditLogs`, `contacts`) governed by `isVerifiedOwner(userId)` requiring `request.auth != null`, `request.auth.uid == userId`, verified email (`request.auth.token.email_verified == true`), and regex-validated document IDs (`isValidId`).
   - Strict schema enforcement (`hasAll`, `hasOnly`, `affectedKeys().hasOnly()`) blocks unexpected fields, `ownerId` spoofing, client-forged timestamps (`request.time` required), and privilege escalation.
   - `/users/{userId}/auditLogs` enforces append-only immutability (`allow update, delete: if false`).
   - Rules were statically linted (`npx eslint firestore.rules`) and deployed live to Firestore.

2. **Authentication, Session Control & Audit Logging (`src/contexts/FirebaseContext.tsx`, `server/security.ts`)**
   - Unverified Google accounts are rejected both in Firebase client auth state handling and Firestore rules / backend JWT verification.
   - Active browser sessions are tracked under `/users/{uid}/sessions/{sessionId}` and monitored via real-time snapshot listener so **Log out from all devices** or single-device revocation immediately terminates active sessions.
   - Step-up Google re-authentication (`reauthenticateWithPopup`) protects sensitive operations: data export, encryption key rotation, global logout, and complete account deletion.
   - All backend AI and Connect API endpoints verify RS256 Firebase ID tokens cryptographically against Google's official `securetoken` X.509 certificates (`aud`, `iss`, `sub`, `exp`, `iat`, `auth_time`, `email_verified === true`).

3. **Encryption at Rest & Key Rotation (`src/services/cryptoVault.ts`, `src/services/storage.ts`, `src/services/contacts.ts`, `src/services/connect.ts`)**
   - Browser-stored reminders, contacts, imported Connect conversations, and detected email reply candidates are encrypted using Web Crypto **AES-256-GCM** with unique per-record 96-bit IVs (`v2` envelope) and legacy plaintext storage keys are wiped upon hydration.
   - Contact records synced to Firestore (`/users/{uid}/contacts`) are encrypted client-side before upload.
   - Users can rotate the AES-GCM-256 vault key on demand from the Privacy & Security Centre, decrypting existing vaults under the previous key and re-encrypting under a fresh 256-bit key.

4. **Backend API Hardening, AI Privacy & Upload Defense (`server/security.ts`, `server.ts`, `src/services/api.ts`)**
   - Security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Permissions-Policy`, HSTS on HTTPS, and `Cache-Control: no-store` on `/api/*`).
   - Strict origin allowlist CORS (`403 CORS_FORBIDDEN` for unknown origins), `Content-Type: application/json` enforcement (`415`), recursive sanitization blocking `__proto__`, `constructor`, `prototype`, `$`-prefixed, and `.`-containing keys (`400`), per-IP and per-UID rate limits plus 60s auth failure lockout (`429`).
   - Prompt injection boundary defense wrapping untrusted external emails/transcripts/user prompts inside `<untrusted_input>` tags and filtering AI-returned reminder IDs against an allowlist of the user's own items.
   - Functional **Pause AI Analysis** (`X-Oopsie-AI-Paused` + `aiAnalysisPaused`) enforced both client-side and server-side (`403 AI_PAUSED`).
   - File upload validation (`/api/connect/validate-file`) rejecting path traversal characters, disallowed extensions, oversized files, executable magic bytes (`MZ`, `\x7fELF`, `#!`, `PK\x03\x04`), binary null bytes in text imports, and active script tags.

5. **Privacy & Security Centre (`src/components/PrivacySecurityView.tsx`)**
   - Dedicated view in primary navigation and Settings providing active device management, remote logout, immutable audit log history, read-only OAuth controls (Gmail, Calendar, plus honest configuration status for Outlook/Zoho Mail), key rotation, re-authenticated export, granular deletions, AI pause toggle, and complete account deletion.

## PoC Verification

All checks below were executed against the compiled application and running Express server (`http://127.0.0.1:3000`):

1. **HTTP Security Headers & Health (`GET /api/health`)**: Returned `200 OK` with `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, and `Cache-Control: no-store`.
2. **Unauthenticated & Forged Auth Rejection**: Requests without `Authorization` or with forged RS256 JWTs to `/api/assistant/parse`, `/api/assistant/brain`, `/api/connect/analyze`, and `/api/connect/validate-file` all returned `401`.
3. **Cryptographic Firebase ID Token Verification**: Tested `verifyFirebaseIdTokenString` against an RS256-signed JWT and X.509 certificate: accepted valid verified user claims (`uid`, `emailVerified: true`) and rejected `email_verified: false` (`EMAIL_NOT_VERIFIED`), mismatched audience, and expired tokens.
4. **Cross-Origin Isolation (`Origin: https://evil-attacker.example`)**: Rejected with `403 CORS_FORBIDDEN`.
5. **Content-Type & Payload Injection Defense**: Non-JSON body returned `415 UNSUPPORTED_MEDIA_TYPE`; payloads containing `__proto__`, `constructor`, or `$ne` returned `400 INVALID_PAYLOAD`.
6. **File Upload Malware & Traversal Blocking**: `validateUploadedFilePayload` blocked `../../etc/passwd.txt`, `MZ` Windows executable headers disguised as `.txt`, `\x7fELF` binaries disguised as `.mp3`, and `<script>alert(1)</script>` payloads inside text previews, while accepting clean `.txt` WhatsApp chat exports.
7. **Prompt Injection Boundary Fencing**: `fenceUntrustedText` escaped embedded closing boundary tags and wrapped content inside `<untrusted_input>...</untrusted_input>`.
8. **Brute-Force Auth Lockout**: Repeated unauthorized probes against `/api/assistant/parse` triggered `429` lockout.
9. **Static & Build Audits**: `npm run build` (`vite build`), `tsc --noEmit`, and `npx eslint firestore.rules` all passed with zero errors; source grep confirmed zero client-side `GEMINI_API_KEY` or `workspaceToken` `localStorage` leaks.
