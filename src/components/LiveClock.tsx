import { useEffect, useState } from 'react';
import { CalendarDays, Clock } from 'lucide-react';
import { formatLiveClockTime, formatLiveDateShort } from '../services/time';

interface LiveClockProps {
  compact?: boolean;
  onOpenCalendar?: () => void;
}

export function LiveClock({ compact = false, onOpenCalendar }: LiveClockProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const dateText = formatLiveDateShort(now);
  const timeText = formatLiveClockTime(now);

  if (compact) {
    const Wrapper = onOpenCalendar ? 'button' : 'div';
    return (
      <Wrapper
        {...(onOpenCalendar ? { type: 'button' as const, onClick: onOpenCalendar } : {})}
        className={`inline-flex items-center gap-2 text-xs text-[#666173] dark:text-[#A7A2B8] whitespace-nowrap shrink-0 ${
          onOpenCalendar
            ? 'hover:text-[#7657D5] dark:hover:text-[#B9A7F5] transition-colors cursor-pointer'
            : ''
        }`}
        title={onOpenCalendar ? 'Open Calendar & live schedule' : undefined}
      >
        <CalendarDays className="w-3.5 h-3.5 text-[#7657D5] dark:text-[#B9A7F5] shrink-0" />
        <span className="hidden sm:inline">{dateText}</span>
        <span className="hidden sm:inline text-[#D5CFE6] dark:text-[#3A3352]" aria-hidden="true">
          ·
        </span>
        <span className="font-mono tabular-nums font-medium text-[#24212B] dark:text-[#F5F3FA]">
          {timeText}
        </span>
      </Wrapper>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="inline-flex items-center gap-2 text-sm font-medium text-[#24212B] dark:text-[#F5F3FA]">
        <CalendarDays className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5]" />
        <span>{dateText}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 font-mono tabular-nums text-lg sm:text-xl font-semibold text-[#24212B] dark:text-[#EAE4FF]">
        <Clock className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5]" />
        <span>{timeText}</span>
      </div>
    </div>
  );
}
