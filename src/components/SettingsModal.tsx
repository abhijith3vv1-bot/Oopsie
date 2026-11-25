import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Bell,
  BellRing,
  Check,
  Cloud,
  Download,
  LogIn,
  LogOut,
  Moon,
  Play,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  AlarmIntensity,
  AlarmToneId,
  ReminderItem,
  ReminderStyle,
  UserProfile,
} from '../types/reminder';
import {
  ALARM_TONES,
  playAlarmTone,
  testAlarm,
  unlockAudio,
} from '../services/alarm';
import { exportAllData, parseImportedData } from '../services/storage';
import { useFirebaseAuth } from '../contexts/FirebaseContext';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsModalProps {
  profile: UserProfile;
  items: ReminderItem[];
  onSaveProfile: (next: UserProfile) => void;
  onImportBundle: (profile: UserProfile, items: ReminderItem[]) => void;
  onLoadSampleData?: () => void;
  onRequestResetAll: () => void;
  onOpenSecurityCentre?: () => void;
  onSignedOut?: () => void;
  onClose: () => void;
}

export function SettingsModal({
  profile,
  items,
  onSaveProfile,
  onImportBundle,
  onLoadSampleData,
  onRequestResetAll,
  onOpenSecurityCentre,
  onSignedOut,
  onClose,
}: SettingsModalProps) {
  const {
    user,
    isSigningIn,
    authError,
    signInWithGoogle,
    signOutUser,
    reauthenticateWithGoogle,
    auditEvent,
  } = useFirebaseAuth();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [name, setName] = useState(profile.name);
  const [reminderStyle, setReminderStyle] = useState<ReminderStyle>(profile.reminderStyle);
  const [wakeTime, setWakeTime] = useState(profile.wakeTime);
  const [sleepTime, setSleepTime] = useState(profile.sleepTime);
  const [soundEnabled, setSoundEnabled] = useState(profile.soundEnabled);
  const [alarmTone, setAlarmTone] = useState<AlarmToneId>(profile.alarmTone || 'bubble_pop');
  const [alarmVolume, setAlarmVolume] = useState<number>(profile.alarmVolume ?? 0.8);
  const [alarmIntensity, setAlarmIntensity] = useState<AlarmIntensity>(
    profile.alarmIntensity || 'gentle'
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(profile.theme);

  const [notifStatus, setNotifStatus] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );
  const [testFeedback, setTestFeedback] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const requestNotif = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const res = await Notification.requestPermission();
    setNotifStatus(res);
  };

  const handlePreviewTone = async (toneId: AlarmToneId) => {
    await unlockAudio();
    await playAlarmTone(toneId, {
      volume: alarmVolume,
      intensity: alarmIntensity,
      rampFactor: 1,
    });
  };

  const handleTestMyAlarm = async () => {
    const draftProfile: UserProfile = {
      ...profile,
      soundEnabled,
      alarmTone,
      alarmVolume,
      alarmIntensity,
    };
    const res = await testAlarm(draftProfile);
    const parts: string[] = [];
    parts.push(soundEnabled ? (res.audioOk ? 'sound played' : 'sound muted by browser') : 'sound is off');
    parts.push(res.vibrateSupported ? 'vibration pulsed' : 'vibration unavailable on this device');
    if (res.notificationSent) {
      parts.push('notification sent');
    } else if (res.permission === 'denied') {
      parts.push('notifications blocked in browser');
    } else if (res.permission === 'default') {
      parts.push('enable browser alerts to preview OS banner');
    }
    setTestFeedback(`Tested: ${parts.join(' · ')}.`);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile({
      ...profile,
      name: name.trim() || 'Friend',
      reminderStyle,
      wakeTime,
      sleepTime,
      soundEnabled,
      alarmTone,
      alarmVolume,
      alarmIntensity,
      theme,
    });
    onClose();
  };

  const handleExport = async () => {
    setImportError(null);
    if (user) {
      const verified = await reauthenticateWithGoogle(true);
      if (!verified) {
        setImportError('Please verify your Google identity before exporting your data.');
        return;
      }
    }
    const json = exportAllData(profile, items);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oopsie-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (user) {
      await auditEvent('data_exported', `Exported JSON backup (${items.length} reminders).`, 'info');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);
    try {
      const text = await file.text();
      const parsed = parseImportedData(text);
      onImportBundle(parsed.profile, parsed.items);
      setImportSuccess(
        `Imported ${parsed.items.length} reminder${parsed.items.length === 1 ? '' : 's'}.`
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not parse JSON backup.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#24212B]/50 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] shadow-xl p-5 sm:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 space-y-6"
      >
        <div className="sm:hidden -mt-2 pb-1 flex justify-center">
          <span className="w-10 h-1.5 rounded-full bg-[#E6E1F2] dark:bg-[#2C2740]" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <h2
            id="settings-title"
            className="text-base sm:text-lg font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]"
          >
            Preferences, Alarm &amp; Backup
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#666173] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Google Account & Cloud Sync */}
        <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#7657D5] dark:text-[#B9A7F5]">
              <Cloud className="w-3.5 h-3.5" />
              <span>Google Account &amp; Cloud Sync</span>
            </span>
            {user && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                Synced automatically
              </span>
            )}
          </div>

          {user ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {user.photoURL && !avatarFailed ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Google profile'}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="w-10 h-10 rounded-full object-cover border border-[#E6E1F2] dark:border-[#2C2740] shrink-0"
                  />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-[#7657D5] text-white text-sm font-bold flex items-center justify-center shrink-0">
                    {(user.displayName || user.email || 'O').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA] truncate">
                    {user.displayName || 'Google Account'}
                  </p>
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8] truncate">
                    {user.email}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  await signOutUser();
                  onSignedOut?.();
                  onClose();
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] shrink-0 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                Using local device storage only. Sign in with Google to safely store and sync your reminders and conversation timelines across devices.
              </p>
              {authError && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{authError}</p>
              )}
              <button
                type="button"
                disabled={isSigningIn}
                onClick={() => void signInWithGoogle()}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold disabled:opacity-50 transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{isSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
              </button>
            </div>
          )}

          {onOpenSecurityCentre && (
            <button
              type="button"
              onClick={onOpenSecurityCentre}
              className="w-full min-h-[44px] flex-wrap inline-flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-[#EAE4FF]/70 hover:bg-[#EAE4FF] dark:bg-[#2B2444] dark:hover:bg-[#372E56] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#7657D5] dark:text-[#C5B4FF]" />
                <span>Open Privacy &amp; Security Centre</span>
              </span>
              <span className="text-[11px] opacity-80">Sessions, Keys &amp; Logs</span>
            </button>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1.5">
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1.5">
                Reminder style
              </label>
              <select
                value={reminderStyle}
                onChange={(e) => setReminderStyle(e.target.value as ReminderStyle)}
                className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
              >
                <option value="gentle">Gentle &amp; warm</option>
                <option value="firm">Crisp &amp; direct</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1.5">
                Appearance
              </label>
              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm flex items-center justify-between"
              >
                <span>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
                {theme === 'dark' ? (
                  <Moon className="w-4 h-4 text-[#B9A7F5]" />
                ) : (
                  <Sun className="w-4 h-4 text-[#7657D5]" />
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1.5">
                Wake up
              </label>
              <input
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1.5">
                Sleep
              </label>
              <input
                type="time"
                value={sleepTime}
                onChange={(e) => setSleepTime(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-sm"
              />
            </div>
          </div>

          {/* Cute Alarm Settings */}
          <div className="pt-3 border-t border-[#EEEAF8] dark:border-[#2C2740] space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7657D5] dark:text-[#B9A7F5]">
                Alarm &amp; Chime
              </p>
              <button
                type="button"
                onClick={() => setSoundEnabled((v) => !v)}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium"
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-[#7657D5]" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-[#8E899E]" />
                )}
                <span>{soundEnabled ? 'Sound on' : 'Muted'}</span>
              </button>
            </div>

            {/* 4 Selectable Alarm Tones with Preview Buttons */}
            <div className="space-y-2">
              {ALARM_TONES.map((tone) => {
                const selected = alarmTone === tone.id;
                return (
                  <div
                    key={tone.id}
                    className={`flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 p-3 rounded-2xl border transition-colors ${
                      selected
                        ? 'border-[#7657D5] bg-[#EAE4FF]/55 dark:bg-[#2B2444] dark:border-[#9E84EE]'
                        : 'border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setAlarmTone(tone.id)}
                      className="flex-1 min-h-[40px] text-left min-w-0 flex items-center gap-2.5"
                    >
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 ${
                          selected
                            ? 'bg-[#7657D5] border-[#7657D5] text-white'
                            : 'border-[#D5CFE6] dark:border-[#493E70]'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                          {tone.label}
                        </p>
                        <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8] truncate">
                          {tone.description}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePreviewTone(tone.id)}
                      aria-label={`Preview ${tone.label}`}
                      className="min-h-[40px] inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] hover:bg-[#EAE4FF]/40 dark:hover:bg-[#241F35] text-xs font-medium shrink-0"
                    >
                      <Play className="w-3 h-3 text-[#7657D5]" />
                      <span>Preview</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Volume slider + Gentle / Firm intensity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="p-3 rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="alarm-volume" className="font-medium text-[#666173] dark:text-[#A7A2B8]">
                    Volume
                  </label>
                  <span className="font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA]">
                    {Math.round(alarmVolume * 100)}%
                  </span>
                </div>
                <input
                  id="alarm-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(alarmVolume * 100)}
                  onChange={(e) => setAlarmVolume(Number(e.target.value) / 100)}
                  className="w-full accent-[#7657D5] cursor-pointer"
                />
              </div>

              <div className="p-3 rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] space-y-2">
                <span className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
                  Intensity
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAlarmIntensity('gentle')}
                    className={`min-h-[40px] rounded-xl text-xs font-medium transition-colors ${
                      alarmIntensity === 'gentle'
                        ? 'bg-[#EAE4FF] text-[#4C32A8] dark:bg-[#2B2444] dark:text-[#EAE4FF]'
                        : 'bg-white dark:bg-[#1A1726] text-[#666173] dark:text-[#A7A2B8]'
                    }`}
                  >
                    Gentle
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlarmIntensity('firm')}
                    className={`min-h-[40px] rounded-xl text-xs font-medium transition-colors ${
                      alarmIntensity === 'firm'
                        ? 'bg-[#7657D5] text-white'
                        : 'bg-white dark:bg-[#1A1726] text-[#666173] dark:text-[#A7A2B8]'
                    }`}
                  >
                    Firm
                  </button>
                </div>
              </div>
            </div>

            {/* Browser notifications & Test my alarm */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleTestMyAlarm}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#EAE4FF] hover:bg-[#DDD3FF] dark:bg-[#2B2444] dark:hover:bg-[#372E56] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold transition-colors"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>Test my alarm</span>
              </button>

              {notifStatus !== 'unsupported' && (
                <button
                  type="button"
                  onClick={requestNotif}
                  className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium"
                >
                  <Bell className="w-3.5 h-3.5 text-[#7657D5]" />
                  <span>
                    {notifStatus === 'granted' ? 'Browser alerts active' : 'Enable browser alerts'}
                  </span>
                </button>
              )}
            </div>

            {notifStatus === 'denied' && (
              <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 rounded-xl px-3 py-2 leading-relaxed">
                Notifications are blocked in your browser. To turn them on, open browser site settings for this page and allow Notifications. Until then, Oopsie still rings in-app and pops up right on screen!
              </p>
            )}

            {testFeedback && (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] rounded-xl px-3 py-2">
                {testFeedback}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-[#EEEAF8] dark:border-[#2C2740] space-y-3">
            <p className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
              Install app, sample data &amp; backup
            </p>
            <div className="flex flex-wrap gap-2">
              <PWAInstallButton />
              {onLoadSampleData && (
                <button
                  type="button"
                  onClick={() => {
                    onLoadSampleData();
                    onClose();
                  }}
                  className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#EAE4FF]/70 hover:bg-[#EAE4FF] dark:bg-[#2B2444] dark:hover:bg-[#372E56] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-medium"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Load sample reminders</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleExport()}
                className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FAF9FC] dark:bg-[#241F35] hover:bg-[#EAE4FF]/50 dark:hover:bg-[#2E2747] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium"
              >
                <Download className="w-4 h-4" />
                <span>Export JSON</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FAF9FC] dark:bg-[#241F35] hover:bg-[#EAE4FF]/50 dark:hover:bg-[#2E2747] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium"
              >
                <Upload className="w-4 h-4" />
                <span>Import JSON</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>

            {importError && <p className="text-xs text-rose-600 dark:text-rose-400">{importError}</p>}
            {importSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">{importSuccess}</p>}
          </div>

          <div className="pt-2 border-t border-[#EEEAF8] dark:border-[#2C2740] flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={onRequestResetAll}
              className="min-h-[44px] inline-flex items-center justify-center sm:justify-start gap-1.5 text-xs text-rose-600 dark:text-rose-400 hover:underline"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{user ? 'Clear all account data' : 'Clear all local data'}</span>
            </button>

            <button
              type="submit"
              className="min-h-[44px] w-full sm:w-auto px-6 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-medium transition-colors"
            >
              Save changes
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
