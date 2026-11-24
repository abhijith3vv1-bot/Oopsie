import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Download,
  History,
  KeyRound,
  Laptop,
  Lock,
  LogIn,
  LogOut,
  Mail,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlink,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  AuditLogRecord,
  ContactProfile,
  ReminderItem,
  SecuritySessionRecord,
  UserProfile,
} from '../types/reminder';
import { useFirebaseAuth } from '../contexts/FirebaseContext';
import { setClientAiAnalysisPaused } from '../services/api';
import {
  loadEncryptedConversations,
  loadEncryptedDetectedResponses,
  loadIntegrationsMap,
  purgeAllConnectData,
  saveIntegrationsMap,
} from '../services/connect';
import {
  clearLocalContactsVault,
  CONTACTS_VAULT_KEY,
} from '../services/contacts';
import {
  getLocalVaultKeyVersion,
  rotateVaultKeyForStorageKeys,
} from '../services/cryptoVault';
import {
  clearCloudContacts,
  listAuditLogs,
  listUserSessions,
  revokeAllUserSessions,
  revokeSession,
  syncEncryptedContactToCloud,
} from '../services/firestoreSync';
import { ITEMS_VAULT_KEY } from '../services/storage';
import { formatTimelineTimestamp } from '../services/time';
import { ConfirmDialog } from './ConfirmDialog';

interface PrivacySecurityViewProps {
  profile: UserProfile;
  items: ReminderItem[];
  contactsMap: Record<string, ContactProfile>;
  onClearContacts: () => void;
  onClearAllRemindersAndLocal: () => void;
  onNotifyToast: (msg: string) => void;
}

const ALL_VAULT_STORAGE_KEYS = [
  ITEMS_VAULT_KEY,
  CONTACTS_VAULT_KEY,
  'oopsie_connect_conversations_vault_v1',
  'oopsie_connect_responses_vault_v1',
];

