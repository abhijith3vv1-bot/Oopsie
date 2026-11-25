import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { ReminderItem } from '../types/reminder';
import { getPersonInitials, isOverdue } from '../services/time';
import { formatPersonDisplayName, normalizePersonKey } from '../services/contacts';

interface InsightsViewProps {
  items: ReminderItem[];
  liveNow: Date;
  onOpenPerson: (personKey: string) => void;
}

export function InsightsView({ items, liveNow, onOpenPerson }: InsightsViewProps) {
  const stats = useMemo(() => {
    const completed = items.filter((i) => i.status === 'closed');
    const pending = items.filter((i) => i.status !== 'closed');
    const overdue = pending.filter((i) => isOverdue(i, liveNow));
    const total = items.length;
    const completionPct = total > 0 ? Math.round((completed.length / total) * 100) : 0;

    const durationsHrs = completed
      .map((i) => {
        if (!i.closedAt) return null;
        const diff = new Date(i.closedAt).getTime() - new Date(i.createdAt).getTime();
        return diff > 0 ? diff / 3600000 : null;
      })
      .filter((v): v is number => v !== null);

    const avgHours =
      durationsHrs.length > 0
        ? durationsHrs.reduce((sum, v) => sum + v, 0) / durationsHrs.length
        : null;

    const avgLabel =
      avgHours === null
        ? '—'
        : avgHours < 24
          ? `${Math.max(1, Math.round(avgHours))}h`
          : `${(avgHours / 24).toFixed(1)}d`;

    const awaitingMap = new Map<string, { key: string; name: string; count: number; overdueCount: number }>();
    for (const item of pending) {
      const raw = item.person?.trim();
      if (!raw) continue;
      const key = normalizePersonKey(raw);
      const existing = awaitingMap.get(key) || {
        key,
        name: formatPersonDisplayName(raw),
        count: 0,
        overdueCount: 0,
      };
      existing.count += 1;
      if (isOverdue(item, liveNow)) existing.overdueCount += 1;
      awaitingMap.set(key, existing);
    }

    const peopleAwaiting = Array.from(awaitingMap.values()).sort((a, b) => b.count - a.count);

    const days: Array<{ label: string; key: string; created: number; completed: number }> = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(liveNow);
      d.setDate(d.getDate() - offset);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      const label = d.toLocaleDateString([], { weekday: 'short' });
      days.push({ label, key, created: 0, completed: 0 });
    }

    const dayIndex = new Map(days.map((d, idx) => [d.key, idx]));
    for (const item of items) {
      const cDate = new Date(item.createdAt);
      if (!Number.isNaN(cDate.getTime())) {
        const cKey = `${cDate.getFullYear()}-${String(cDate.getMonth() + 1).padStart(2, '0')}-${String(cDate.getDate()).padStart(2, '0')}`;
        const idx = dayIndex.get(cKey);
        if (idx !== undefined) days[idx].created += 1;
      }
      if (item.closedAt) {
        const clDate = new Date(item.closedAt);
        if (!Number.isNaN(clDate.getTime())) {
          const clKey = `${clDate.getFullYear()}-${String(clDate.getMonth() + 1).padStart(2, '0')}-${String(clDate.getDate()).padStart(2, '0')}`;
          const idx = dayIndex.get(clKey);
          if (idx !== undefined) days[idx].completed += 1;
        }
      }
    }

    const maxDayBar = Math.max(
      1,
      ...days.map((d) => Math.max(d.created, d.completed))
    );

    const categoryCounts = new Map<string, number>();
    for (const item of items) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
    }
    const categories = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]);

    return {
      completedCount: completed.length,
      pendingCount: pending.length,
      overdueCount: overdue.length,
      completionPct,
      avgLabel,
      peopleAwaiting,
      days,
      maxDayBar,
      categories,
      total,
    };
  }, [items, liveNow]);

  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (stats.completionPct / 100) * circumference;

  const metricCards = [
    {
      label: 'Completed follow-ups',
      value: String(stats.completedCount),
      icon: CheckCircle2,
      tone: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'Pending reminders',
      value: String(stats.pendingCount),
      icon: Clock,
      tone: 'text-[#7657D5] dark:text-[#C5B4FF]',
      bg: 'bg-[#EAE4FF]/70 dark:bg-[#2B2444]',
    },
    {
      label: 'Overdue reminders',
      value: String(stats.overdueCount),
      icon: AlertCircle,
      tone: 'text-[#D9534F] dark:text-[#FCA5A5]',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
    },
    {
      label: 'Completion rate',
      value: `${stats.completionPct}%`,
      icon: TrendingUp,
      tone: 'text-[#7657D5] dark:text-[#C5B4FF]',
      bg: 'bg-[#EAE4FF]/70 dark:bg-[#2B2444]',
    },
    {
      label: 'Avg completion time',
      value: stats.avgLabel,
      icon: Timer,
      tone: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
    },
    {
      label: 'People awaiting replies',
      value: String(stats.peopleAwaiting.length),
      icon: Users,
      tone: 'text-sky-600 dark:text-sky-400',
      bg: 'bg-sky-50 dark:bg-sky-950/40',
    },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
          Insights
        </h1>
        <p className="text-sm text-[#666173] dark:text-[#A7A2B8]">
          See how reliably conversations are closing and who is waiting on a follow-up.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
        {metricCards.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-2.5"
            >
              <span className={`w-9 h-9 rounded-xl ${m.bg} ${m.tone} flex items-center justify-center`}>
                <Icon className="w-4 h-4" />
              </span>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA]">
                {m.value}
              </p>
              <p className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
                {m.label}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 space-y-5">
          <h2 className="text-sm font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
            Follow-up closure rate
          </h2>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
            <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  className="text-[#EFEBF7] dark:text-[#2C2740]"
                />
                <motion.circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke="#7657D5"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  initial={{ strokeDashoffset: circumference }}
                  animate={{ strokeDashoffset }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                />
              </svg>
              <span className="absolute text-lg font-bold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA]">
                {stats.completionPct}%
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-[#666173] dark:text-[#A7A2B8]">
              <p>
                <strong className="font-mono text-[#24212B] dark:text-[#F5F3FA]">
                  {stats.completedCount}
                </strong>{' '}
                of{' '}
                <strong className="font-mono text-[#24212B] dark:text-[#F5F3FA]">
                  {stats.total}
                </strong>{' '}
                total threads resolved
              </p>
              <p>
                Average resolution time:{' '}
                <strong className="font-mono text-[#7657D5] dark:text-[#C5B4FF]">
                  {stats.avgLabel}
                </strong>
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-[#EFEBF7] dark:border-[#2C2740] space-y-2.5">
            <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
              By category
            </p>
            {stats.categories.length === 0 ? (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">No reminders logged yet.</p>
            ) : (
              stats.categories.map(([cat, count]) => {
                const pct = Math.round((count / Math.max(1, stats.total)) * 100);
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#24212B] dark:text-[#F5F3FA] font-medium">{cat}</span>
                      <span className="font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#FAF9FC] dark:bg-[#12101A] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#7657D5]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 sm:p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
              Last 7 days activity
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#666173] dark:text-[#A7A2B8]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#7657D5]" />
                Created
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                Completed
              </span>
            </div>
          </div>

          <div className="h-52 flex items-end justify-between gap-1.5 sm:gap-2 pt-4">
            {stats.days.map((d) => {
              const createdPct = Math.round((d.created / stats.maxDayBar) * 100);
              const completedPct = Math.round((d.completed / stats.maxDayBar) * 100);
              return (
                <div key={d.key} className="flex-1 min-w-0 flex flex-col items-center gap-2 h-full justify-end">
                  <div className="w-full flex items-end justify-center gap-1.5 h-40">
                    <div
                      title={`${d.label}: ${d.created} created`}
                      className="w-3 sm:w-4 rounded-t-md bg-[#7657D5] transition-all"
                      style={{ height: `${Math.max(d.created > 0 ? 10 : 4, createdPct)}%` }}
                    />
                    <div
                      title={`${d.label}: ${d.completed} completed`}
                      className="w-3 sm:w-4 rounded-t-md bg-emerald-500 transition-all"
                      style={{ height: `${Math.max(d.completed > 0 ? 10 : 4, completedPct)}%` }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] font-medium text-[#666173] dark:text-[#A7A2B8]">
                      {d.label}
                    </p>
                    <p className="text-[10px] font-mono tabular-nums text-[#8E889C]">
                      {d.created}/{d.completed}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
            People awaiting responses
          </h2>
          <span className="text-xs font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
            {stats.peopleAwaiting.length} contacts
          </span>
        </div>

        {stats.peopleAwaiting.length === 0 ? (
          <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
            No pending follow-ups linked to contacts right now.
          </p>
        ) : (
          <div className="divide-y divide-[#EFEBF7] dark:divide-[#2C2740]">
            {stats.peopleAwaiting.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onOpenPerson(p.key)}
                className="w-full min-h-[48px] py-3 flex items-center justify-between gap-3 text-left hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] px-2 -mx-2 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-8 h-8 rounded-full bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] text-xs font-semibold flex items-center justify-center shrink-0">
                    {getPersonInitials(p.name) || p.name.slice(0, 1)}
                  </span>
                  <span className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA] truncate">
                    {p.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums shrink-0">
                  {p.overdueCount > 0 && (
                    <span className="text-[#D9534F] dark:text-[#FCA5A5]">
                      {p.overdueCount} overdue
                    </span>
                  )}
                  <span className="text-[#7657D5] dark:text-[#C5B4FF] font-semibold">
                    {p.count} pending
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
