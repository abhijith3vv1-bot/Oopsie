import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Bell,
  BellOff,
  CalendarDays,
  CheckSquare,
  Cloud,
  Flame,
  Home,
  LayoutGrid,
  Link2,
  LogIn,
  MessageSquareText,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react';
import type {
  AssistantMood,
  ChatItemUpdate,
  ContactProfile,
  ParsedReminderDraft,
  ReminderItem,
  UserProfile,
} from './types/reminder';
import {
  clearAllData,
  getDefaultProfile,
  hydrateEncryptedLocalItems,
  loadItems,
  loadLastSeenAt,
  loadProfile,
  recordLoopClosed,
  saveItems,
  saveLastSeenAt,
  saveProfile,
} from './services/storage';
import {
  clearLocalContactsVault,
  hydrateEncryptedContactsMap,
  loadContactsMap,
  saveContactsMap,
  upsertContactProfile,
} from './services/contacts';
import {
  getSampleContacts,
  getSampleReminders,
  hasSeededSampleData,
  markSampleDataSeeded,
} from './services/sampleData';
import {
  showAlarmNotification,
  startAlarmLoop,
  startTitleFlash,
  stopAlarmLoop,
  stopTitleFlash,
  unlockAudio,
} from './services/alarm';
import {
  formatDueLabel,
  isOverdue,
  isToday,
} from './services/time';
import { AssistantOrb } from './components/AssistantOrb';
import { OnboardingFlow } from './components/OnboardingFlow';
import { DashboardHome, type ReminderFilterTab } from './components/DashboardHome';
import { LiveClock } from './components/LiveClock';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PWAInstallButton } from './components/PWAInstallButton';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { PWAUpdateBanner } from './components/PWAUpdateBanner';
import { OfflineIndicator } from './components/OfflineIndicator';
import { AuthGateCard } from './components/AuthGateCard';
import { setClientAiAnalysisPaused } from './services/api';
import { purgeAllConnectData } from './services/connect';