export function PrivacySecurityView({
  profile,
  items,
  contactsMap,
  onClearContacts,
  onClearAllRemindersAndLocal,
  onNotifyToast,
}: PrivacySecurityViewProps) {
  const {
    user,
    isSigningIn,
    signInWithGoogle,
    signOutUser,
    workspaceToken,
    workspaceEmail,
    disconnectGoogleWorkspace,
    currentSessionId,
    lastReauthAt,
    enrolledMfaFactors,
    privacySettings,
    reauthenticateWithGoogle,
    auditEvent,
    refreshPrivacySettings,
    savePrivacySettings,
    deleteUserAccountCompletely,
  } = useFirebaseAuth();

  const [sessions, setSessions] = useState<SecuritySessionRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loadingSecurityData, setLoadingSecurityData] = useState(false);
  const [connectCount, setConnectCount] = useState(0);
  const [emailCacheCount, setEmailCacheCount] = useState(0);
  const [keyVersion, setKeyVersion] = useState<number>(() => getLocalVaultKeyVersion());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<
    | null
    | 'logout_all'
    | 'delete_connect'
    | 'delete_contacts'
    | 'delete_account'
  >(null);

  const integrations = loadIntegrationsMap();

  const loadCloudSecurityData = useCallback(async () => {
    void Promise.all([loadEncryptedConversations(), loadEncryptedDetectedResponses()]).then(
      ([convos, responses]) => {
        setConnectCount(convos.length);
        setEmailCacheCount(responses.length);
      }
    );

    if (!user) return;
    setLoadingSecurityData(true);
    try {
      const [sessList, logsList, settings] = await Promise.all([
        listUserSessions(user.uid),
        listAuditLogs(user.uid),
        refreshPrivacySettings(),
      ]);
      setSessions(sessList);
      setAuditLogs(logsList);
      if (settings) {
        setKeyVersion(Math.max(getLocalVaultKeyVersion(), settings.keyVersion));
        setClientAiAnalysisPaused(settings.aiAnalysisPaused);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not load cloud security logs.'
      );
    } finally {
      setLoadingSecurityData(false);
    }
  }, [user, refreshPrivacySettings]);

  useEffect(() => {
    void loadCloudSecurityData();
  }, [loadCloudSecurityData]);

  const handleTogglePrivacyFlag = async (
    key: 'aiAnalysisPaused' | 'gmailSyncPaused' | 'calendarSyncPaused',
    nextVal: boolean
  ) => {
    if (!user) {
      if (key === 'aiAnalysisPaused') {
        setClientAiAnalysisPaused(nextVal);
        onNotifyToast(nextVal ? 'AI analysis paused on this device.' : 'AI analysis resumed.');
      }
      return;
    }
    setBusyAction(key);
    setActionError(null);
    try {
      const updated = await savePrivacySettings({ [key]: nextVal });
      if (key === 'aiAnalysisPaused' && updated) {
        setClientAiAnalysisPaused(updated.aiAnalysisPaused);
      }
      const labelMap = {
        aiAnalysisPaused: nextVal ? 'Paused AI analysis' : 'Resumed AI analysis',
        gmailSyncPaused: nextVal ? 'Paused Gmail sync' : 'Resumed Gmail sync',
        calendarSyncPaused: nextVal
          ? 'Paused Google Calendar sync'
          : 'Resumed Google Calendar sync',
      };
      await auditEvent('ai_privacy_updated', labelMap[key], 'info');
      onNotifyToast(labelMap[key]);
      await loadCloudSecurityData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update privacy control.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeSingleSession = async (sessionId: string) => {
    if (!user) return;
    setBusyAction(`revoke-${sessionId}`);
    setActionError(null);
    try {
      await revokeSession(user.uid, sessionId);
      await auditEvent('session_revoked', `Revoked active device session (${sessionId.slice(0, 12)}).`, 'warning');
      onNotifyToast('Device session revoked.');
      await loadCloudSecurityData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke session.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogoutAllDevices = async () => {
    setConfirmDialog(null);
    if (!user) return;
    setBusyAction('logout_all');
    setActionError(null);
    try {
      const verified = await reauthenticateWithGoogle(false);
      if (!verified) return;
      const count = await revokeAllUserSessions(user.uid);
      await auditEvent(
        'logout_all',
        `Signed out all active device sessions (${count} sessions revoked).`,
        'warning'
      );
      disconnectGoogleWorkspace();
      onNotifyToast('All device sessions signed out.');
      await signOutUser();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not sign out all devices.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRotateEncryptionKey = async () => {
    setBusyAction('rotate_key');
    setActionError(null);
    try {
      if (user) {
        const verified = await reauthenticateWithGoogle(false);
        if (!verified) return;
      }

      const nextVersion = await rotateVaultKeyForStorageKeys(ALL_VAULT_STORAGE_KEYS);
      setKeyVersion(nextVersion);

      if (user) {
        // Re-encrypt cloud contacts with the rotated key
        for (const contact of Object.values(contactsMap)) {
          await syncEncryptedContactToCloud(user.uid, contact);
        }
        await savePrivacySettings({ keyVersion: nextVersion });
        await auditEvent(
          'key_rotated',
          `Rotated AES-GCM-256 encryption key to version v${nextVersion} and re-encrypted stored vaults.`,
          'info'
        );
        await loadCloudSecurityData();
      }
      onNotifyToast(`Encryption key rotated to v${nextVersion}.`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not rotate local encryption key.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportAllPersonalData = async () => {
    setBusyAction('export_data');
    setActionError(null);
    try {
      if (user) {
        const verified = await reauthenticateWithGoogle(true);
        if (!verified) return;
      }

      const [conversations, responses] = await Promise.all([
        loadEncryptedConversations(),
        loadEncryptedDetectedResponses(),
      ]);

      const bundle = {
        version: 2,
        exportedAt: new Date().toISOString(),
        accountEmail: user?.email || null,
        profile,
        reminders: items,
        contacts: Object.values(contactsMap),
        importedConversations: conversations,
        detectedEmailResponses: responses,
      };

      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oopsie-personal-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      if (user) {
        await auditEvent(
          'data_exported',
          `Exported personal archive (${items.length} reminders, ${conversations.length} conversations).`,
          'info'
        );
        await loadCloudSecurityData();
      }
      onNotifyToast('Personal data archive exported.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Data export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteConnectArchive = async () => {
    setConfirmDialog(null);
    setBusyAction('delete_connect');
    setActionError(null);
    try {
      disconnectGoogleWorkspace();
      await purgeAllConnectData();
      const resetMap = loadIntegrationsMap();
      for (const k of Object.keys(resetMap) as Array<keyof typeof resetMap>) {
        resetMap[k] = {
          ...resetMap[k],
          connected: false,
          connectedEmail: null,
          lastSyncedAt: null,
        };
      }
      saveIntegrationsMap(resetMap);
      setConnectCount(0);
      setEmailCacheCount(0);
      if (user) {
        await auditEvent(
          'data_deleted',
          'Deleted all imported Connect conversations, email caches, and rotated vault key.',
          'warning'
        );
        await loadCloudSecurityData();
      }
      onNotifyToast('Imported conversations and email cache cleared.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete Connect data.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteAllContacts = async () => {
    setConfirmDialog(null);
    setBusyAction('delete_contacts');
    setActionError(null);
    try {
      clearLocalContactsVault();
      onClearContacts();
      if (user) {
        await clearCloudContacts(user.uid);
        await auditEvent(
          'data_deleted',
          'Deleted all stored contacts from local vault and cloud database.',
          'warning'
        );
        await loadCloudSecurityData();
      }
      onNotifyToast('All contacts deleted.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete contacts.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCompleteAccountDeletion = async () => {
    setConfirmDialog(null);
    setBusyAction('delete_account');
    setActionError(null);
    try {
      const ok = await deleteUserAccountCompletely();
      if (ok) {
        onClearAllRemindersAndLocal();
        onNotifyToast('Your Oopsie account and stored data have been deleted.');
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'Could not delete account. Please verify your Google identity and try again.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisconnectWorkspace = async () => {
    disconnectGoogleWorkspace();
    const map = loadIntegrationsMap();
    map.gmail = { ...map.gmail, connected: false, connectedEmail: null, lastSyncedAt: null };
    map.google_calendar = {
      ...map.google_calendar,
      connected: false,
      connectedEmail: null,
      lastSyncedAt: null,
    };
    saveIntegrationsMap(map);
    onNotifyToast('Disconnected Gmail and Google Calendar session tokens.');
    await loadCloudSecurityData();
  };

  const aiPaused = privacySettings?.aiAnalysisPaused ?? false;
  const gmailPaused = privacySettings?.gmailSyncPaused ?? false;
  const calendarPaused = privacySettings?.calendarSyncPaused ?? false;
  const reauthRecent = Boolean(lastReauthAt && Date.now() - lastReauthAt < 5 * 60 * 1000);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF]">
              <ShieldCheck className="w-4 h-4" />
              <span>Privacy &amp; Security Centre</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-[#24212B] dark:text-[#F5F3FA]">
              Control your data, sessions &amp; encryption
            </h1>
            <p className="text-sm text-[#666173] dark:text-[#A7A2B8] max-w-2xl leading-relaxed">
              Manage active devices, connected read-only email accounts, AES-GCM-256 encryption keys, immutable security activity logs, and AI privacy controls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {user ? (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void reauthenticateWithGoogle(true)}
                className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#EAE4FF] hover:bg-[#DDD3FA] dark:bg-[#2B2444] dark:hover:bg-[#382F58] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold transition-colors"
              >
                <UserCheck className="w-4 h-4" />
                <span>{reauthRecent ? 'Identity Verified' : 'Verify Identity'}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isSigningIn}
                onClick={() => void signInWithGoogle()}
                className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="mt-4 rounded-2xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 px-4 py-3 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}
      </section>

      {!user && (
        <section className="rounded-2xl bg-amber-50/75 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              You are currently using local device mode. Local AES-GCM-256 encryption, key rotation, and local export work right now, while cloud data isolation, AI assistant verification, active device sessions, and immutable audit logs require Google Sign-In.
            </p>
          </div>
          <button
            type="button"
            disabled={isSigningIn}
            onClick={() => void signInWithGoogle()}
            className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold shrink-0"
          >
            Sign in now
          </button>
        </section>
      )}

      {/* 1. Account Security */}
      <section className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-base font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
                1. Account Security &amp; Active Sessions
              </h2>
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Verified Google identity, MFA status, remote session revocation, and tamper-resistant audit logs.
              </p>
            </div>
          </div>

          {user && (
            <button
              type="button"
              disabled={loadingSecurityData}
              onClick={() => void loadCloudSecurityData()}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-semibold text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA] self-start sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSecurityData ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          )}
        </div>

        {/* Identity & MFA Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#666173] dark:text-[#A7A2B8]">
              Verified Account Identity
            </p>
            {user ? (
              <>
                <p className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA] truncate">
                  {user.email}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Email verified · Isolated workspace (<code className="font-mono">{user.uid.slice(0, 8)}...</code>)
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Not signed in — data stays isolated on this browser only.
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#666173] dark:text-[#A7A2B8]">
              Two-Factor Authentication (MFA)
            </p>
            {user ? (
              <>
                <p className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA]">
                  {enrolledMfaFactors.length > 0
                    ? `${enrolledMfaFactors.length} Firebase MFA factor enrolled`
                    : 'Protected via Google Account Sign-In'}
                </p>
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                  {enrolledMfaFactors.length > 0
                    ? 'Additional app-level second factor is active on your account.'
                    : 'Sign-in uses Google OAuth 2.0 (supporting Google 2-Step Verification & passkeys). App-level TOTP enrollment requires Identity Platform MFA enabled in Google Cloud.'}
                </p>
              </>
            ) : (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Sign in with Google to inspect MFA protection.
              </p>
            )}
          </div>
        </div>

        {/* Active Sessions */}
        {user && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                Active Device Sessions ({sessions.filter((s) => !s.revoked).length})
              </h3>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => setConfirmDialog('logout_all')}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log out from all devices</span>
              </button>
            </div>

            {sessions.length === 0 ? (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] py-2">
                No cloud sessions recorded yet.
              </p>
            ) : (
              <div className="space-y-2">
                {sessions.slice(0, 8).map((sess) => {
                  const isCurrent = sess.id === currentSessionId;
                  return (
                    <div
                      key={sess.id}
                      className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <Laptop className="w-4 h-4 text-[#7657D5] dark:text-[#C5B4FF] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-bold text-[#24212B] dark:text-[#F5F3FA] truncate">
                              {sess.deviceLabel}
                            </p>
                            {isCurrent && !sess.revoked && (
                              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                Current device
                              </span>
                            )}
                            {sess.revoked && (
                              <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                Revoked
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8] mt-0.5">
                            Last active {formatTimelineTimestamp(sess.lastActiveAt)}
                          </p>
                        </div>
                      </div>

                      {!sess.revoked && !isCurrent && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => void handleRevokeSingleSession(sess.id)}
                          className="min-h-[34px] px-3 py-1 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 self-start sm:self-auto"
                        >
                          Sign out device
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Security Activity Log */}
        {user && (
          <div className="space-y-2.5 pt-2 border-t border-[#EEEAF8] dark:border-[#2C2740]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#7657D5] dark:text-[#C5B4FF]" />
                <h3 className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                  Security Activity Log (Append-Only)
                </h3>
              </div>
              <span className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">
                Immutable records
              </span>
            </div>

            {auditLogs.length === 0 ? (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] py-2">
                Security events (sign-ins, exports, key rotations, and privacy updates) will appear here.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {auditLogs.slice(0, 20).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#EFEBF7] dark:border-[#2C2740] px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                  >
                    <div className="min-w-0">
                      <span
                        className={`font-semibold mr-2 ${
                          log.severity === 'critical'
                            ? 'text-rose-600 dark:text-rose-400'
                            : log.severity === 'warning'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-[#7657D5] dark:text-[#C5B4FF]'
                        }`}
                      >
                        {log.eventType}
                      </span>
                      <span className="text-[#24212B] dark:text-[#F5F3FA]">{log.summary}</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8] shrink-0">
                      {formatTimelineTimestamp(log.createdAt)} · {log.deviceLabel}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Connected Applications */}
      <section className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-base font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
              2. Connected Applications &amp; OAuth Permissions
            </h2>
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
              Tokens remain strictly in memory during your active session and are never persisted to browser storage or database records.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Gmail */}
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA]">Gmail</p>
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                  Scope: <code className="font-mono">gmail.readonly</code>
                </p>
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  workspaceToken
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-[#666173] dark:text-[#A7A2B8]'
                }`}
              >
                {workspaceToken
                  ? `Active (${workspaceEmail || integrations.gmail.connectedEmail || 'Google'})`
                  : integrations.gmail.connected
                    ? 'Session ended (reconnect needed)'
                    : 'Not connected'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleTogglePrivacyFlag('gmailSyncPaused', !gmailPaused)}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]"
                >
                  {gmailPaused ? (
                    <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                  )}
                  <span>{gmailPaused ? 'Resume sync' : 'Pause sync'}</span>
                </button>
              )}
              {(workspaceToken || integrations.gmail.connected) && (
                <button
                  type="button"
                  onClick={() => void handleDisconnectWorkspace()}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              )}
            </div>
          </div>

          {/* Google Calendar */}
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <div>
                  <p className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA]">
                    Google Calendar
                  </p>
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                    Scope: <code className="font-mono">calendar.events.readonly</code>
                  </p>
                </div>
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  workspaceToken
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-[#666173] dark:text-[#A7A2B8]'
                }`}
              >
                {workspaceToken ? 'Active' : integrations.google_calendar.connected ? 'Session ended' : 'Not connected'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    void handleTogglePrivacyFlag('calendarSyncPaused', !calendarPaused)
                  }
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]"
                >
                  {calendarPaused ? (
                    <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                  )}
                  <span>{calendarPaused ? 'Resume sync' : 'Pause sync'}</span>
                </button>
              )}
              {(workspaceToken || integrations.google_calendar.connected) && (
                <button
                  type="button"
                  onClick={() => void handleDisconnectWorkspace()}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              )}
            </div>
          </div>

          {/* Transparent status for Outlook & Zoho Mail */}
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA]">
                Microsoft Outlook
              </p>
              <span className="text-[11px] font-medium text-[#666173] dark:text-[#A7A2B8]">
                Not configured
              </span>
            </div>
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
              Direct Microsoft Graph OAuth requires a registered Azure App ID and backend secret. You can still import Outlook emails safely via exported <code className="font-mono">.eml</code> or text in Oopsie Connect.
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA]">Zoho Mail</p>
              <span className="text-[11px] font-medium text-[#666173] dark:text-[#A7A2B8]">
                Not configured
              </span>
            </div>
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
              Direct Zoho Mail OAuth requires registered Zoho API credentials. Exported <code className="font-mono">.eml</code> or pasted messages can still be imported privately in Oopsie Connect.
            </p>
          </div>
        </div>
      </section>

      {/* 3. Personal Data Control & Encryption */}
      <section className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-base font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
              3. Personal Data Control &amp; Encryption Keys
            </h2>
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
              Inspect stored data categories, rotate AES-GCM-256 vault keys, export your archive, or delete specific records.
            </p>
          </div>
        </div>

        {/* Data Categories */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5">
            <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">Reminders &amp; Timelines</p>
            <p className="text-lg font-bold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA] mt-0.5">
              {items.length}
            </p>
          </div>
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5">
            <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">Encrypted Contacts</p>
            <p className="text-lg font-bold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA] mt-0.5">
              {Object.keys(contactsMap).length}
            </p>
          </div>
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5">
            <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">Imported Conversations</p>
            <p className="text-lg font-bold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA] mt-0.5">
              {connectCount}
            </p>
          </div>
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5">
            <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">Email Reply Cache</p>
            <p className="text-lg font-bold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA] mt-0.5">
              {emailCacheCount}
            </p>
          </div>
        </div>

        {/* Key Rotation + Export */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleRotateEncryptionKey()}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#EAE4FF] hover:bg-[#DDD3FA] dark:bg-[#2B2444] dark:hover:bg-[#382F58] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold transition-colors"
          >
            <KeyRound className="w-4 h-4" />
            <span>
              {busyAction === 'rotate_key'
                ? 'Rotating key...'
                : `Rotate AES-GCM-256 Key (Current: v${keyVersion})`}
            </span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleExportAllPersonalData()}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] hover:border-[#7657D5] text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] transition-colors"
          >
            <Download className="w-4 h-4 text-[#7657D5]" />
            <span>
              {busyAction === 'export_data' ? 'Preparing export...' : 'Export Personal Data (Re-auth)'}
            </span>
          </button>
        </div>

        {/* Granular Deletions */}
        <div className="pt-3 border-t border-[#EEEAF8] dark:border-[#2C2740] flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => setConfirmDialog('delete_connect')}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Conversations &amp; Email Cache</span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => setConfirmDialog('delete_contacts')}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Delete All Contacts</span>
          </button>

          {user && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => setConfirmDialog('delete_account')}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Account &amp; All Data</span>
            </button>
          )}
        </div>
      </section>

      {/* 4. AI Privacy */}
      <section className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-base font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
                4. AI Privacy &amp; Processing Controls
              </h2>
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Pause server-side AI parsing, daily briefings, and conversation analysis anytime.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleTogglePrivacyFlag('aiAnalysisPaused', !aiPaused)}
            className={`min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
              aiPaused
                ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800'
                : 'bg-[#7657D5] hover:bg-[#6546C4] text-white'
            }`}
          >
            {aiPaused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
            <span>{aiPaused ? 'AI Paused — Resume' : 'Pause AI Analysis'}</span>
          </button>
        </div>

        <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 text-xs text-[#666173] dark:text-[#A7A2B8] space-y-1.5 leading-relaxed">
          <p className="font-semibold text-[#24212B] dark:text-[#F5F3FA]">
            How Oopsie protects your AI requests:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Every AI endpoint verifies your signed Google session token before processing.</li>
            <li>Imported emails, chats, and transcripts are isolated inside untrusted-data boundaries to resist prompt injection.</li>
            <li>When AI analysis is paused, all AI endpoints reject processing requests and local manual reminder tools continue working offline.</li>
            <li>Oopsie does not use your private reminders, contacts, or imported threads to train public models.</li>
          </ul>
        </div>
      </section>

      {/* Confirmations */}
      <AnimatePresence>
        {confirmDialog === 'logout_all' && (
          <ConfirmDialog
            title="Log out from all devices?"
            description="Every active Oopsie browser session on this account will be revoked immediately and signed out."
            confirmLabel="Log out all devices"
            destructive
            onConfirm={() => void handleLogoutAllDevices()}
            onCancel={() => setConfirmDialog(null)}
          />
        )}

        {confirmDialog === 'delete_connect' && (
          <ConfirmDialog
            title="Delete imported conversations & email cache?"
            description="This permanently erases encrypted Connect conversations, clears detected Gmail reply caches, wipes the old encryption key, and disconnects Google Workspace tokens."
            confirmLabel="Delete conversations"
            destructive
            onConfirm={() => void handleDeleteConnectArchive()}
            onCancel={() => setConfirmDialog(null)}
          />
        )}

        {confirmDialog === 'delete_contacts' && (
          <ConfirmDialog
            title="Delete all contacts?"
            description="All encrypted contact profiles and pinned commitments will be permanently erased from this device and your cloud database."
            confirmLabel="Delete contacts"
            destructive
            onConfirm={() => void handleDeleteAllContacts()}
            onCancel={() => setConfirmDialog(null)}
          />
        )}

        {confirmDialog === 'delete_account' && (
          <ConfirmDialog
            title="Permanently delete your Oopsie account?"
            description="After verifying your Google identity, Oopsie will delete your profile, reminders, encrypted contacts, sessions, privacy config, and local encryption keys. Immutable security audit logs remain non-editable per compliance policy."
            confirmLabel="Verify & Delete Account"
            destructive
            onConfirm={() => void handleCompleteAccountDeletion()}
            onCancel={() => setConfirmDialog(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
