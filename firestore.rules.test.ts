/**
 * Adversarial Security Rules Specification & Verification Suite for Oopsie Firestore
 * Covers User A vs User B isolation, Unauthenticated Access Denial, and the 12 Dirty Dozen payloads.
 *
 * To run against a local Firebase Emulator:
 *   npm install -D @firebase/rules-unit-testing vitest
 *   firebase emulators:exec --only firestore "npx vitest run firestore.rules.test.ts"
 */

export interface AdversarialRuleCase {
  id: string;
  scenario: string;
  actor: { uid: string | null; emailVerified: boolean };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  expected: 'ALLOW' | 'DENY';
  payload?: Record<string, unknown>;
}

export const ADVERSARIAL_FIRESTORE_CASES: AdversarialRuleCase[] = [
  {
    id: 'DD-01',
    scenario: 'Unauthenticated read on user profile',
    actor: { uid: null, emailVerified: false },
    operation: 'get',
    path: '/users/alice',
    expected: 'DENY',
  },
  {
    id: 'DD-02',
    scenario: 'Unverified email write blocked',
    actor: { uid: 'alice', emailVerified: false },
    operation: 'create',
    path: '/users/alice',
    expected: 'DENY',
  },
  {
    id: 'DD-03',
    scenario: 'Cross-user profile read (User B reading User A)',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'get',
    path: '/users/alice',
    expected: 'DENY',
  },
  {
    id: 'DD-04',
    scenario: 'Cross-user reminders list (IDOR collection enumeration)',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'list',
    path: '/users/alice/reminders',
    expected: 'DENY',
  },
  {
    id: 'DD-05',
    scenario: 'Owner spoofing on reminder create',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'create',
    path: '/users/bob/reminders/rem-1',
    expected: 'DENY',
    payload: { id: 'rem-1', ownerId: 'alice', title: 'Spoofed' },
  },
  {
    id: 'DD-06',
    scenario: 'Shadow/ghost field injection (isAdmin)',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'create',
    path: '/users/bob',
    expected: 'DENY',
    payload: { ownerId: 'bob', name: 'Bob', isAdmin: true },
  },
  {
    id: 'DD-07',
    scenario: 'Path/ID poisoning with traversal characters',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'create',
    path: '/users/bob/reminders/..%2Fetc%2Fpasswd',
    expected: 'DENY',
  },
  {
    id: 'DD-08',
    scenario: 'Client timestamp forgery (createdAt != request.time)',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'create',
    path: '/users/bob/reminders/rem-2',
    expected: 'DENY',
    payload: { id: 'rem-2', ownerId: 'bob', createdAt: '2020-01-01T00:00:00Z' },
  },
  {
    id: 'DD-09',
    scenario: 'Immutable ownerId mutation via update',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'update',
    path: '/users/bob/reminders/rem-1',
    expected: 'DENY',
    payload: { ownerId: 'alice' },
  },
  {
    id: 'DD-10',
    scenario: 'Immutable audit log tampering/deletion even by owner',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'delete',
    path: '/users/bob/auditLogs/log-1',
    expected: 'DENY',
  },
  {
    id: 'DD-11',
    scenario: 'Oversized encrypted contact payload (>16000 chars)',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'create',
    path: '/users/bob/contacts/c-1',
    expected: 'DENY',
    payload: { id: 'c-1', ownerId: 'bob', encryptedPayload: 'x'.repeat(16005) },
  },
  {
    id: 'DD-12',
    scenario: 'Cross-user session revocation (Bob revoking Alice session)',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'update',
    path: '/users/alice/sessions/s-1',
    expected: 'DENY',
    payload: { revoked: true },
  },
  {
    id: 'ALLOW-01',
    scenario: 'Verified owner reads own reminders with ownerId filter',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'list',
    path: '/users/alice/reminders',
    expected: 'ALLOW',
  },
];
