import type { ReminderItem, UserProfile } from '../types/reminder';

function parseHHMM(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function isInQuietHours(date: Date, wakeTime: string, sleepTime: string): boolean {
  const mins = date.getHours() * 60 + date.getMinutes();
  const wake = parseHHMM(wakeTime);
  const sleep = parseHHMM(sleepTime);

  if (sleep > wake) {
    // e.g. wake 07:30 (450), sleep 22:30 (1350) -> quiet is >= 22:30 or < 07:30
    return mins >= sleep || mins < wake;
  } else {
    // e.g. wake 10:00, sleep 01:00 -> quiet is >= 01:00 and < 10:00
    return mins >= sleep && mins < wake;
  }
}

export function tomorrowMorningIso(wakeTime: string): string {
  const [hStr, mStr] = wakeTime.split(':');
  const wakeHour = Number(hStr) || 8;
  const wakeMin = Number(mStr) || 0;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(wakeHour, wakeMin + 30, 0, 0);
  return d.toISOString();
}

export function adjustOutOfQuietHours(iso: string, profile: UserProfile): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (!isInQuietHours(d, profile.wakeTime, profile.sleepTime)) {
    return d.toISOString();
  }
  const [hStr, mStr] = profile.wakeTime.split(':');
  const wakeHour = Number(hStr) || 8;
  const wakeMin = Number(mStr) || 0;
  const mins = d.getHours() * 60 + d.getMinutes();
  const sleep = parseHHMM(profile.sleepTime);

  if (sleep > parseHHMM(profile.wakeTime) && mins >= sleep) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(wakeHour, wakeMin + 30, 0, 0);
  return d.toISOString();
}

export function toLocalDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSameLocalDay(iso: string, targetDate: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === targetDate.getFullYear() &&
    d.getMonth() === targetDate.getMonth() &&
    d.getDate() === targetDate.getDate()
  );
}

export function isToday(iso: string, now = new Date()): boolean {
  return isSameLocalDay(iso, now);
}

export function isOverdue(item: ReminderItem, now = new Date()): boolean {
  if (item.status === 'closed') return false;
  return new Date(item.dueAt).getTime() < now.getTime();
}

export function formatLiveClockTime(now: Date): string {
  return now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatLiveDateShort(now: Date): string {
  return now.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDueLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unscheduled';

  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (Math.abs(diffMins) < 1) return 'Right now';
  if (diffMins > 0 && diffMins < 60) return `In ${diffMins}m`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((targetDay.getTime() - today.getTime()) / 86400000);

  const timeStr = formatTimeShort(iso);
  if (dayDiff === 0) return `Today, ${timeStr}`;
  if (dayDiff === 1) return `Tomorrow, ${timeStr}`;
  if (dayDiff === -1) return `Yesterday, ${timeStr}`;
  if (dayDiff < -1 && dayDiff > -7) return `${Math.abs(dayDiff)}d ago`;

  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

export function formatTimelineTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getDaysSince(iso: string, now = new Date()): number {
  const d = new Date(iso);
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000));
}

export function getPersonInitials(name: string | null): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function playGentleChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 warm triad
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.7);
    });
  } catch {
    // Ignore audio context restrictions if user hasn't interacted yet
  }
}

export function sendBrowserNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        tag: `the-reminder-${Date.now()}`,
      });
    } catch {
      // Ignore environments blocking Notification constructor
    }
  }
}
