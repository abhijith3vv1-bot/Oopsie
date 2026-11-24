import type { AlarmIntensity, AlarmToneId, UserProfile } from '../types/reminder';

export interface AlarmToneOption {
  id: AlarmToneId;
  label: string;
  description: string;
}

export const ALARM_TONES: AlarmToneOption[] = [
  {
    id: 'bubble_pop',
    label: 'Bubble Pop',
    description: 'Playful rising droplets ("ding-ding-dong-ding")',
  },
  {
    id: 'little_bell',
    label: 'Little Bell',
    description: 'Bright xylophone & bell chime',
  },
  {
    id: 'sleepy_chime',
    label: 'Sleepy Chime',
    description: 'Soft dreamy marimba chord',
  },
  {
    id: 'oopsie_giggle',
    label: 'Oopsie Giggle',
    description: 'Quick bouncy cheerful melody',
  },
];

const VIBRATION_GENTLE = [200, 100, 200, 100, 400];
const VIBRATION_FIRM = [260, 80, 260, 80, 450, 90, 260];
const DEFAULT_PAGE_TITLE = 'Oopsie: Oops I forgot';
const RING_INTERVAL_MS = 20000;
const MAX_RINGS = 5;
const VOLUME_RAMP = [0.4, 0.55, 0.7, 0.85, 1.0];

let sharedAudioCtx: AudioContext | null = null;
let alarmLoopTimers: number[] = [];
let titleFlashTimer: number | null = null;
let activeWakeLock: { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void } | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Silent 1-frame buffer kickstarts iOS/Safari audio unlock
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

interface NoteEvent {
  freq: number;
  delay: number;
  duration: number;
  wave?: OscillatorType;
  bubbleBend?: number;
  overtoneRatio?: number;
}

function getTonePattern(tone: AlarmToneId, intensity: AlarmIntensity): NoteEvent[] {
  const speed = intensity === 'firm' ? 0.76 : 1;

  if (tone === 'bubble_pop') {
    const base: NoteEvent[] = [
      { freq: 523.25, delay: 0.0, duration: 0.24, wave: 'sine', bubbleBend: 0.92 },
      { freq: 659.25, delay: 0.13 * speed, duration: 0.24, wave: 'sine', bubbleBend: 0.92 },
      { freq: 587.33, delay: 0.26 * speed, duration: 0.24, wave: 'sine', bubbleBend: 0.94 },
      { freq: 783.99, delay: 0.39 * speed, duration: 0.42, wave: 'sine', bubbleBend: 0.91 },
    ];
    if (intensity === 'firm') {
      base.push(
        { freq: 659.25, delay: 0.66, duration: 0.2, wave: 'sine', bubbleBend: 0.92 },
        { freq: 1046.5, delay: 0.78, duration: 0.42, wave: 'sine', bubbleBend: 0.92 }
      );
    }
    return base;
  }

  if (tone === 'little_bell') {
    const base: NoteEvent[] = [
      { freq: 587.33, delay: 0.0, duration: 0.36, wave: 'sine', overtoneRatio: 2.0 },
      { freq: 739.99, delay: 0.14 * speed, duration: 0.36, wave: 'sine', overtoneRatio: 2.0 },
      { freq: 880.0, delay: 0.28 * speed, duration: 0.38, wave: 'sine', overtoneRatio: 2.0 },
      { freq: 1174.66, delay: 0.42 * speed, duration: 0.58, wave: 'sine', overtoneRatio: 2.0 },
    ];
    if (intensity === 'firm') {
      base.push(
        { freq: 880.0, delay: 0.72, duration: 0.25, wave: 'sine', overtoneRatio: 2.0 },
        { freq: 1174.66, delay: 0.86, duration: 0.55, wave: 'sine', overtoneRatio: 2.0 }
      );
    }
    return base;
  }

  if (tone === 'sleepy_chime') {
    const base: NoteEvent[] = [
      { freq: 392.0, delay: 0.0, duration: 0.52, wave: 'triangle' },
      { freq: 493.88, delay: 0.18 * speed, duration: 0.55, wave: 'sine' },
      { freq: 587.33, delay: 0.36 * speed, duration: 0.58, wave: 'sine' },
      { freq: 739.99, delay: 0.54 * speed, duration: 0.78, wave: 'sine' },
    ];
    if (intensity === 'firm') {
      base.push({ freq: 783.99, delay: 0.82, duration: 0.65, wave: 'triangle' });
    }
    return base;
  }

  // oopsie_giggle — quick bouncy melody
  const base: NoteEvent[] = [
    { freq: 523.25, delay: 0.0, duration: 0.16, wave: 'triangle', bubbleBend: 0.95 },
    { freq: 659.25, delay: 0.09 * speed, duration: 0.16, wave: 'triangle', bubbleBend: 0.95 },
    { freq: 783.99, delay: 0.18 * speed, duration: 0.16, wave: 'sine', bubbleBend: 0.95 },
    { freq: 659.25, delay: 0.28 * speed, duration: 0.15, wave: 'sine' },
    { freq: 1046.5, delay: 0.38 * speed, duration: 0.38, wave: 'sine', bubbleBend: 0.93 },
  ];
  if (intensity === 'firm') {
    base.push(
      { freq: 783.99, delay: 0.62, duration: 0.16, wave: 'triangle' },
      { freq: 1046.5, delay: 0.72, duration: 0.36, wave: 'sine', bubbleBend: 0.93 }
    );
  }
  return base;
}

