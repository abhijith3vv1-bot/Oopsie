import { motion } from 'motion/react';
import type { AssistantMood } from '../types/reminder';

interface AssistantOrbProps {
  mood: AssistantMood;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  xs: 28,
  sm: 38,
  md: 54,
  lg: 74,
};

export function AssistantOrb({ mood, size = 'md' }: AssistantOrbProps) {
  const px = SIZE_MAP[size];
  const isOops = mood === 'oops' || mood === 'alert';

  const bodyColors = {
    idle: {
      fill: '#EAE4FF',
      fold: '#C8B9FA',
      stroke: '#24212B',
      glow: 'bg-[#7657D5]/20 dark:bg-[#7657D5]/25',
    },
    listening: {
      fill: '#DDD2FE',
      fold: '#7657D5',
      stroke: '#24212B',
      glow: 'bg-[#7657D5]/30 dark:bg-[#9277EA]/30',
    },
    thinking: {
      fill: '#F3EEFF',
      fold: '#B59DF8',
      stroke: '#24212B',
      glow: 'bg-[#7657D5]/20 dark:bg-[#7657D5]/25',
    },
    happy: {
      fill: '#DCFCE7',
      fold: '#86EFAC',
      stroke: '#24212B',
      glow: 'bg-emerald-400/25 dark:bg-emerald-400/20',
    },
    alert: {
      fill: '#FEF3C7',
      fold: '#F59E0B',
      stroke: '#24212B',
      glow: 'bg-amber-400/30 dark:bg-amber-400/20',
    },
    oops: {
      fill: '#FEE2E2',
      fold: '#F87171',
      stroke: '#24212B',
      glow: 'bg-rose-400/25 dark:bg-rose-400/20',
    },
  }[mood];

  const motionAnim = {
    idle: {
      y: [0, -2, 0],
      rotate: [0, -1.5, 0, 1.5, 0],
      transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' as const },
    },
    listening: {
      scale: [1, 1.07, 1],
      transition: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const },
    },
    thinking: {
      rotate: [-4, 4, -4],
      y: [0, -2, 0],
      transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' as const },
    },
    happy: {
      y: [0, -5, 0],
      scale: [1, 1.08, 1],
      rotate: [0, -4, 4, 0],
      transition: { duration: 0.75, repeat: 2, ease: 'easeOut' as const },
    },
    alert: {
      rotate: [-5, 5, -4, 4, 0],
      scale: [1, 1.07, 1],
      transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' as const },
    },
    oops: {
      rotate: [-4, 4, -3, 3, 0],
      y: [0, -2, 0],
      transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' as const },
    },
  }[mood];

  return (
    <div
      className="relative flex items-center justify-center shrink-0 select-none"
      style={{ width: px, height: px }}
      aria-hidden="true"
    >
      {size !== 'xs' && (
        <motion.div
          animate={
            mood === 'listening' || isOops
              ? { scale: [0.95, 1.14, 0.95], opacity: [0.5, 0.85, 0.5] }
              : { scale: [0.96, 1.05, 0.96], opacity: [0.35, 0.6, 0.35] }
          }
          transition={{ duration: mood === 'listening' ? 1.1 : 3.4, repeat: Infinity, ease: 'easeInOut' }}
          className={`absolute inset-0 rounded-full blur-md ${bodyColors.glow}`}
        />
      )}

      <motion.svg
        viewBox="0 0 64 64"
        width={px}
        height={px}
        animate={motionAnim}
        className="relative drop-shadow-sm overflow-visible"
      >
        <path
          d="M12 10 C12 7.8 13.8 6 16 6 L43 6 L56 19 L56 48 C56 52.4 52.4 56 48 56 L16 56 C11.6 56 8 52.4 8 48 L8 16 C8 12.7 9.7 10 12 10 Z"
          fill={bodyColors.fill}
          stroke={bodyColors.stroke}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M43 6 L43 16 C43 17.7 44.3 19 46 19 L56 19 Z"
          fill={bodyColors.fold}
          stroke={bodyColors.stroke}
          strokeWidth="2.3"
          strokeLinejoin="round"
        />

        <circle cx="19" cy="36" r="3.2" fill="#7657D5" opacity="0.28" />
        <circle cx="45" cy="36" r="3.2" fill="#7657D5" opacity="0.28" />

        {mood === 'happy' ? (
          <>
            <path
              d="M20 30 Q23.5 25 27 30"
              fill="none"
              stroke={bodyColors.stroke}
              strokeWidth="2.7"
              strokeLinecap="round"
            />
            <path
              d="M37 30 Q40.5 25 44 30"
              fill="none"
              stroke={bodyColors.stroke}
              strokeWidth="2.7"
              strokeLinecap="round"
            />
            <path
              d="M24 37 Q32 45 40 37 Z"
              fill="#7657D5"
              stroke={bodyColors.stroke}
              strokeWidth="2.1"
              strokeLinejoin="round"
            />
          </>
        ) : isOops ? (
          <>
            <path
              d="M19 23 Q23 20 27 23"
              fill="none"
              stroke={bodyColors.stroke}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M37 21 Q41 18 45 21"
              fill="none"
              stroke={bodyColors.stroke}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <circle cx="23" cy="29.5" r="3.2" fill="#FFFFFF" stroke={bodyColors.stroke} strokeWidth="2.1" />
            <circle cx="23" cy="29.5" r="1.4" fill={bodyColors.stroke} />
            <circle cx="41" cy="29" r="4.3" fill="#FFFFFF" stroke={bodyColors.stroke} strokeWidth="2.1" />
            <circle cx="41" cy="29" r="1.8" fill={bodyColors.stroke} />
            <ellipse
              cx="32"
              cy="40"
              rx="3.3"
              ry="4.1"
              fill="#E05A5A"
              stroke={bodyColors.stroke}
              strokeWidth="2.1"
            />
          </>
        ) : mood === 'thinking' ? (
          <>
            <circle cx="23" cy="28" r="2.7" fill={bodyColors.stroke} />
            <circle cx="40" cy="28" r="2.7" fill={bodyColors.stroke} />
            <circle cx="23.9" cy="27.2" r="0.9" fill="#FFFFFF" />
            <circle cx="40.9" cy="27.2" r="0.9" fill="#FFFFFF" />
            <path
              d="M27 39 Q30 37 32 39 Q34 41 37 39"
              fill="none"
              stroke={bodyColors.stroke}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <motion.g
              animate={
                mood === 'idle'
                  ? { scaleY: [1, 1, 0.12, 1], transition: { duration: 4.5, repeat: Infinity, times: [0, 0.9, 0.95, 1] } }
                  : {}
              }
              style={{ transformOrigin: '32px 29px' }}
            >
              <circle cx="23.5" cy="29" r={mood === 'listening' ? 3.5 : 3} fill={bodyColors.stroke} />
              <circle cx="40.5" cy="29" r={mood === 'listening' ? 3.5 : 3} fill={bodyColors.stroke} />
              <circle cx="24.5" cy="28" r="1" fill="#FFFFFF" />
              <circle cx="41.5" cy="28" r="1" fill="#FFFFFF" />
            </motion.g>
            <path
              d="M26 37.5 Q32 42.5 38 37.5"
              fill="none"
              stroke={bodyColors.stroke}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </>
        )}
      </motion.svg>
    </div>
  );
}
