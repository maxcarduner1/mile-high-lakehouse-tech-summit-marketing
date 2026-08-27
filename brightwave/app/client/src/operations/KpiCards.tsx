/**
 * Three KPI cards at the top of the Campaign Desk: winners / underperformers /
 * recoverable spend. Drives the "live update" demo moment — when the agent's
 * write fires `dataMutated` and a band count moves, only the cards that
 * *changed* pulse a primary ring (see usePulseOnChange).
 */
import { Trophy, TrendingDown, PiggyBank } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { CampaignDeskSummary } from '@/shared/types';

export function KpiCards({ summary }: { summary: CampaignDeskSummary | null }) {
  const byBand = new Map<string, { n: number; recoverableSpendUsd: number }>();
  for (const b of summary?.bands ?? []) {
    byBand.set(b.perfBand, { n: b.n, recoverableSpendUsd: b.recoverableSpendUsd });
  }
  const winners = byBand.get('winner')?.n ?? 0;
  const underperformers = summary?.totalUnderperformers ?? 0;
  const recoverable = summary?.totalRecoverableSpendUsd ?? 0;
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <Card
        label="Winners"
        count={winners}
        icon={<Trophy className="size-4" />}
        tone="success"
      />
      <Card
        label="Underperformers"
        count={underperformers}
        icon={<TrendingDown className="size-4" />}
        tone="danger"
      />
      <Card
        label="Recoverable spend"
        count={underperformers}
        value={recoverable}
        icon={<PiggyBank className="size-4" />}
        tone="neutral"
        showDollarOnly
      />
    </div>
  );
}

function Card({
  label,
  count,
  value,
  icon,
  tone,
  showDollarOnly,
}: {
  label: string;
  count: number;
  value?: number;
  icon: React.ReactNode;
  tone: 'neutral' | 'success' | 'danger';
  showDollarOnly?: boolean;
}) {
  // Pulse when the headline number moves (count, or $ for the recoverable card).
  const pulse = usePulseOnChange(showDollarOnly ? (value ?? 0) : count);
  const toneClass =
    tone === 'success'
      ? 'text-[var(--success-subtle-foreground)]'
      : tone === 'danger'
        ? 'text-destructive'
        : 'text-foreground';
  const compactDollar = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value ?? 0);
  const fullDollar = Number(value ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 sm:p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.12em] sm:tracking-[0.15em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 sm:mt-2 flex flex-col sm:flex-row sm:items-baseline gap-0 sm:gap-2">
        {showDollarOnly ? (
          <div className="display text-2xl sm:text-3xl font-semibold text-foreground">
            <span className="sm:hidden">${compactDollar}</span>
            <span className="hidden sm:inline">${fullDollar}</span>
          </div>
        ) : (
          <div className="display text-2xl sm:text-3xl font-semibold text-foreground">
            {count.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
