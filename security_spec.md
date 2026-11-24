# Oopsie Firestore Security Specification

## 1. Data Invariants
1. Every `/users/{userId}` document belongs exclusively to the verified Firebase Auth user whose `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. Every subcollection document under `/users/{userId}/reminders/{reminderId}`, `/users/{userId}/sessions/{sessionId}`, `/users/{userId}/privacySettings/{settingId}`, `/users/{userId}/auditLogs/{logId}`, and `/users/{userId}/contacts/{contactId}` belongs strictly to `userId` (`ownerId == request.auth.uid`), validates `id`, and enforces parent existence (`exists(/databases/$(database)/documents/users/$(userId))`) on creation.
3. No user can read, list, create, update, or delete another user's profile, reminders, sessions, privacy settings, audit logs, or encrypted contacts.
4. Security audit logs (`/users/{userId}/auditLogs/{logId}`) are strictly append-only: `update` and `delete` are denied for all client users so audit trails cannot be tampered with or erased.
5. `ownerId`, `id`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` are strictly validated against server `request.time`.
6. All strings, arrays, numbers, and document IDs are strictly bounded to prevent resource exhaustion ("Denial of Wallet") or shadow field injection.

## 2. "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated read**: `get /users/alice` with `auth == null`.
2. **Unverified email write**: `create /users/alice` with `auth.token.email_verified == false`.
3. **Cross-user profile read (PII leak)**: `get /users/alice` with `auth.uid == "bob"`.
4. **Cross-user reminder list**: `list /users/alice/reminders` with `auth.uid == "bob"`.
5. **Owner spoofing on create**: `create /users/bob/reminders/rem-1` with `ownerId: "alice"`.
6. **Shadow / ghost field injection**: `create /users/bob` with extra `{ isAdmin: true }`.
7. **ID poisoning**: `create /users/bob/reminders/../../etc/passwd` or 200-char ID.
8. **Client timestamp forgery**: `create /users/bob/reminders/rem-1` with `createdAt` != `request.time`.
9. **Immutable ownerId mutation**: `update /users/bob/reminders/rem-1` changing `ownerId` from `"bob"` to `"alice"`.
10. **Immutable audit log tampering**: `update` or `delete /users/bob/auditLogs/log-1` even by `"bob"`.
11. **Oversized payload / unbounded timeline**: `create /users/bob/contacts/c-1` with `encryptedPayload.size() > 16000` or `timeline.size() > 200`.
12. **Cross-user session revocation**: `update /users/alice/sessions/s-1` setting `revoked: true` with `auth.uid == "bob"`.
