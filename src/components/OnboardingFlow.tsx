import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Bell, Check, Moon, Sun, Sparkles, Volume2 } from 'lucide-react';
import type { ReminderStyle, UserProfile } from '../types/reminder';
import { playAlarmTone, unlockAudio } from '../services/alarm';
import { AssistantOrb } from './AssistantOrb';

interface OnboardingFlowProps {
  initialProfile: UserProfile;
  onComplete: (profile: UserProfile) => void;
}

export function OnboardingFlow({ initialProfile, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(initialProfile.name);
  const [reminderStyle, setReminderStyle] = useState<ReminderStyle>(initialProfile.reminderStyle);
  const [wakeTime, setWakeTime] = useState(initialProfile.wakeTime);
  const [sleepTime, setSleepTime] = useState(initialProfile.sleepTime);
  const [audioUnlocked, setAudioUnlocked] = useState(Boolean(initialProfile.audioUnlocked));
  const [notifStatus, setNotifStatus] = useState<string>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  const handleEnableRingAndAlerts = async () => {
    const unlocked = await unlockAudio();
    setAudioUnlocked(unlocked);
    await playAlarmTone('bubble_pop', {
      volume: 0.75,
      intensity: reminderStyle,
      rampFactor: 1,
    });

    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const result = await Notification.requestPermission();
        setNotifStatus(result);
      } catch {
        // Ignore unsupported environments
      }
    }
  };

  const handleFinish = () => {
    onComplete({
      ...initialProfile,
      name: name.trim() || 'Friend',
      reminderStyle,
      alarmIntensity: reminderStyle,
      audioUnlocked,
      wakeTime,
      sleepTime,
      onboardingComplete: true,
    });
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-[#FAF9FC] dark:bg-[#12101A] text-[#24212B] dark:text-[#F5F3FA]">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-8 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3.5">
            <AssistantOrb mood={step === 3 ? 'happy' : 'idle'} size="md" />
            <div>
              <p className="text-xs font-medium text-[#7657D5] dark:text-[#B9A7F5]">
                Oopsie · Step {step} of 3
              </p>
              <h1 className="text-lg font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                Meet Oopsie
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {[1, 2, 3].map((idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  idx <= step ? 'w-6 bg-[#7657D5]' : 'w-2 bg-[#E6E1F2] dark:bg-[#2C2740]'
                }`}
              />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold font-display tracking-tight text-balance">
                  Never lose track of a conversation again.
                </h2>
                <p className="text-sm text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                  I&apos;m Oopsie—your intelligent follow-up assistant. Tell me what you promised or who you&apos;re waiting on, and after I remind you, I&apos;ll ask what happened next so nothing slips through.
                </p>
              </div>

              <div>
                <label htmlFor="onboard-name" className="block text-sm font-medium text-[#24212B] dark:text-[#F5F3FA] mb-2">
                  Your first name
                </label>
                <input
                  id="onboard-name"
                  type="text"
                  autoFocus={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) setStep(2);
                  }}
                  placeholder="e.g., Maya"
                  className="w-full h-12 px-4 rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E899E] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30 focus:border-[#7657D5]"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="min-h-[44px] inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7657D5]"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold font-display tracking-tight text-balance">
                  Nice to meet you{name.trim() ? `, ${name.trim()}` : ''}! How should I nudge you?
                </h2>
                <p className="text-sm text-[#666173] dark:text-[#A7A2B8]">
                  Pick the follow-up tone that fits your day best.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setReminderStyle('gentle')}
                  className={`text-left p-4 rounded-2xl border transition-all min-h-[44px] ${
                    reminderStyle === 'gentle'
                      ? 'border-[#7657D5] bg-[#EAE4FF]/60 dark:bg-[#2B2444] dark:border-[#9E84EE]'
                      : 'border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#C6B9F2] dark:hover:border-[#493E70]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm text-[#24212B] dark:text-[#F5F3FA]">Playful &amp; gentle</span>
                    {reminderStyle === 'gentle' && <Check className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5]" />}
                  </div>
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                    &quot;Hey! What happened with Rahul&apos;s quotation? Want me to check back tomorrow?&quot;
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setReminderStyle('firm')}
                  className={`text-left p-4 rounded-2xl border transition-all min-h-[44px] ${
                    reminderStyle === 'firm'
                      ? 'border-[#7657D5] bg-[#EAE4FF]/60 dark:bg-[#2B2444] dark:border-[#9E84EE]'
                      : 'border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#C6B9F2] dark:hover:border-[#493E70]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm text-[#24212B] dark:text-[#F5F3FA]">Crisp &amp; direct</span>
                    {reminderStyle === 'firm' && <Check className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5]" />}
                  </div>
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                    &quot;Follow-up due: Rahul quotation. Did he reply, or schedule next check-in?&quot;
                  </p>
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] flex items-center justify-center shrink-0">
                      {audioUnlocked ? (
                        <Volume2 className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5]" />
                      ) : (
                        <Bell className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5]" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                        Sound &amp; background alerts
                      </p>
                      <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                        {audioUnlocked && notifStatus === 'granted'
                          ? 'Awesome! Sound chimes and alerts are unlocked.'
                          : 'Browsers pause alarm sounds until you give a quick tap.'}
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleEnableRingAndAlerts}
                  className={`w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    audioUnlocked && notifStatus === 'granted'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                      : 'bg-[#EAE4FF] hover:bg-[#DDD3FF] text-[#4C32A8] dark:bg-[#2B2444] dark:hover:bg-[#372E56] dark:text-[#EAE4FF]'
                  }`}
                >
                  {audioUnlocked && notifStatus === 'granted' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Oopsie can ring for you! (Tap to chime again)</span>
                    </>
                  ) : (
                    <span>Tap to let Oopsie ring for you</span>
                  )}
                </button>

                {notifStatus === 'denied' && (
                  <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 rounded-xl px-3 py-2 leading-relaxed">
                    Notifications are currently blocked in your browser. Click the site settings icon beside the address bar to allow them anytime—meanwhile, Oopsie will still show in-app popups and play sound chimes!
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="min-h-[44px] inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold font-display tracking-tight text-balance">
                  When are your quiet hours?
                </h2>
                <p className="text-sm text-[#666173] dark:text-[#A7A2B8]">
                  I won&apos;t schedule automatic check-ins while you&apos;re winding down or asleep.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="p-4 rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740]">
                  <label htmlFor="wake-time" className="flex items-center gap-2 text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-2">
                    <Sun className="w-4 h-4 text-amber-500" />
                    Usually wake up
                  </label>
                  <input
                    id="wake-time"
                    type="time"
                    value={wakeTime}
                    onChange={(e) => setWakeTime(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                  />
                </div>

                <div className="p-4 rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740]">
                  <label htmlFor="sleep-time" className="flex items-center gap-2 text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-2">
                    <Moon className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5]" />
                    Usually sleep
                  </label>
                  <input
                    id="sleep-time"
                    type="time"
                    value={sleepTime}
                    onChange={(e) => setSleepTime(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                  />
                </div>
              </div>

              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Detected timezone: <span className="font-mono text-[#24212B] dark:text-[#F5F3FA]">{initialProfile.timezone}</span>
              </p>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleFinish}
                  className="min-h-[44px] inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-4 h-4" />
                  Let&apos;s go!
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
