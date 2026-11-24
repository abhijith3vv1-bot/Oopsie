import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  deleteUser,
  GoogleAuthProvider,
  multiFactor,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  type MultiFactorInfo,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, workspaceGoogleProvider } from '../firebase';
import type { AuditEventType, PrivacySettingsRecord } from '../types/reminder';
import { purgeAllConnectData } from '../services/connect';
import { clearLocalContactsVault } from '../services/contacts';
import { getLocalVaultKeyVersion } from '../services/cryptoVault';
import {
  loadOrCreatePrivacySettings,
  purgeAllUserFirestoreRecords,
  registerOrTouchSession,
  subscribeToSessionStatus,
  updatePrivacySettings,
  writeAuditLog,
} from '../services/firestoreSync';
import { clearAllData } from '../services/storage';

interface WorkspaceConnectionResult {
  accessToken: string;
  email: string | null;
}

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  isSigningIn: boolean;
  authError: string | null;
  guestMode: boolean;
  workspaceToken: string | null;
  workspaceEmail: string | null;
  isConnectingWorkspace: boolean;
  workspaceAuthError: string | null;
  currentSessionId: string;
  deviceLabel: string;
  lastReauthAt: number | null;
  enrolledMfaFactors: MultiFactorInfo[];
  privacySettings: PrivacySettingsRecord | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
  enterGuestMode: () => void;
  clearAuthError: () => void;
  connectGoogleWorkspace: () => Promise<WorkspaceConnectionResult | null>;
  disconnectGoogleWorkspace: () => void;
  clearWorkspaceAuthError: () => void;
  reauthenticateWithGoogle: (force?: boolean) => Promise<boolean>;
  auditEvent: (
    eventType: AuditEventType,
    summary: string,
    severity?: 'info' | 'warning' | 'critical'
  ) => Promise<void>;
  refreshPrivacySettings: () => Promise<PrivacySettingsRecord | null>;
  savePrivacySettings: (
    patch: Partial<
      Pick<
        PrivacySettingsRecord,
        'aiAnalysisPaused' | 'gmailSyncPaused' | 'calendarSyncPaused' | 'keyVersion'
      >
    >
  ) => Promise<PrivacySettingsRecord | null>;
  registerCurrentDeviceSession: (uid: string) => Promise<void>;
  deleteUserAccountCompletely: () => Promise<boolean>;
}

const GUEST_MODE_KEY = 'oopsie_guest_mode_v1';
const DEVICE_SESSION_KEY = 'oopsie_device_session_id_v1';

