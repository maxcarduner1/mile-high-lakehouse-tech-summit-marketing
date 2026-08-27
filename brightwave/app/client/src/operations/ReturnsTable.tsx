/**
 * The Campaign Desk ranked table — the underperformer queue.
 *
 * Each row is a campaign flagged `underperformer`, ordered by recoverable
 * spend (highest first). The hero campaign is pinned with a HERO badge + a
 * primary ring so it's obvious. Rows whose recorded-action state changes
 * between `dataMutated` refetches pulse a soft highlight (see
 * usePulseOnChange) so the user's eye lands on what the agent just did.
 */
import { Trophy, CheckCircle2, Repeat } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { RankedUnderperformer } from '@/shared/types';

const compactUsd = (n: number | null | undefined) =>
  '$' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Color ROAS by severity — under 1.0 is losing money. */
function roasToneClass(roas: number | null): string {
  if (roas === null) return 'text-muted-foreground';
  if (roas < 1) return 'text-[var(--severity-danger)]';
  if (roas < 1.5) return 'text-[var(--severity-warning)]';
  return 'text-foreground';
}

export function UnderperformerTable({
  rows,
  loading,
  error,
  heroCampaignId,
}: {
  rows: RankedUnderperformer[];
  loading: boolean;
  error: string | null;
  heroCampaignId?: string;
}) {
  if (error) {
    return (
      <div className="px-4 py-6 text-sm text-destructive">
        Couldn&apos;t load campaigns: {error}
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <div className="px-4 py-8 text-sm text-muted-foreground text-center">
        Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-sm text-muted-foreground text-center">
        No underperforming campaigns.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2">Campaign</th>
            <th className="text-left font-medium px-3 py-2">Channel</th>
            <th className="text-left font-medium px-3 py-2">Category</th>
            <th className="text-right font-medium px-3 py-2">ROAS</th>
            <th className="text-right font-medium px-3 py-2">Spend</th>
            <th className="text-right font-medium px-3 py-2">Recoverable</th>
            <th className="text-left font-medium px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <Row
              key={row.campaignId}
              row={row}
              isHero={row.campaignId === heroCampaignId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, isHero }: { row: RankedUnderperformer; isHero: boolean }) {
  // Pulse when the recorded action changes (agent wrote to this campaign).
  const pulse = usePulseOnChange(
    `${row.latestActionType ?? ''}:${row.latestActionStatus ?? ''}`,
  );
  return (
    <tr
      className={`hover:bg-muted/40 ${pulse ? 'animate-pulse-row' : ''} ${
        isHero ? 'bg-[var(--primary)]/5 ring-1 ring-inset ring-[var(--primary)]/40' : ''
      }`}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
              {row.campaignId}
              {isHero && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                  style={{
                    background: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  <Trophy className="size-2.5" /> Hero
                </span>
              )}
            </div>
            <div className="font-medium truncate max-w-[16rem]">
              {row.campaignName ?? '—'}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-muted-foreground capitalize">
        {row.channel ?? '—'}
      </td>
      <td className="px-3 py-2 text-muted-foreground capitalize">
        {row.category ?? '—'}
      </td>
      <td className={`px-3 py-2 text-right font-semibold ${roasToneClass(row.roas)}`}>
        {row.roas === null ? '—' : row.roas.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
        {compactUsd(row.spendToDateUsd)}
      </td>
      <td className="px-3 py-2 text-right font-mono font-semibold">
        {compactUsd(row.recoverableSpendUsd)}
      </td>
      <td className="px-3 py-2">
        <ActionCell row={row} />
      </td>
    </tr>
  );
}

/** Shows the recorded action if one exists, else the available lever
 *  ("winner to replicate" when a matching winner exists). */
function ActionCell({ row }: { row: RankedUnderperformer }) {
  if (row.latestActionType) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)] px-2 py-0.5 text-xs font-medium">
        <CheckCircle2 className="size-3" />
        {row.latestActionType.replace(/_/g, ' ')}
      </span>
    );
  }
  if (row.hasMatchingWinner) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Repeat className="size-3" />
        winner to replicate
        {row.matchingWinnerCampaignId && (
          <span className="font-mono text-[10px]">
            {row.matchingWinnerCampaignId}
          </span>
        )}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}
