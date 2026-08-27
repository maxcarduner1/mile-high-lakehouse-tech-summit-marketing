/**
 * The Campaign Desk — the ranked underperformer queue for Brightwave.
 *
 * This is the app's "work queue": every campaign flagged `underperformer`,
 * ranked by recoverable spend (biggest wasted budget first), rendered live
 * from the synced Lakebase mirrors (app.campaign_position +
 * app.open_underperformers) via /api/campaigns/*. It stays in sync with the
 * agent's actions through the `dataMutated` pub/sub — when a chat turn records
 * a campaign action, the queue refetches and the affected row shows its new
 * "action taken" state.
 *
 * The hero underperformer (CMP-0000214, "Apparel Display Q2") is flagged with
 * a HERO badge + ring so the important row is obvious even though it isn't #1
 * by raw recoverable spend.
 *
 * Reads are read-only; the only write path is the agent's
 * execute_campaign_action tool (server/agent/campaigndesk.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight, Search, Trophy } from 'lucide-react';
import { fetchUnderperformers, fetchCampaignSummary } from '@/lib/campaigns';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type { RankedUnderperformer, CampaignDeskSummary } from '@/shared/types';

import { KpiCards } from './KpiCards';
import { UnderperformerTable } from './ReturnsTable';
import { IngestionFlow } from '@/architecture/IngestionFlow';

/** The narrative hero — the underperformer the demo story centers on. */
const HERO_CAMPAIGN_ID = 'CMP-0000214';

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const campaignFromUrl = searchParams.get('campaign') ?? '';

  const [search, setSearch] = useState(campaignFromUrl);
  const [rows, setRows] = useState<RankedUnderperformer[]>([]);
  const [summary, setSummary] = useState<CampaignDeskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useSession();

  // Keep the search box ↔ URL in sync so deep links (e.g. from Analytics or
  // the assistant) land on a pre-filtered queue.
  useEffect(() => {
    const urlCampaign = searchParams.get('campaign') ?? '';
    if (urlCampaign !== search) setSearch(urlCampaign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (search) next.set('campaign', search);
    else next.delete('campaign');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function reload() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        fetchUnderperformers(200),
        fetchCampaignSummary(),
      ]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // Refetch on every agent write so the queue reflects recorded actions.
    return dataMutated.subscribe(() => {
      void reload();
    });
  }, []);

  // Pull the hero to the top (if present), then apply the free-text filter.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? rows.filter(
          (r) =>
            r.campaignId.toLowerCase().includes(q) ||
            (r.campaignName ?? '').toLowerCase().includes(q) ||
            (r.channel ?? '').toLowerCase().includes(q) ||
            (r.category ?? '').toLowerCase().includes(q),
        )
      : rows;
    // Surface the hero campaign first so it's always visible.
    const hero = matched.find((r) => r.campaignId === HERO_CAMPAIGN_ID);
    if (!hero) return matched;
    return [hero, ...matched.filter((r) => r.campaignId !== HERO_CAMPAIGN_ID)];
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 lg:items-end">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Campaign Desk — underperformer queue
              </div>
              <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
                Work the underperforming campaigns.
              </h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Every campaign flagged an underperformer, ranked by recoverable
              spend. Replicate a winner, reallocate the budget, or pause —
              the assistant drafts the action, you approve it.
            </p>
            {config?.assistantScript?.[0] && (
              <button
                onClick={() =>
                  dockController.openAndSend(config.assistantScript[0].prompt)
                }
                className="w-full text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-5 py-4 transition-all flex items-center gap-4 group"
              >
                <div
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  <Sparkles className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Where&apos;s the wasted budget?
                  </div>
                  <div className="text-sm font-medium text-foreground mt-0.5">
                    Ask the assistant why {HERO_CAMPAIGN_ID} is underperforming
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            )}
          </div>
          <IngestionFlow />
        </div>

        <KpiCards summary={summary} />

        {/* Search box */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by campaign id, name, channel, or category…"
            className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Trophy className="size-4 text-muted-foreground" />
              Underperformers by recoverable spend
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {filteredRows.length} campaigns
            </span>
          </div>
          <UnderperformerTable
            rows={filteredRows}
            loading={loading}
            error={error}
            heroCampaignId={HERO_CAMPAIGN_ID}
          />
        </div>
      </div>
    </div>
  );
}