function detectDeviceSummary(): { deviceLabel: string; browserSummary: string } {
  if (typeof navigator === 'undefined') {
    return { deviceLabel: 'Web Browser', browserSummary: 'Browser session' };
  }
  const ua = navigator.userAgent || '';
  let os = 'Desktop';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS Device';
  else if (/Android/i.test(ua)) os = 'Android Device';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows PC';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Web Browser';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Google Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Mozilla Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  return {
    deviceLabel: `${browser} on ${os}`.slice(0, 120),
    browserSummary: `${browser} · ${os}`.slice(0, 160),
  };
}

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) {
      return existing;
    }
    const fresh = `sess_${crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    sessionStorage.setItem(DEVICE_SESSION_KEY, fresh);
    return fresh;
  } catch {
    return `sess_${crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [guestMode, setGuestMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GUEST_MODE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // In-memory only Google Workspace OAuth access token (never persisted to storage)
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [workspaceEmail, setWorkspaceEmail] = useState<string | null>(null);
  const [isConnectingWorkspace, setIsConnectingWorkspace] = useState(false);
  const [workspaceAuthError, setWorkspaceAuthError] = useState<string | null>(null);

  const [currentSessionId] = useState<string>(() => getOrCreateSessionId());
  const [{ deviceLabel, browserSummary }] = useState(() => detectDeviceSummary());
  const [lastReauthAt, setLastReauthAt] = useState<number | null>(null);
  const [enrolledMfaFactors, setEnrolledMfaFactors] = useState<MultiFactorInfo[]>([]);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettingsRecord | null>(null);

  const signOutUser = useCallback(async () => {
    setWorkspaceToken(null);
    setWorkspaceEmail(null);
    setWorkspaceAuthError(null);
    setLastReauthAt(null);
    setPrivacySettings(null);
    setEnrolledMfaFactors([]);
    await signOut(auth);
    setGuestMode(false);
    try {
      localStorage.removeItem(GUEST_MODE_KEY);
      sessionStorage.removeItem(DEVICE_SESSION_KEY);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      if (nextUser && !nextUser.emailVerified) {
        setAuthError('Please verify your Google email address before signing into Oopsie.');
        void signOut(auth);
        setUser(null);
        setAuthReady(true);
        return;
      }

      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        setGuestMode(false);
        try {
          localStorage.removeItem(GUEST_MODE_KEY);
        } catch {
          // Ignore storage error
        }
        try {
          const factors = multiFactor(nextUser).enrolledFactors || [];
          setEnrolledMfaFactors(factors);
        } catch {
          setEnrolledMfaFactors([]);
        }
      } else {
        setWorkspaceToken(null);
        setWorkspaceEmail(null);
        setLastReauthAt(null);
        setPrivacySettings(null);
        setEnrolledMfaFactors([]);
      }
    });
    return () => unsub();
  }, []);

  // Watch active device session in Firestore for real-time revocation ("Log out from all devices")
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToSessionStatus(user.uid, currentSessionId, () => {
      setAuthError('This device session was signed out from your Privacy & Security Centre.');
      void signOutUser();
    });
    return () => unsub();
  }, [user, currentSessionId, signOutUser]);

  const auditEvent = useCallback(
    async (
      eventType: AuditEventType,
      summary: string,
      severity: 'info' | 'warning' | 'critical' = 'info'
    ) => {
      if (!auth.currentUser) return;
      await writeAuditLog(auth.currentUser.uid, eventType, summary, severity, deviceLabel);
    },
    [deviceLabel]
  );

  const registerCurrentDeviceSession = useCallback(
    async (uid: string) => {
      await registerOrTouchSession(uid, currentSessionId, deviceLabel, browserSummary);
      const settings = await loadOrCreatePrivacySettings(uid, getLocalVaultKeyVersion());
      setPrivacySettings(settings);
    },
    [currentSessionId, deviceLabel, browserSummary]
  );

  const refreshPrivacySettings = useCallback(async (): Promise<PrivacySettingsRecord | null> => {
    if (!auth.currentUser) return null;
    const settings = await loadOrCreatePrivacySettings(
      auth.currentUser.uid,
      getLocalVaultKeyVersion()
    );
    setPrivacySettings(settings);
    return settings;
  }, []);

  const savePrivacySettings = useCallback(
    async (
      patch: Partial<
        Pick<
          PrivacySettingsRecord,
          'aiAnalysisPaused' | 'gmailSyncPaused' | 'calendarSyncPaused' | 'keyVersion'
        >
      >
    ): Promise<PrivacySettingsRecord | null> => {
      if (!auth.currentUser) return null;
      const updated = await updatePrivacySettings(auth.currentUser.uid, patch);
      setPrivacySettings(updated);
      return updated;
    },
    []
  );

  const signInWithGoogle = async (): Promise<User | null> => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!result.user.emailVerified) {
        await signOut(auth);
        setAuthError('A verified email address is required to access Oopsie.');
        return null;
      }
      setLastReauthAt(Date.now());
      setGuestMode(false);
      try {
        localStorage.removeItem(GUEST_MODE_KEY);
      } catch {
        // Ignore
      }
      return result.user;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in could not be completed.';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError(
          'Sign-in popup was closed before completing. Tap again whenever you are ready.'
        );
      } else if (msg.includes('popup-blocked')) {
        setAuthError(
          'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.'
        );
      } else {
        setAuthError(msg);
      }
      return null;
    } finally {
      setIsSigningIn(false);
    }
  };

  const reauthenticateWithGoogle = async (force = false): Promise<boolean> => {
    const activeUser = auth.currentUser;
    if (!activeUser) return false;
    if (!force && lastReauthAt && Date.now() - lastReauthAt < 5 * 60 * 1000) {
      return true;
    }
    try {
      await reauthenticateWithPopup(activeUser, googleProvider);
      setLastReauthAt(Date.now());
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Re-authentication could not be completed.';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('Verification popup was closed before completing.');
      } else if (msg.includes('popup-blocked')) {
        setAuthError('Popup was blocked by your browser. Allow popups to verify your identity.');
      } else {
        setAuthError(msg);
      }
      return false;
    }
  };

  const connectGoogleWorkspace = async (): Promise<WorkspaceConnectionResult | null> => {
    setIsConnectingWorkspace(true);
    setWorkspaceAuthError(null);
    try {
      const result = await signInWithPopup(auth, workspaceGoogleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken ?? null;
      if (!accessToken) {
        setWorkspaceAuthError(
          'Google did not return a read-only access token. Please grant permission in the popup and try again.'
        );
        return null;
      }
      const email = result.user.email ?? null;
      setWorkspaceToken(accessToken);
      setWorkspaceEmail(email);
      setLastReauthAt(Date.now());
      if (result.user.uid) {
        void writeAuditLog(
          result.user.uid,
          'integration_connected',
          'Authorized read-only Google Workspace access (Gmail & Calendar).',
          'info',
          deviceLabel
        );
      }
      return { accessToken, email };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not authorize Google Workspace access.';
      if (msg.includes('popup-closed-by-user')) {
        setWorkspaceAuthError('Permission popup was closed before completing.');
      } else if (msg.includes('popup-blocked')) {
        setWorkspaceAuthError(
          'Popup was blocked by your browser. Please allow popups for this site and try again.'
        );
      } else {
        setWorkspaceAuthError(msg);
      }
      return null;
    } finally {
      setIsConnectingWorkspace(false);
    }
  };

  const disconnectGoogleWorkspace = () => {
    setWorkspaceToken(null);
    setWorkspaceEmail(null);
    setWorkspaceAuthError(null);
    if (auth.currentUser) {
      void writeAuditLog(
        auth.currentUser.uid,
        'integration_disconnected',
        'Cleared active Google Workspace read-only session token.',
        'info',
        deviceLabel
      );
    }
  };

  const enterGuestMode = () => {
    setGuestMode(true);
    setAuthError(null);
    try {
      localStorage.setItem(GUEST_MODE_KEY, 'true');
    } catch {
      // Ignore
    }
  };

  const deleteUserAccountCompletely = async (): Promise<boolean> => {
    const activeUser = auth.currentUser;
    if (!activeUser) return false;

    const verified = await reauthenticateWithGoogle(true);
    if (!verified) return false;

    await writeAuditLog(
      activeUser.uid,
      'account_deleted',
      'User verified identity and initiated complete account & data deletion.',
      'critical',
      deviceLabel
    );

    await purgeAllUserFirestoreRecords(activeUser.uid);
    clearAllData();
    clearLocalContactsVault();
    await purgeAllConnectData();

    setWorkspaceToken(null);
    setWorkspaceEmail(null);
    setPrivacySettings(null);

    await deleteUser(activeUser);
    try {
      localStorage.removeItem(GUEST_MODE_KEY);
      sessionStorage.removeItem(DEVICE_SESSION_KEY);
    } catch {
      // Ignore
    }
    return true;
  };

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        isSigningIn,
        authError,
        guestMode,
        workspaceToken,
        workspaceEmail,
        isConnectingWorkspace,
        workspaceAuthError,
        currentSessionId,
        deviceLabel,
        lastReauthAt,
        enrolledMfaFactors,
        privacySettings,
        signInWithGoogle,
        signOutUser,
        enterGuestMode,
        clearAuthError: () => setAuthError(null),
        connectGoogleWorkspace,
        disconnectGoogleWorkspace,
        clearWorkspaceAuthError: () => setWorkspaceAuthError(null),
        reauthenticateWithGoogle,
        auditEvent,
        refreshPrivacySettings,
        savePrivacySettings,
        registerCurrentDeviceSession,
        deleteUserAccountCompletely,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebaseAuth() {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebaseAuth must be used inside FirebaseProvider');
  }
  return ctx;
}