export async function playAlarmTone(
  tone: AlarmToneId = 'bubble_pop',
  options?: {
    volume?: number;
    intensity?: AlarmIntensity;
    rampFactor?: number;
  }
): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const userVol = Math.max(0, Math.min(1, options?.volume ?? 0.8));
    if (userVol <= 0.001) return true;

    const intensity: AlarmIntensity = options?.intensity ?? 'gentle';
    const ramp = Math.max(0.1, Math.min(1, options?.rampFactor ?? 1));
    const intensityBoost = intensity === 'firm' ? 1.25 : 1.0;
    const peakGain = Math.min(0.32, 0.24 * userVol * ramp * intensityBoost);

    const now = ctx.currentTime;
    const notes = getTonePattern(tone, intensity);

    notes.forEach((n) => {
      const start = now + n.delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.wave || 'sine';

      if (n.bubbleBend) {
        osc.frequency.setValueAtTime(n.freq * n.bubbleBend, start);
        osc.frequency.exponentialRampToValueAtTime(n.freq, start + 0.032);
      } else {
        osc.frequency.setValueAtTime(n.freq, start);
      }

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.002, peakGain), start + 0.022);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + n.duration + 0.04);

      if (n.overtoneRatio) {
        const over = ctx.createOscillator();
        const overGain = ctx.createGain();
        over.type = 'sine';
        over.frequency.setValueAtTime(n.freq * n.overtoneRatio, start);
        overGain.gain.setValueAtTime(0.0001, start);
        overGain.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain * 0.28), start + 0.015);
        overGain.gain.exponentialRampToValueAtTime(0.0001, start + n.duration * 0.65);
        over.connect(overGain);
        overGain.connect(ctx.destination);
        over.start(start);
        over.stop(start + n.duration + 0.02);
      }
    });

    return true;
  } catch {
    return false;
  }
}

export function triggerAlarmVibration(intensity: AlarmIntensity = 'gentle'): boolean {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      return navigator.vibrate(intensity === 'firm' ? VIBRATION_FIRM : VIBRATION_GENTLE);
    }
  } catch {
    // Ignore unsupported vibration hardware
  }
  return false;
}

export function stopAlarmVibration(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  } catch {
    // Ignore
  }
}