const RemindersView = lazy(() =>
  import('./components/RemindersView').then((m) => ({ default: m.RemindersView }))
);
const PeopleView = lazy(() =>
  import('./components/PeopleView').then((m) => ({ default: m.PeopleView }))
);
const InsightsView = lazy(() =>
  import('./components/InsightsView').then((m) => ({ default: m.InsightsView }))
);
const BrainView = lazy(() =>
  import('./components/BrainView').then((m) => ({ default: m.BrainView }))
);
const CalendarView = lazy(() =>
  import('./components/CalendarView').then((m) => ({ default: m.CalendarView }))
);
const ConnectView = lazy(() =>
  import('./components/ConnectView').then((m) => ({ default: m.ConnectView }))
);
const PrivacySecurityView = lazy(() =>
  import('./components/PrivacySecurityView').then((m) => ({ default: m.PrivacySecurityView }))
);
const ReminderPopupModal = lazy(() =>
  import('./components/ReminderPopupModal').then((m) => ({ default: m.ReminderPopupModal }))
);
const FollowUpDrawer = lazy(() =>
  import('./components/FollowUpDrawer').then((m) => ({ default: m.FollowUpDrawer }))
);
const WhatHappenedNextModal = lazy(() =>
  import('./components/WhatHappenedNextModal').then((m) => ({ default: m.WhatHappenedNextModal }))
);
const AddReminderModal = lazy(() =>
  import('./components/AddReminderModal').then((m) => ({ default: m.AddReminderModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
import { useFirebaseAuth } from './contexts/FirebaseContext';
import {
  clearCloudContacts,
  clearCloudReminders,
  createCloudReminders,
  deleteCloudReminder,
  ensureUserProfileDoc,
  loadEncryptedContactsFromCloud,
  migrateLocalRemindersToCloud,
  saveCloudReminder,
  subscribeToUserWorkspace,
  syncEncryptedContactToCloud,
  upsertCloudProfile,
} from './services/firestoreSync';

type AppTab =
  | 'home'
  | 'reminders'
  | 'conversations'
  | 'connect'
  | 'people'
  | 'calendar'
  | 'insights'
  | 'security';

const TAB_LABELS: Record<AppTab, string> = {
  home: 'Home',
  reminders: 'Reminders',
  conversations: 'Conversations',
  connect: 'Oopsie Connect',
  people: 'People',
  calendar: 'Calendar',
  insights: 'Insights',
  security: 'Privacy & Security',
};

const WIN_MESSAGES = [
  "Oopsie's got this!",
  'Nice—that follow-up is wrapped up.',
  'Loop closed! One less thing on your mind.',
  'Outcome recorded and timeline saved.',
];

export default function App() {
  const {
    user,
    authReady,
    guestMode,
    isSigningIn,
    signInWithGoogle,
    privacySettings,
    registerCurrentDeviceSession,
    auditEvent,
  } = useFirebaseAuth();
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile());
  const [items, setItems] = useState<ReminderItem[]>(() => loadItems());
  const [contactsMap, setContactsMap] = useState<Record<string, ContactProfile>>(() =>
    loadContactsMap()
  );
  const [cloudSyncedUid, setCloudSyncedUid] = useState<string | null>(null);
  const lastLoggedLoginUidRef = useRef<string | null>(null);
  const [fatalSyncError, setFatalSyncError] = useState<Error | null>(null);
  const [avatarImgError, setAvatarImgError] = useState(false);

  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [remindersFilter, setRemindersFilter] = useState<ReminderFilterTab>('all');
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [assistantMood, setAssistantMood] = useState<AssistantMood>('idle');

  const [duePopupItemId, setDuePopupItemId] = useState<string | null>(null);
  const [ringCount, setRingCount] = useState(1);
  const [whatHappenedItemId, setWhatHappenedItemId] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<{
    itemId: string;
    triggerCheckIn: boolean;
  } | null>(null);
  const [addModalConfig, setAddModalConfig] = useState<{
    open: boolean;
    initialPerson?: string | null;
    initialDateIso?: string | null;
    initialPrompt?: string | null;
  }>({ open: false });

  const [showNotificationsPopover, setShowNotificationsPopover] = useState(false);
  const [showMobileMoreSheet, setShowMobileMoreSheet] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingResetAll, setPendingResetAll] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [liveNow, setLiveNow] = useState<Date>(() => new Date());
  const [captureSeed, setCaptureSeed] = useState<{ text: string; key: number } | null>(null);
  const [connectSharedPayload, setConnectSharedPayload] = useState<{
    title?: string;
    text?: string;
    url?: string;
    key: number;
  } | null>(null);
  const [connectCandidateCount, setConnectCandidateCount] = useState(0);
  const [deniedBannerDismissed, setDeniedBannerDismissed] = useState(false);
  const [missedItemIds, setMissedItemIds] = useState<string[]>(() => {
    const lastSeen = loadLastSeenAt();
    if (!lastSeen) return [];
    const lastSeenMs = new Date(lastSeen).getTime();
    const nowMs = Date.now();
    if (Number.isNaN(lastSeenMs) || nowMs - lastSeenMs < 20000) return [];

    const initialItems = loadItems();
    return initialItems
      .filter((it) => {
        if (it.status === 'closed') return false;
        const dueMs = new Date(it.dueAt).getTime();
        if (Number.isNaN(dueMs)) return false;
        const notNotifiedSinceDue =
          !it.lastNotifiedAt || new Date(it.lastNotifiedAt).getTime() < dueMs;
        return dueMs > lastSeenMs && dueMs <= nowMs && notNotifiedSinceDue;
      })
      .map((it) => it.id);
  });

  const captureInputRef = useRef<HTMLTextAreaElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);

  const reportSyncError = useCallback((err: unknown) => {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    setFatalSyncError(wrapped);
  }, []);

  // Seed realistic sample data once for brand-new workspaces after onboarding completes
  useEffect(() => {
    if (!profile.onboardingComplete) return;
    if (user && cloudSyncedUid !== user.uid) return;
    if (items.length === 0 && !hasSeededSampleData()) {
      const sampleItems = getSampleReminders();
      const sampleContacts = getSampleContacts();
      markSampleDataSeeded();
      setItems(sampleItems);
      setContactsMap((prev) => {
        let next = { ...prev };
        for (const c of sampleContacts) {
          next = upsertContactProfile(next, c);
        }
        return next;
      });
      if (user) {
        void createCloudReminders(user.uid, user.email, profile, sampleItems).catch(reportSyncError);
      }
    }
  }, [profile, items.length, user, cloudSyncedUid, reportSyncError]);

  // Close notification popover on outside click
  useEffect(() => {
    if (!showNotificationsPopover) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(e.target as Node)
      ) {
        setShowNotificationsPopover(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showNotificationsPopover]);

  // Hydrate encrypted local reminders & contacts on initial mount (guest/pre-sync)
  useEffect(() => {
    let active = true;
    void Promise.all([hydrateEncryptedLocalItems(), hydrateEncryptedContactsMap()]).then(
      ([decryptedItems, decryptedContacts]) => {
        if (!active) return;
        if (!user && decryptedItems.length > 0) {
          setItems((prev) => (prev.length === 0 ? decryptedItems : prev));
        }
        if (Object.keys(decryptedContacts).length > 0) {
          setContactsMap((prev) => ({ ...decryptedContacts, ...prev }));
        }
      }
    );
    return () => {
      active = false;
    };
  }, [user]);

  // Keep client AI pause guard aligned with cloud privacySettings
  useEffect(() => {
    setClientAiAnalysisPaused(Boolean(privacySettings?.aiAnalysisPaused));
  }, [privacySettings?.aiAnalysisPaused]);

  // Hydrate & subscribe to user's Firestore workspace when signed in
  useEffect(() => {
    if (!user) {
      setCloudSyncedUid(null);
      setAvatarImgError(false);
      lastLoggedLoginUidRef.current = null;
      return;
    }

    let active = true;
    let unsub: (() => void) | null = null;
    setAvatarImgError(false);

    const initCloudWorkspace = async () => {
      try {
        const localProfile = loadProfile();
        const [localItems, localContacts, cloudContacts] = await Promise.all([
          hydrateEncryptedLocalItems(),
          hydrateEncryptedContactsMap(),
          loadEncryptedContactsFromCloud(user.uid).catch(() => ({} as Record<string, ContactProfile>)),
        ]);

        let cloudProfile = await ensureUserProfileDoc(
          user.uid,
          user.email,
          user.displayName,
          localProfile
        );

        if (!cloudProfile.onboardingComplete && localProfile.onboardingComplete) {
          cloudProfile = {
            ...cloudProfile,
            ...localProfile,
            onboardingComplete: true,
          };
          await upsertCloudProfile(user.uid, user.email, cloudProfile);
        }

        await migrateLocalRemindersToCloud(user.uid, localItems);
        await registerCurrentDeviceSession(user.uid);
        if (lastLoggedLoginUidRef.current !== user.uid) {
          lastLoggedLoginUidRef.current = user.uid;
          void auditEvent('login_success', `Signed in as ${user.email || user.uid}`, 'info');
        }

        if (!active) return;

        const mergedContacts = { ...localContacts, ...cloudContacts };
        if (Object.keys(mergedContacts).length > 0) {
          setContactsMap(mergedContacts);
          for (const lc of Object.values(localContacts)) {
            if (!cloudContacts[lc.key]) {
              void syncEncryptedContactToCloud(user.uid, lc).catch(() => {});
            }
          }
        }

        setProfile(cloudProfile);
        unsub = subscribeToUserWorkspace(user.uid, {
          onProfile: (nextProfile) => {
            if (active) setProfile(nextProfile);
          },
          onItems: (nextItems) => {
            if (active) {
              setItems(nextItems);
              setCloudSyncedUid(user.uid);
            }
          },
          onError: (err) => {
            if (active) setFatalSyncError(err);
          },
        });
      } catch (err) {
        if (active) {
          setFatalSyncError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    void initCloudWorkspace();

    return () => {
      active = false;
      if (unsub) unsub();
    };
  }, [user, registerCurrentDeviceSession, auditEvent]);

  // Unlock Web Audio silently on first pointer interaction
  useEffect(() => {
    const unlockOnce = () => {
      void unlockAudio();
    };
    window.addEventListener('pointerdown', unlockOnce, { once: true });
    return () => window.removeEventListener('pointerdown', unlockOnce);
  }, []);

  // Track lastSeenAt so reopened sessions detect missed reminders accurately
  useEffect(() => {
    saveLastSeenAt();
    const heartbeat = window.setInterval(() => {
      saveLastSeenAt();
    }, 15000);
    const onHideOrLeave = () => saveLastSeenAt();
    window.addEventListener('beforeunload', onHideOrLeave);
    document.addEventListener('visibilitychange', onHideOrLeave);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('beforeunload', onHideOrLeave);
      document.removeEventListener('visibilitychange', onHideOrLeave);
    };
  }, []);

  // Keep real-time minute/day classification fresh across the app
  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveNow(new Date());
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  // Sync dark mode class on <html> and browser/PWA theme-color status bar
  useEffect(() => {
    const root = document.documentElement;
    const isDark = profile.theme === 'dark';
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', isDark ? '#12101A' : '#FAF9FC');
    }
  }, [profile.theme]);

  // Keep focused form fields visible above mobile virtual keyboards
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (typeof window === 'undefined' || window.innerWidth >= 768) return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        window.setTimeout(() => {
          target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 280);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Persist local state
  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  useEffect(() => {
    saveItems(items);
  }, [items]);

  useEffect(() => {
    saveContactsMap(contactsMap);
  }, [contactsMap]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  // Scheduler + missed-reminder catch-up on reopen / visibility change
  const checkDueReminders = useCallback(() => {
    if (!profile.onboardingComplete) return;
    if (duePopupItemId || whatHappenedItemId) return;

    const now = Date.now();
    const dueCandidate = items.find((item) => {
      if (item.status === 'closed') return false;
      if (missedItemIds.includes(item.id)) return false;
      const dueMs = new Date(item.dueAt).getTime();
      if (Number.isNaN(dueMs) || dueMs > now) return false;
      if (!item.lastNotifiedAt) return true;
      return new Date(item.lastNotifiedAt).getTime() < dueMs;
    });

    if (!dueCandidate) return;

    const nowIso = new Date().toISOString();
    const updatedDueItem: ReminderItem = {
      ...dueCandidate,
      lastNotifiedAt: nowIso,
      timeline: [
        ...dueCandidate.timeline,
        {
          id: crypto.randomUUID(),
          type: 'reminded',
          text: 'Follow-up reminder triggered.',
          timestamp: nowIso,
        },
      ],
    };
    setItems((prev) => prev.map((it) => (it.id === dueCandidate.id ? updatedDueItem : it)));
    if (user) {
      void saveCloudReminder(user.uid, updatedDueItem).catch(reportSyncError);
    }

    setRingCount(1);
    setDuePopupItemId(dueCandidate.id);
    setAssistantMood('oops');
    void showAlarmNotification({
      itemId: dueCandidate.id,
      title: `Oopsie: ${dueCandidate.title}`,
      body: dueCandidate.person
        ? `Follow-up with ${dueCandidate.person} — what happened?`
        : 'Tap to record what happened next or snooze.',
    });
  }, [
    items,
    missedItemIds,
    profile.onboardingComplete,
    duePopupItemId,
    whatHappenedItemId,
    user,
    reportSyncError,
  ]);

  useEffect(() => {
    checkDueReminders();
    const timer = window.setInterval(checkDueReminders, 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkDueReminders();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkDueReminders]);

  const handleCreateItems = useCallback(
    (drafts: ParsedReminderDraft[], rawUserMessage: string): ReminderItem[] => {
      const nowIso = new Date().toISOString();
      const created: ReminderItem[] = drafts.map((d) => ({
        id: crypto.randomUUID(),
        title: d.title,
        person: d.person ?? null,
        project: d.project ?? null,
        category: d.category,
        priority: d.priority,
        dueAt: d.dueAtIso,
        status: d.initialStatus,
        followUpRule: d.followUpRule,
        snoozeCount: 0,
        lastNotifiedAt: null,
        lastActivityAt: nowIso,
        createdAt: nowIso,
        closedAt: null,
        timeline: [
          {
            id: crypto.randomUUID(),
            type: 'created',
            text: rawUserMessage.trim()
              ? rawUserMessage.trim()
              : `Reminder created: ${d.title}`,
            timestamp: nowIso,
          },
        ],
      }));

      setItems((prev) => [...created, ...prev]);

      // Ensure each person mentioned has an entry in contactsMap
      setContactsMap((prev) => {
        let next = prev;
        for (const c of created) {
          if (c.person?.trim()) {
            const key = c.person.trim().toLowerCase();
            if (!next[key]) {
              const newContact: ContactProfile = {
                key,
                name: c.person.trim(),
              };
              next = upsertContactProfile(next, newContact);
              if (user) {
                void syncEncryptedContactToCloud(user.uid, newContact).catch(() => {});
              }
            }
          }
        }
        return next;
      });

      if (user) {
        void createCloudReminders(user.uid, user.email, profile, created).catch(reportSyncError);
      }
      return created;
    },
    [user, profile, reportSyncError]
  );

  // Signature "Hey! What happened next?" trigger
  const handleCompleteOrCheckIn = useCallback((item: ReminderItem) => {
    setDuePopupItemId(null);
    setDrawerState(null);
    setMissedItemIds((prev) => prev.filter((id) => id !== item.id));
    setWhatHappenedItemId(item.id);
  }, []);

  const handleSnooze = useCallback(
    (item: ReminderItem, newDueIso: string, label: string) => {
      const nowIso = new Date().toISOString();
      const snoozedItem: ReminderItem = {
        ...item,
        dueAt: newDueIso,
        snoozeCount: item.snoozeCount + 1,
        lastActivityAt: nowIso,
        timeline: [
          ...item.timeline,
          {
            id: crypto.randomUUID(),
            type: 'snoozed',
            text: `Snoozed (${label}).`,
            timestamp: nowIso,
          },
        ],
      };
      setItems((prev) => prev.map((it) => (it.id === item.id ? snoozedItem : it)));
      if (user) {
        void saveCloudReminder(user.uid, snoozedItem).catch(reportSyncError);
      }
      setDuePopupItemId(null);
      setMissedItemIds((prev) => prev.filter((id) => id !== item.id));
      setAssistantMood('idle');
      showToast(`Got it, I'll check back with you (${label.toLowerCase()}).`);
    },
    [showToast, user, reportSyncError]
  );

  const handleSnoozeQuick = useCallback(
    (item: ReminderItem) => {
      const nextIso = new Date(Date.now() + 3600000).toISOString();
      handleSnooze(item, nextIso, '1 hr');
    },
    [handleSnooze]
  );

  const handleNeedsFollowUpFromPopup = (item: ReminderItem) => {
    setDuePopupItemId(null);
    setDrawerState({ itemId: item.id, triggerCheckIn: false });
  };

  const handleDropItemFromPopup = (item: ReminderItem) => {
    const nowIso = new Date().toISOString();
    const droppedItem: ReminderItem = {
      ...item,
      status: 'closed',
      closedAt: nowIso,
      lastActivityAt: nowIso,
      timeline: [
        ...item.timeline,
        {
          id: crypto.randomUUID(),
          type: 'closed',
          text: 'Closed — no longer required.',
          timestamp: nowIso,
        },
      ],
    };
    setItems((prev) => prev.map((it) => (it.id === item.id ? droppedItem : it)));
    if (user) {
      void saveCloudReminder(user.uid, droppedItem).catch(reportSyncError);
    }
    setDuePopupItemId(null);
    setAssistantMood('idle');
    showToast('Closed cleanly while keeping your history.');
  };

  const handleUpdateItem = useCallback(
    (updated: ReminderItem, closedJustNow?: boolean) => {
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      if (user) {
        void saveCloudReminder(user.uid, updated).catch(reportSyncError);
      }
      if (closedJustNow) {
        const nextProfile = recordLoopClosed(profile);
        setProfile(nextProfile);
        if (user) {
          void upsertCloudProfile(user.uid, user.email, nextProfile).catch(reportSyncError);
        }
        setAssistantMood('happy');
        showToast(WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)]);
        setTimeout(() => setAssistantMood('idle'), 2000);
      } else {
        showToast('Follow-up updated and saved to timeline.');
      }
    },
    [user, profile, reportSyncError, showToast]
  );

  const confirmDeleteItem = () => {
    if (!pendingDeleteId) return;
    const itemId = pendingDeleteId;
    setPendingDeleteId(null);
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    if (user) {
      void deleteCloudReminder(user.uid, itemId).catch(reportSyncError);
    }
    setDrawerState(null);
    setWhatHappenedItemId((prev) => (prev === itemId ? null : prev));
    showToast('Reminder removed.');
  };

  const confirmResetAllData = () => {
    setPendingResetAll(false);
    clearAllData();
    clearLocalContactsVault();
    void purgeAllConnectData();
    const freshProfile = { ...getDefaultProfile(), onboardingComplete: true };
    setItems([]);
    setContactsMap({});
    setProfile(freshProfile);
    setShowSettings(false);
    markSampleDataSeeded();
    if (user) {
      void Promise.all([clearCloudReminders(user.uid), clearCloudContacts(user.uid)])
        .then(() => upsertCloudProfile(user.uid, user.email, freshProfile))
        .then(() => auditEvent('data_deleted', 'Cleared all workspace reminders, contacts, and imported threads.', 'warning'))
        .catch(reportSyncError);
    }
    showToast('Workspace cleared.');
  };

  const handleLoadSampleData = () => {
    const samples = getSampleReminders();
    const sampleContacts = getSampleContacts();
    const existingTitles = new Set(items.map((i) => i.title));
    const missing = samples.filter((s) => !existingTitles.has(s.title));
    if (missing.length > 0) {
      setItems((prev) => [...missing, ...prev]);
      if (user) {
        void createCloudReminders(user.uid, user.email, profile, missing).catch(reportSyncError);
      }
    }
    setContactsMap((prev) => {
      let next = prev;
      for (const c of sampleContacts) {
        next = upsertContactProfile(next, c);
      }
      return next;
    });
    markSampleDataSeeded();
    showToast(
      missing.length > 0
        ? `Loaded ${missing.length} sample follow-ups.`
        : 'Sample reminders are already loaded.'
    );
  };

  const handleApplyChatUpdate = (
    update: ChatItemUpdate,
    rawUserMessage: string
  ): ReminderItem | null => {
    const target = items.find((i) => i.id === update.targetItemId);
    if (!target) return null;

    const nowIso = new Date().toISOString();
    if (update.updateType === 'delete') {
      setItems((prev) => prev.filter((it) => it.id !== target.id));
      if (user) {
        void deleteCloudReminder(user.uid, target.id).catch(reportSyncError);
      }
      showToast(`Removed "${target.title}".`);
      return null;
    }

    let updated: ReminderItem = { ...target, lastActivityAt: nowIso };
    if (update.updateType === 'complete') {
      updated = {
        ...updated,
        status: 'closed',
        closedAt: nowIso,
        timeline: [
          ...updated.timeline,
          {
            id: crypto.randomUUID(),
            type: 'user_update',
            text: rawUserMessage,
            timestamp: nowIso,
          },
          {
            id: crypto.randomUUID(),
            type: 'closed',
            text: update.noteText || 'Completed via chat.',
            timestamp: nowIso,
          },
        ],
      };
      const nextProfile = recordLoopClosed(profile);
      setProfile(nextProfile);
      if (user) {
        void upsertCloudProfile(user.uid, user.email, nextProfile).catch(reportSyncError);
      }
      setAssistantMood('happy');
      showToast(WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)]);
      setTimeout(() => setAssistantMood('idle'), 2000);
    } else if (update.updateType === 'snooze' || update.updateType === 'reschedule') {
      const nextDue = update.newDueAtIso || new Date(Date.now() + 3600000).toISOString();
      updated = {
        ...updated,
        dueAt: nextDue,
        snoozeCount: update.updateType === 'snooze' ? updated.snoozeCount + 1 : updated.snoozeCount,
        timeline: [
          ...updated.timeline,
          {
            id: crypto.randomUUID(),
            type: update.updateType === 'snooze' ? 'snoozed' : 'rescheduled',
            text: update.noteText || `Moved to ${new Date(nextDue).toLocaleString()}.`,
            timestamp: nowIso,
          },
        ],
      };
      showToast(`Updated "${target.title}".`);
    } else {
      updated = {
        ...updated,
        dueAt: update.newDueAtIso || updated.dueAt,
        timeline: [
          ...updated.timeline,
          {
            id: crypto.randomUUID(),
            type: 'user_update',
            text: update.noteText || rawUserMessage,
            timestamp: nowIso,
          },
        ],
      };
      showToast(`Saved note on "${target.title}".`);
    }

    setItems((prev) => prev.map((it) => (it.id === target.id ? updated : it)));
    if (user) {
      void saveCloudReminder(user.uid, updated).catch(reportSyncError);
    }
    return updated;
  };

  const toggleTheme = () => {
    const nextProfile: UserProfile = {
      ...profile,
      theme: profile.theme === 'dark' ? 'light' : 'dark',
    };
    setProfile(nextProfile);
    if (user) {
      void upsertCloudProfile(user.uid, user.email, nextProfile).catch(reportSyncError);
    }
  };

  // Derived lists
  const activeItems = useMemo(
    () =>
      items
        .filter((i) => i.status !== 'closed')
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [items]
  );

  const overdueItems = useMemo(
    () => activeItems.filter((i) => isOverdue(i, liveNow)),
    [activeItems, liveNow]
  );

  const todayItems = useMemo(
    () => activeItems.filter((i) => isToday(i.dueAt, liveNow) && !isOverdue(i, liveNow)),
    [activeItems, liveNow]
  );

  const notificationItems = useMemo(
    () => [...overdueItems, ...todayItems].slice(0, 8),
    [overdueItems, todayItems]
  );

  const existingPeopleNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of Object.values(contactsMap)) {
      map.set(c.key, c.name);
    }
    for (const it of items) {
      const p = it.person?.trim();
      if (p) {
        const k = p.toLowerCase();
        if (!map.has(k)) map.set(k, p);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [contactsMap, items]);

  const duePopupItem = useMemo(
    () => items.find((i) => i.id === duePopupItemId) ?? null,
    [items, duePopupItemId]
  );

  const whatHappenedItem = useMemo(
    () => items.find((i) => i.id === whatHappenedItemId) ?? null,
    [items, whatHappenedItemId]
  );

  const missedWhileAwayItems = useMemo(
    () => items.filter((i) => missedItemIds.includes(i.id) && i.status !== 'closed'),
    [items, missedItemIds]
  );

  // Cute alarm loop + tab title flash while popup active
  useEffect(() => {
    if (!duePopupItem) {
      stopAlarmLoop();
      stopTitleFlash();
      return;
    }

    startAlarmLoop({
      tone: profile.alarmTone || 'bubble_pop',
      volume: profile.alarmVolume ?? 0.8,
      intensity: profile.alarmIntensity || 'gentle',
      soundEnabled: profile.soundEnabled,
      onRing: (n) => setRingCount(n),
    });
    startTitleFlash(duePopupItem.title);

    return () => {
      stopAlarmLoop();
      stopTitleFlash();
    };
  }, [
    duePopupItem,
    profile.alarmTone,
    profile.alarmVolume,
    profile.alarmIntensity,
    profile.soundEnabled,
  ]);

  // Handle notification action clicks from Service Worker
  const handleNotificationAction = useCallback(
    (action: string, itemId?: string) => {
      if (!itemId || itemId === 'test-alarm') return;
      const target = items.find((i) => i.id === itemId);
      if (!target) return;

      if (action === 'done') {
        handleCompleteOrCheckIn(target);
      } else if (action === 'snooze-10') {
        const nextIso = new Date(Date.now() + 10 * 60000).toISOString();
        handleSnooze(target, nextIso, '10 min');
      } else {
        setDuePopupItemId(target.id);
      }
    },
    [items, handleCompleteOrCheckIn, handleSnooze]
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OOPSIE_NOTIFICATION_ACTION') {
        handleNotificationAction(event.data.action, event.data.itemId);
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, [handleNotificationAction]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const alarmAction = params.get('alarmAction');
    const itemId = params.get('itemId');
    if (alarmAction && itemId) {
      handleNotificationAction(alarmAction, itemId);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    const connectShare = params.get('connectShare');
    const sharedTitle = params.get('title') || undefined;
    const sharedText = params.get('text') || undefined;
    const sharedUrl = params.get('url') || undefined;
    if (connectShare || sharedText || sharedTitle || sharedUrl) {
      setConnectSharedPayload({
        title: sharedTitle,
        text: sharedText,
        url: sharedUrl,
        key: Date.now(),
      });
      setActiveTab('connect');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [handleNotificationAction]);

  const drawerItem = useMemo(
    () => (drawerState ? items.find((i) => i.id === drawerState.itemId) ?? null : null),
    [items, drawerState]
  );

  if (fatalSyncError) {
    throw fatalSyncError;
  }

  if (!authReady) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-[#FAF9FC] dark:bg-[#12101A] text-[#24212B] dark:text-[#F5F3FA]">
        <AssistantOrb mood="thinking" size="lg" />
        <p className="text-sm font-medium text-[#666173] dark:text-[#A7A2B8]">
          Waking up Oopsie...
        </p>
      </div>
    );
  }

  if (!user && !guestMode) {
    return <AuthGateCard />;
  }

  if (user && cloudSyncedUid !== user.uid) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-[#FAF9FC] dark:bg-[#12101A] text-[#24212B] dark:text-[#F5F3FA]">
        <AssistantOrb mood="thinking" size="lg" />
        <p className="text-sm font-medium text-[#666173] dark:text-[#A7A2B8]">
          Syncing your Oopsie workspace...
        </p>
      </div>
    );
  }

  if (!profile.onboardingComplete) {
    return (
      <OnboardingFlow
        initialProfile={profile}
        onComplete={(completed) => {
          setProfile(completed);
          if (user) {
            void upsertCloudProfile(user.uid, user.email, completed).catch(reportSyncError);
          }
        }}
      />
    );
  }

  const hasOverdue = overdueItems.length > 0;
  const headerOrbMood: AssistantMood =
    assistantMood !== 'idle' ? assistantMood : hasOverdue ? 'oops' : 'idle';

  const navItems: Array<{
    id: AppTab;
    label: string;
    icon: typeof Home;
    badge?: number;
  }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'reminders', label: 'Reminders', icon: CheckSquare, badge: activeItems.length },
    { id: 'conversations', label: 'Conversations', icon: MessageSquareText },
    {
      id: 'connect',
      label: 'Connect',
      icon: Link2,
      badge: connectCandidateCount > 0 ? connectCandidateCount : undefined,
    },
    { id: 'people', label: 'People', icon: Users },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'insights', label: 'Insights', icon: BarChart3 },
    { id: 'security', label: 'Privacy & Security', icon: ShieldCheck },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#FAF9FC] dark:bg-[#12101A] text-[#24212B] dark:text-[#F5F3FA] flex">
      {/* Desktop Collapsible Sidebar */}
      <aside
        aria-label="Primary sidebar navigation"
        className={`hidden md:flex flex-col shrink-0 sticky top-0 h-screen bg-white dark:bg-[#1A1726] border-r border-[#E6E1F2] dark:border-[#2C2740] transition-[width] duration-200 z-30 ${
          sidebarCollapsed ? 'w-[76px]' : 'w-64'
        }`}
      >
        {/* Sidebar Brand & Collapse Toggle */}
        <div className="h-16 px-4 border-b border-[#EEEAF8] dark:border-[#2C2740] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2.5 min-w-0 text-left"
          >
            <AssistantOrb mood={headerOrbMood} size="xs" />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="text-base font-bold font-display tracking-tight text-[#24212B] dark:text-[#F5F3FA] leading-none">
                  Oopsie
                </p>
                <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8] truncate mt-1">
                  Follow-up assistant
                </p>
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] shrink-0"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Primary Add CTA */}
        <div className="p-3">
          <button
            type="button"
            onClick={() => setAddModalConfig({ open: true })}
            aria-label="Add new reminder"
            className={`w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-semibold shadow-sm transition-colors ${
              sidebarCollapsed ? 'px-0' : 'px-3.5'
            }`}
          >
            <Plus className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span className="whitespace-nowrap">Add Reminder</span>}
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-1 space-y-1 overflow-y-auto">
          {navItems.map((nav) => {
            const Icon = nav.icon;
            const active = activeTab === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => {
                  if (nav.id === 'people') setSelectedPersonKey(null);
                  setActiveTab(nav.id);
                }}
                title={sidebarCollapsed ? nav.label : undefined}
                className={`w-full min-h-[42px] flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#EAE4FF] dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF]'
                    : 'text-[#666173] dark:text-[#A7A2B8] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
                } ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between'}`}
              >
                <span className="inline-flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-[#7657D5] dark:text-[#B9A7F5]' : ''
                    }`}
                  />
                  {!sidebarCollapsed && (
                    <span className="truncate whitespace-nowrap">{nav.label}</span>
                  )}
                </span>
                {!sidebarCollapsed && typeof nav.badge === 'number' && nav.badge > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
                    {nav.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-[#EEEAF8] dark:border-[#2C2740] space-y-1.5">
          {!sidebarCollapsed && (
            <div className="px-2 py-1.5 flex items-center justify-between text-[11px] text-[#666173] dark:text-[#A7A2B8]">
              <span className="inline-flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-[#7657D5]" />
                <span className="tabular-nums font-medium">{profile.streakDays}d</span> streak
              </span>
              {user ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <Cloud className="w-3 h-3" />
                  Synced
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isSigningIn}
                  onClick={() => void signInWithGoogle()}
                  className="inline-flex items-center gap-1 text-[#7657D5] hover:underline font-medium"
                >
                  <LogIn className="w-3 h-3" />
                  Sign in
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title={sidebarCollapsed ? 'Account & Preferences' : undefined}
            className={`w-full min-h-[42px] flex items-center gap-2.5 rounded-xl px-2.5 hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] transition-colors ${
              sidebarCollapsed ? 'justify-center px-0' : ''
            }`}
          >
            {user ? (
              user.photoURL && !avatarImgError ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Account'}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarImgError(true)}
                  className="w-7 h-7 rounded-full object-cover shrink-0 border border-[#E6E1F2] dark:border-[#2C2740]"
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-[#7657D5] text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {(user.displayName || user.email || 'O').slice(0, 1).toUpperCase()}
                </span>
              )
            ) : (
              <span className="w-7 h-7 rounded-full bg-[#EAE4FF] dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF] flex items-center justify-center shrink-0">
                <Settings className="w-3.5 h-3.5" />
              </span>
            )}
            {!sidebarCollapsed && (
              <div className="min-w-0 text-left flex-1">
                <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] truncate">
                  {profile.name || user?.displayName || 'Friend'}
                </p>
                <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8] truncate">
                  Preferences &amp; alarm
                </p>
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-12">
        {/* Top Bar (Desktop + Mobile) */}
        <header className="sticky top-0 z-30 pt-[env(safe-area-inset-top)] bg-[#FAF9FC]/90 dark:bg-[#12101A]/90 backdrop-blur-md border-b border-[#E6E1F2] dark:border-[#2C2740]">
          <div className="max-w-6xl mx-auto h-14 sm:h-16 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
            {/* Left: Mobile brand / Desktop page title + live clock */}
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="md:hidden min-h-[44px] inline-flex items-center gap-2 shrink-0 pr-1"
              >
                <AssistantOrb mood={headerOrbMood} size="xs" />
                <span className="text-base font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  Oopsie
                </span>
              </button>

              <span className="hidden md:inline text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap">
                {TAB_LABELS[activeTab]}
              </span>

              <span className="hidden lg:inline text-[#D5CFE6] dark:text-[#3A3352]" aria-hidden="true">
                |
              </span>

              <div className="hidden lg:flex items-center">
                <LiveClock compact onOpenCalendar={() => setActiveTab('calendar')} />
              </div>
            </div>

            {/* Right: Actions (Mobile Connect, Install, Notifications Popover, Theme, Profile) */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('connect')}
                aria-label="Open Oopsie Connect"
                className={`md:hidden relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border transition-colors ${
                  activeTab === 'connect'
                    ? 'border-[#7657D5] bg-[#EAE4FF] dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF]'
                    : 'border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] text-[#24212B] dark:text-[#F5F3FA]'
                }`}
              >
                <Link2 className="w-4 h-4" />
                {connectCandidateCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#7657D5] text-white text-[10px] font-mono font-bold tabular-nums flex items-center justify-center">
                    {connectCandidateCount}
                  </span>
                )}
              </button>

              <div className="hidden sm:block">
                <PWAInstallButton compact />
              </div>

              {/* Interactive Notification Center */}
              <div className="relative" ref={notificationsRef}>
                <button
                  type="button"
                  onClick={() => setShowNotificationsPopover((v) => !v)}
                  aria-label="Open notifications"
                  className="relative min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:bg-[#EAE4FF]/40 dark:hover:bg-[#241F35] text-[#24212B] dark:text-[#F5F3FA] transition-colors"
                >
                  <Bell className="w-4 h-4" />
                  {notificationItems.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#7657D5] text-white text-[10px] font-mono font-bold tabular-nums flex items-center justify-center">
                      {notificationItems.length}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {showNotificationsPopover && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-[calc(3.75rem+env(safe-area-inset-top))] sm:top-full sm:mt-2 sm:w-96 rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] shadow-xl p-4 space-y-3 z-50"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                          Follow-ups due &amp; overdue ({notificationItems.length})
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNotificationsPopover(false);
                            setRemindersFilter(overdueItems.length > 0 ? 'overdue' : 'today');
                            setActiveTab('reminders');
                          }}
                          className="text-xs font-medium text-[#7657D5] dark:text-[#B9A7F5] hover:underline"
                        >
                          See all
                        </button>
                      </div>

                      {notificationItems.length === 0 ? (
                        <p className="text-xs text-[#666173] dark:text-[#A7A2B8] py-4 text-center">
                          All caught up! Nothing overdue or due today.
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {notificationItems.map((ni) => {
                            const overdue = isOverdue(ni, liveNow);
                            return (
                              <button
                                key={ni.id}
                                type="button"
                                onClick={() => {
                                  setShowNotificationsPopover(false);
                                  handleCompleteOrCheckIn(ni);
                                }}
                                className="w-full text-left rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] hover:bg-[#EAE4FF]/55 dark:hover:bg-[#241F35] border border-[#E6E1F2] dark:border-[#2C2740] p-2.5 transition-colors"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] truncate">
                                    {ni.title}
                                  </p>
                                  <span
                                    className={`text-[10px] font-medium shrink-0 ${
                                      overdue
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-[#7657D5] dark:text-[#B9A7F5]'
                                    }`}
                                  >
                                    {overdue ? 'Overdue' : 'Today'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8] mt-0.5 truncate tabular-nums">
                                  {ni.person ? `${ni.person} · ` : ''}
                                  {formatDueLabel(ni.dueAt)}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={profile.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:bg-[#EAE4FF]/40 dark:hover:bg-[#241F35] text-[#24212B] dark:text-[#F5F3FA] transition-colors"
              >
                {profile.theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-[#B9A7F5]" />
                ) : (
                  <Moon className="w-4 h-4 text-[#7657D5]" />
                )}
              </button>

              {/* Profile / Preferences trigger (visible on mobile & desktop) */}
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                aria-label="Open profile and preferences"
                className="min-w-[44px] min-h-[44px] sm:min-h-[40px] inline-flex items-center justify-center gap-2 px-2.5 sm:px-3 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:bg-[#EAE4FF]/40 dark:hover:bg-[#241F35] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap shrink-0 transition-colors"
              >
                {user ? (
                  user.photoURL && !avatarImgError ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'Account'}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarImgError(true)}
                      className="w-5 h-5 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-[#7657D5] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {(user.displayName || user.email || 'O').slice(0, 1).toUpperCase()}
                    </span>
                  )
                ) : (
                  <Settings className="w-3.5 h-3.5 text-[#7657D5]" />
                )}
                <span className="hidden sm:inline">{profile.name || 'Account'}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Workspace Container */}
        <main className="max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4 sm:pt-7 space-y-5 sm:space-y-6">
          {/* Gentle banner if browser notifications are denied */}
          {typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'denied' &&
            !deniedBannerDismissed && (
              <div className="flex items-start justify-between gap-3 rounded-2xl bg-[#EAE4FF]/55 dark:bg-[#221D35] border border-[#D5CFE6] dark:border-[#3D3361] px-4 py-3 text-xs text-[#24212B] dark:text-[#EAE4FF]">
                <div className="flex items-start gap-2.5">
                  <BellOff className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5] shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>Browser notifications are blocked</strong>—allow Notifications in your browser site settings anytime for background alerts. Oopsie will still show in-app follow-up popups and chimes!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeniedBannerDismissed(true)}
                  aria-label="Dismiss notification banner"
                  className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

          {activeTab === 'home' && <PWAInstallBanner />}

          {activeTab === 'home' && (
            <DashboardHome
              items={items}
              missedWhileAwayItems={missedWhileAwayItems}
              userProfile={profile}
              assistantMood={assistantMood}
              liveNow={liveNow}
              captureInputRef={captureInputRef}
              captureSeed={captureSeed}
              onOpenAddModal={() => setAddModalConfig({ open: true })}
              onOpenConnect={() => setActiveTab('connect')}
              onOpenRemindersFilter={(filter) => {
                setRemindersFilter(filter);
                setActiveTab('reminders');
              }}
              onOpenInsights={() => setActiveTab('insights')}
              onOpenCalendar={() => setActiveTab('calendar')}
              onCreateItems={handleCreateItems}
              onApplyChatUpdate={handleApplyChatUpdate}
              onOpenWhatHappened={handleCompleteOrCheckIn}
              onOpenTimeline={(it) =>
                setDrawerState({ itemId: it.id, triggerCheckIn: false })
              }
              onSnoozeQuick={handleSnoozeQuick}
              onSnoozeTenMin={(item) =>
                handleSnooze(item, new Date(Date.now() + 10 * 60000).toISOString(), '10 min')
              }
              onDismissMissed={() => setMissedItemIds([])}
              onMoodChange={setAssistantMood}
            />
          )}

          <Suspense
            fallback={
              <div className="py-16 flex flex-col items-center justify-center gap-3 text-xs text-[#666173] dark:text-[#A7A2B8]">
                <AssistantOrb mood="thinking" size="sm" />
                <span>Loading view...</span>
              </div>
            }
          >
          {activeTab === 'reminders' && (
            <RemindersView
              items={items}
              liveNow={liveNow}
              activeFilter={remindersFilter}
              onChangeFilter={setRemindersFilter}
              onOpenAddModal={() => setAddModalConfig({ open: true })}
              onComplete={handleCompleteOrCheckIn}
              onSnoozeQuick={handleSnoozeQuick}
              onOpenTimeline={(it) =>
                setDrawerState({ itemId: it.id, triggerCheckIn: false })
              }
            />
          )}

          {activeTab === 'conversations' && (
            <BrainView
              items={items}
              userProfile={profile}
              onComplete={handleCompleteOrCheckIn}
              onSnoozeQuick={handleSnoozeQuick}
              onOpenTimeline={(it) =>
                setDrawerState({ itemId: it.id, triggerCheckIn: false })
              }
            />
          )}

          {activeTab === 'connect' && (
            <ConnectView
              items={items}
              contactsMap={contactsMap}
              existingPeople={existingPeopleNames}
              userProfile={profile}
              initialSharedText={connectSharedPayload}
              onCreateItems={handleCreateItems}
              onUpdateItem={handleUpdateItem}
              onSaveContact={(contact) => {
                setContactsMap((prev) => upsertContactProfile(prev, contact));
                if (user) {
                  void syncEncryptedContactToCloud(user.uid, contact).catch(() => {});
                }
              }}
              onOpenTimeline={(it) =>
                setDrawerState({ itemId: it.id, triggerCheckIn: false })
              }
              onOpenWhatHappened={handleCompleteOrCheckIn}
              onNotifyToast={showToast}
              onCandidateCountChange={setConnectCandidateCount}
            />
          )}

          {activeTab === 'people' && (
            <PeopleView
              items={items}
              contactsMap={contactsMap}
              initialPersonKey={selectedPersonKey}
              onSaveContact={(contact) => {
                setContactsMap((prev) => upsertContactProfile(prev, contact));
                if (user) {
                  void syncEncryptedContactToCloud(user.uid, contact).catch(() => {});
                }
                showToast(`Saved profile for ${contact.name}.`);
              }}
              onAddReminderForPerson={(personName) =>
                setAddModalConfig({ open: true, initialPerson: personName })
              }
              onComplete={handleCompleteOrCheckIn}
              onSnoozeQuick={handleSnoozeQuick}
              onOpenTimeline={(it) =>
                setDrawerState({ itemId: it.id, triggerCheckIn: false })
              }
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarView
              items={items}
              userProfile={profile}
              now={liveNow}
              onComplete={handleCompleteOrCheckIn}
              onSnoozeQuick={handleSnoozeQuick}
              onOpenTimeline={(it) =>
                setDrawerState({ itemId: it.id, triggerCheckIn: false })
              }
              onQuickCreateForDay={(draft, rawNote) => {
                handleCreateItems([draft], rawNote);
                setAssistantMood('happy');
                showToast(`Scheduled "${draft.title}"!`);
                window.setTimeout(() => setAssistantMood('idle'), 1800);
              }}
              onAskOopsieForDay={(dateLabel) => {
                setCaptureSeed({
                  text: `Remind me on ${dateLabel} to `,
                  key: Date.now(),
                });
                setActiveTab('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenAddForDay={(dateIso) =>
                setAddModalConfig({ open: true, initialDateIso: dateIso })
              }
            />
          )}

          {activeTab === 'insights' && (
            <InsightsView
              items={items}
              liveNow={liveNow}
              onOpenPerson={(personKey) => {
                setSelectedPersonKey(personKey);
                setActiveTab('people');
              }}
            />
          )}

          {activeTab === 'security' && (
            <PrivacySecurityView
              profile={profile}
              items={items}
              contactsMap={contactsMap}
              onClearContacts={() => {
                clearLocalContactsVault();
                setContactsMap({});
              }}
              onClearAllRemindersAndLocal={() => {
                clearAllData();
                clearLocalContactsVault();
                void purgeAllConnectData();
                setItems([]);
                setContactsMap({});
                setProfile(getDefaultProfile());
                setCloudSyncedUid(null);
                setActiveTab('home');
              }}
              onNotifyToast={showToast}
            />
          )}
          </Suspense>
        </main>
      </div>

      {/* Mobile More Navigation Sheet (People, Calendar, Insights, Connect, Privacy, Install) */}
      <AnimatePresence>
        {showMobileMoreSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 z-50 bg-[#24212B]/55 backdrop-blur-sm flex items-end"
            onClick={() => setShowMobileMoreSheet(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="More workspace sections"
              className="w-full rounded-t-3xl bg-white dark:bg-[#1A1726] border-t border-[#E6E1F2] dark:border-[#2C2740] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 max-h-[85dvh] overflow-y-auto shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                    More in Oopsie
                  </h2>
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                    Jump to any workspace view or preferences
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMobileMoreSheet(false)}
                  aria-label="Close navigation sheet"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#666173] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { id: 'people' as AppTab, label: 'People', icon: Users },
                  { id: 'calendar' as AppTab, label: 'Calendar', icon: CalendarDays },
                  { id: 'insights' as AppTab, label: 'Insights', icon: BarChart3 },
                  {
                    id: 'connect' as AppTab,
                    label: 'Connect',
                    icon: Link2,
                    badge: connectCandidateCount > 0 ? connectCandidateCount : undefined,
                  },
                  { id: 'security' as AppTab, label: 'Privacy & Security', icon: ShieldCheck },
                ].map((entry) => {
                  const Icon = entry.icon;
                  const active = activeTab === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        if (entry.id === 'people') setSelectedPersonKey(null);
                        setActiveTab(entry.id);
                        setShowMobileMoreSheet(false);
                      }}
                      className={`min-h-[52px] flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl border text-left transition-colors ${
                        active
                          ? 'border-[#7657D5] bg-[#EAE4FF]/70 dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF]'
                          : 'border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] text-[#24212B] dark:text-[#F5F3FA]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5] shrink-0" />
                        <span className="text-xs font-semibold truncate">{entry.label}</span>
                      </span>
                      {typeof entry.badge === 'number' && entry.badge > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#7657D5] text-white text-[10px] font-mono font-bold tabular-nums flex items-center justify-center shrink-0">
                          {entry.badge}
                        </span>
                      )}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setShowMobileMoreSheet(false);
                    setShowSettings(true);
                  }}
                  className="min-h-[52px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] text-left text-[#24212B] dark:text-[#F5F3FA]"
                >
                  <Settings className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5] shrink-0" />
                  <span className="text-xs font-semibold truncate">Preferences</span>
                </button>
              </div>

              <PWAInstallButton fullWidth />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom 5-Slot Thumb-Zone Navigation with Central Floating + Button */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#1A1726]/95 backdrop-blur-md border-t border-[#E6E1F2] dark:border-[#2C2740] grid grid-cols-5 items-center px-1"
      >
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            activeTab === 'home'
              ? 'text-[#7657D5] dark:text-[#B9A7F5]'
              : 'text-[#666173] dark:text-[#A7A2B8]'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>Home</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('reminders')}
          className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            activeTab === 'reminders'
              ? 'text-[#7657D5] dark:text-[#B9A7F5]'
              : 'text-[#666173] dark:text-[#A7A2B8]'
          }`}
        >
          <CheckSquare className="w-5 h-5" />
          <span>Reminders</span>
        </button>

        {/* Central Floating Add Button */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => setAddModalConfig({ open: true })}
            aria-label="Add reminder"
            className="-mt-6 w-12 h-12 rounded-full bg-[#7657D5] hover:bg-[#6546C4] text-white shadow-lg shadow-[#7657D5]/30 border-4 border-[#FAF9FC] dark:border-[#12101A] flex items-center justify-center transition-transform active:scale-95"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('conversations')}
          className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            activeTab === 'conversations'
              ? 'text-[#7657D5] dark:text-[#B9A7F5]'
              : 'text-[#666173] dark:text-[#A7A2B8]'
          }`}
        >
          <MessageSquareText className="w-5 h-5" />
          <span>Convos</span>
        </button>

        <button
          type="button"
          onClick={() => setShowMobileMoreSheet(true)}
          aria-expanded={showMobileMoreSheet}
          className={`relative h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            ['people', 'calendar', 'insights', 'connect', 'security'].includes(activeTab) ||
            showMobileMoreSheet
              ? 'text-[#7657D5] dark:text-[#B9A7F5]'
              : 'text-[#666173] dark:text-[#A7A2B8]'
          }`}
        >
          <LayoutGrid className="w-5 h-5" />
          <span>More</span>
          {connectCandidateCount > 0 && (
            <span className="absolute top-2 right-[26%] w-2 h-2 rounded-full bg-[#7657D5]" />
          )}
        </button>
      </nav>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] px-4 py-2.5 rounded-2xl bg-[#24212B] dark:bg-[#EAE4FF] text-white dark:text-[#24212B] text-xs sm:text-sm font-medium shadow-lg text-center leading-snug"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline & PWA Update Indicators */}
      <OfflineIndicator />
      <PWAUpdateBanner />

      <Suspense fallback={null}>
        {/* Add Reminder Modal (Quick-Add + Detailed Form) */}
        <AnimatePresence>
          {addModalConfig.open && (
            <AddReminderModal
              userProfile={profile}
              existingPeople={existingPeopleNames}
              existingItems={items}
              initialPerson={addModalConfig.initialPerson}
              initialDateIso={addModalConfig.initialDateIso}
              initialPrompt={addModalConfig.initialPrompt}
              onCreateItems={(drafts, rawNote) => {
                const created = handleCreateItems(drafts, rawNote);
                setAssistantMood('happy');
                showToast(
                  created.length === 1
                    ? `Scheduled "${created[0].title}".`
                    : `Scheduled ${created.length} follow-ups.`
                );
                setTimeout(() => setAssistantMood('idle'), 1800);
              }}
              onClose={() => setAddModalConfig({ open: false })}
            />
          )}
        </AnimatePresence>

        {/* Signature "Hey! What happened next?" Modal */}
        <AnimatePresence>
          {whatHappenedItem && (
            <WhatHappenedNextModal
              item={whatHappenedItem}
              userProfile={profile}
              onUpdateItem={handleUpdateItem}
              onOpenFullTimeline={(it) => {
                setWhatHappenedItemId(null);
                setDrawerState({ itemId: it.id, triggerCheckIn: false });
              }}
              onClose={() => setWhatHappenedItemId(null)}
            />
          )}
        </AnimatePresence>

        {/* Due Reminder Alarm Popup */}
        <AnimatePresence>
          {duePopupItem && (
            <ReminderPopupModal
              item={duePopupItem}
              userProfile={profile}
              ringCount={ringCount}
              onDone={handleCompleteOrCheckIn}
              onSnooze={handleSnooze}
              onNeedsFollowUp={handleNeedsFollowUpFromPopup}
              onDropItem={handleDropItemFromPopup}
              onDismiss={() => {
                setDuePopupItemId(null);
                setAssistantMood('idle');
              }}
            />
          )}
        </AnimatePresence>

        {/* Follow-up & Timeline Drawer */}
        <AnimatePresence>
          {drawerItem && (
            <FollowUpDrawer
              item={drawerItem}
              userProfile={profile}
              triggerCheckInOnOpen={drawerState?.triggerCheckIn ?? false}
              onUpdateItem={handleUpdateItem}
              onOpenWhatHappened={handleCompleteOrCheckIn}
              onDeleteItem={(id) => setPendingDeleteId(id)}
              onClose={() => setDrawerState(null)}
            />
          )}
        </AnimatePresence>

        {/* Settings & Backup Modal */}
        <AnimatePresence>
          {showSettings && (
            <SettingsModal
              profile={profile}
              items={items}
              onSaveProfile={(next) => {
                setProfile(next);
                if (user) {
                  void upsertCloudProfile(user.uid, user.email, next).catch(reportSyncError);
                }
              }}
              onImportBundle={(nextProfile, nextItems) => {
                setProfile(nextProfile);
                setItems(nextItems);
                if (user) {
                  void upsertCloudProfile(user.uid, user.email, nextProfile)
                    .then(() => Promise.all(nextItems.map((it) => saveCloudReminder(user.uid, it))))
                    .catch(reportSyncError);
                }
              }}
              onLoadSampleData={handleLoadSampleData}
              onRequestResetAll={() => setPendingResetAll(true)}
              onOpenSecurityCentre={() => {
                setShowSettings(false);
                setActiveTab('security');
              }}
              onSignedOut={() => {
                clearAllData();
                clearLocalContactsVault();
                void purgeAllConnectData();
                setItems([]);
                setContactsMap({});
                setProfile(getDefaultProfile());
                setCloudSyncedUid(null);
              }}
              onClose={() => setShowSettings(false)}
            />
          )}
        </AnimatePresence>
      </Suspense>

      {/* Confirm Delete Reminder Dialog */}
      <AnimatePresence>
        {pendingDeleteId && (
          <ConfirmDialog
            title="Delete this reminder?"
            description="Its conversation timeline and scheduled follow-ups will be permanently removed."
            confirmLabel="Delete reminder"
            destructive
            onConfirm={confirmDeleteItem}
            onCancel={() => setPendingDeleteId(null)}
          />
        )}
      </AnimatePresence>

      {/* Confirm Reset All Data Dialog */}
      <AnimatePresence>
        {pendingResetAll && (
          <ConfirmDialog
            title="Clear all Oopsie data?"
            description={
              user
                ? 'This will remove all reminders and conversation timelines from your account and this device.'
                : 'This will remove all locally stored reminders, contacts, and conversation timelines.'
            }
            confirmLabel="Clear all data"
            destructive
            onConfirm={confirmResetAllData}
            onCancel={() => setPendingResetAll(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
