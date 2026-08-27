/**
 * Analytics — warehouse-backed charts for the Brightwave Campaign Desk.
 *
 * Template intent: surfaces the "lakehouse analytics" half of the story —
 * live SQL-warehouse queries against the Brightwave Gold Delta tables (not a
 * mock). The header shows the warehouse name + state to make that obvious.
 *
 * How the data flows: each chart fetches `/api/charts/<key>` (see
 * server/routes/charts.ts). That route reads config/queries/<key>.sql —
 * which references its tables via `IDENTIFIER(:catalog || '.' || :schema
 * || '.table')` — binds the demo's catalog+schema, and runs it against the
 * SQL warehouse. Rows come back via `useChartData` and feed the chart
 * components' `data` prop.
 *
 * Repurposing: edit/add a .sql under config/queries/, register its key in
 * charts.ts's QUERY_FILES map, and reference it here via <ChartData chartKey=…>.
 */
import { useEffect, useState } from 'react';
import { BarChart } from '@databricks/appkit-ui/react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { RtPitch } from '@/architecture/RtPitch';

/**
 * Fetch chart rows from the server's /api/charts/<key> route. That route
 * reads the query SQL, substitutes the demo catalog/schema, and runs it
 * against the SQL warehouse (see server/routes/charts.ts). We pass the
 * returned rows to the chart components via their `data` prop.
 */
function useChartData<T = Record<string, unknown>>(key: string): {
  data: T[] | null;
  error: string | null;
  isLoading: boolean;
} {
  const [state, setState] = useState<{
    data: T[] | null;
    error: string | null;
    isLoading: boolean;
  }>({ data: null, error: null, isLoading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, isLoading: true });
    fetch(`/api/charts/${key}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body.data as T[];
      })
      .then((data) => alive && setState({ data, error: null, isLoading: false }))
      .catch(
        (e) =>
          alive &&
          setState({ data: null, error: String(e?.message ?? e), isLoading: false }),
      );
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}

export function AnalyticsView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Campaign analytics
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Where the budget is leaking.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Live queries against the SQL warehouse — the same numbers the
            assistant reasons about, on a single page. Use the Campaign Desk to
            take action; use this page to spot patterns.
          </p>
        </div>

        <RtPitch
          warehouse={
            warehouse?.name
              ? { name: warehouse.name, state: warehouse.state ?? null }
              : null
          }
          latencyMs={null}
        />

        {/* Top row: efficiency by channel + wasted budget by category. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Avg ROAS by channel" scope="All campaigns">
            <ChartData chartKey="roas_by_channel" height={260}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="channel"
                  yKey="avg_roas"
                  colors={[BRAND_PALETTE[0]]}
                  height={260}
                />
              )}
            </ChartData>
          </ChartCard>

          <ChartCard title="Recoverable spend by category" scope="Underperformers">
            <ChartData chartKey="recoverable_by_category" height={260}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="category"
                  yKey="recoverable_spend_usd"
                  colors={[BRAND_PALETTE[4]]}
                  height={260}
                />
              )}
            </ChartData>
          </ChartCard>
        </div>

        <ChartCard
          title="Top underperformers"
          scope="By recoverable spend"
          flush
        >
          <TopUnderperformersTable />
        </ChartCard>
      </div>
    </div>
  );
}

/**
 * Wraps a chart/table in a bordered card with a compact header (title +
 * scope chip). `flush` removes inner padding for components that draw their
 * own (e.g. a dense table).
 */
function ChartCard({
  title,
  scope,
  className,
  flush,
  children,
}: {
  title: string;
  scope?: string;
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card overflow-hidden ${className ?? ''}`}
    >
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {scope && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {scope}
          </span>
        )}
      </div>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </div>
  );
}

/**
 * Fetches /api/charts/<chartKey> and renders the rows via `children` once
 * ready, with loading/error/empty fallbacks (data-mode charts don't fetch
 * on their own, so we own the states here).
 */
function ChartData({
  chartKey,
  height,
  children,
}: {
  chartKey: string;
  height: number;
  children: (rows: Record<string, unknown>[]) => React.ReactNode;
}) {
  const { data, error, isLoading } = useChartData(chartKey);
  const center = `flex items-center justify-center text-sm`;
  if (error) {
    return (
      <div className={`${center} text-destructive`} style={{ height }}>
        Error loading chart: {error}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        Loading…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        No data.
      </div>
    );
  }
  return <>{children(data)}</>;
}

/**
 * top_underperformers — dense table of the worst campaigns by recoverable
 * spend, joined to their matching-winner flag. The hero campaign
 * (CMP-0000214) is highlighted so the important row is obvious.
 */
type UnderperformerChartRow = {
  campaign_id: string;
  campaign_name: string | null;
  channel: string | null;
  category: string | null;
  roas: number;
  spend_to_date_usd: number;
  attributed_revenue_usd: number;
  recoverable_spend_usd: number;
  has_matching_winner: boolean;
  matching_winner_campaign_id: string | null;
};

const HERO_CAMPAIGN_ID = 'CMP-0000214';

const compactUsd = (n: number) =>
  '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

function roasToneClass(roas: number): string {
  if (roas < 1) return 'text-[var(--severity-danger)]';
  if (roas < 1.5) return 'text-[var(--severity-warning)]';
  return 'text-foreground';
}

function TopUnderperformersTable() {
  const { data, error, isLoading } =
    useChartData<UnderperformerChartRow>('top_underperformers');

  if (error) {
    return (
      <div className="px-4 py-3 text-sm text-destructive">
        Couldn&apos;t load campaigns: {error}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        Loading…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
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
            <th className="text-right font-medium px-3 py-2">Recoverable</th>
            <th className="text-left font-medium px-3 py-2">Winner?</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => {
            const isHero = row.campaign_id === HERO_CAMPAIGN_ID;
            return (
              <tr
                key={row.campaign_id}
                className={`hover:bg-muted/40 ${
                  isHero
                    ? 'bg-[var(--primary)]/5 ring-1 ring-inset ring-[var(--primary)]/40'
                    : ''
                }`}
              >
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-muted-foreground">
                    {row.campaign_id}
                    {isHero && (
                      <span
                        className="ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                        style={{
                          background: 'var(--primary)',
                          color: 'var(--primary-foreground)',
                        }}
                      >
                        Hero
                      </span>
                    )}
                  </div>
                  <div className="font-medium truncate max-w-[14rem]">
                    {row.campaign_name ?? '—'}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground capitalize">
                  {row.channel ?? '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground capitalize">
                  {row.category ?? '—'}
                </td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${roasToneClass(row.roas)}`}
                >
                  {row.roas.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {compactUsd(row.recoverable_spend_usd)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.has_matching_winner
                    ? (row.matching_winner_campaign_id ?? 'yes')
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