export function startAlarmLoop(params: {
  tone: AlarmToneId;
  volume: number;
  intensity: AlarmIntensity;
  soundEnabled: boolean;
  onRing?: (ringIndex: number, totalRings: number) => void;
}): void {
  stopAlarmLoop();

  const triggerRing = (ringIdx: number) => {
    const ramp = VOLUME_RAMP[Math.min(ringIdx, VOLUME_RAMP.length - 1)];
    if (params.soundEnabled) {
      void playAlarmTone(params.tone, {
        volume: params.volume,
        intensity: params.intensity,
        rampFactor: ramp,
      });
    }
    triggerAlarmVibration(params.intensity);
    params.onRing?.(ringIdx + 1, MAX_RINGS);
  };

  // Play immediately at 40% volume, then repeat every 20s up to 5 times total
  triggerRing(0);
  for (let i = 1; i < MAX_RINGS; i++) {
    const timerId = window.setTimeout(() => {
      triggerRing(i);
    }, i * RING_INTERVAL_MS);
    alarmLoopTimers.push(timerId);
  }
}

export function stopAlarmLoop(): void {
  alarmLoopTimers.forEach((id) => window.clearTimeout(id));
  alarmLoopTimers = [];
  stopAlarmVibration();
}

export function startTitleFlash(reminderTitle: string): void {
  stopTitleFlash();
  if (typeof document === 'undefined') return;

  const shortTitle =
    reminderTitle.length > 36 ? `${reminderTitle.slice(0, 35).trimEnd()}…` : reminderTitle;
  let showOopsie = true;
  document.title = '⏰ Oopsie!';

  titleFlashTimer = window.setInterval(() => {
    showOopsie = !showOopsie;
    document.title = showOopsie ? '⏰ Oopsie!' : `⏰ ${shortTitle}`;
  }, 950);
}

export function stopTitleFlash(): void {
  if (titleFlashTimer !== null) {
    window.clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  if (typeof document !== 'undefined') {
    document.title = DEFAULT_PAGE_TITLE;
  }
}

export async function acquireWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: {
        request: (type: 'screen') => Promise<{
          release: () => Promise<void>;
          addEventListener?: (t: string, cb: () => void) => void;
        }>;
      };
    };
    if (!nav.wakeLock || activeWakeLock) return;
    activeWakeLock = await nav.wakeLock.request('screen');
    activeWakeLock.addEventListener?.('release', () => {
      activeWakeLock = null;
    });
  } catch {
    // Wake Lock unsupported or battery saver blocked — safe no-op
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    if (activeWakeLock) {
      await activeWakeLock.release();
      activeWakeLock = null;
    }
  } catch {
    activeWakeLock = null;
  }
}

export async function showAlarmNotification(params: {
  itemId: string;
  title: string;
  body: string;
  tag?: string;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const options = {
    body: params.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: params.tag || `oopsie-alarm-${params.itemId}`,
    renotify: true,
    vibrate: VIBRATION_GENTLE,
    data: { itemId: params.itemId },
    actions: [
      { action: 'done', title: 'Done' },
      { action: 'snooze-10', title: 'Snooze 10 min' },
    ],
  } as NotificationOptions;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 900)),
      ]);
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(params.title, options);
        return true;
      }
    }
  } catch {
    // Fall back to standard Notification constructor
  }

  try {
    new Notification(params.title, {
      body: params.body,
      icon: '/pwa-192x192.png',
      tag: params.tag || `oopsie-alarm-${params.itemId}`,
    });
    return true;
  } catch {
    return false;
  }
}

export async function testAlarm(profile: UserProfile): Promise<{
  audioOk: boolean;
  vibrateSupported: boolean;
  notificationSent: boolean;
  permission: NotificationPermission | 'unsupported';
}> {
  await unlockAudio();
  const audioOk = profile.soundEnabled
    ? await playAlarmTone(profile.alarmTone, {
        volume: profile.alarmVolume,
        intensity: profile.alarmIntensity,
        rampFactor: 1,
      })
    : false;
  const vibrateSupported = triggerAlarmVibration(profile.alarmIntensity);

  const permission: NotificationPermission | 'unsupported' =
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported';

  let notificationSent = false;
  if (permission === 'granted') {
    notificationSent = await showAlarmNotification({
      itemId: 'test-alarm',
      title: '🔔 Oopsie alarm test',
      body: 'Sound, vibration, and background alerts are ready!',
      tag: `oopsie-test-${Date.now()}`,
    });
  }

  return {
    audioOk,
    vibrateSupported,
    notificationSent,
    permission,
  };
}
