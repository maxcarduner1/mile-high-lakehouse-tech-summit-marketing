/**
 * Brightwave campaign + campaign action queries.
 *
 * These helpers back the agent tools in server/agent/campaigndesk.ts:
 *   - getCampaign / getUnderperformer / worstUnderperformer → find_underperformer
 *   - getRecommendation                                     → rank_actions
 *   - searchCreatives                                       → search_creatives
 *   - recordCampaignAction (writable)                       → execute_campaign_action
 *
 * The read helpers SELECT from the READ-ONLY synced mirrors
 * (app.campaign_position, app.open_underperformers,
 * app.action_recommendations). searchCreatives is the exception — it retrieves
 * from Angela's Build-1 Lakebase Search index (brightwave.campaign_search) on
 * the production branch. recordCampaignAction is the ONLY writer — it inserts
 * into the app's own app.campaign_actions_app table.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  campaignPosition,
  openUnderperformers,
  actionRecommendations,
  campaignActions,
  workflowState,
  type ActionOption,
  type AuditEntry,
} from '../schema.js';

/** A campaign's live position row (app.campaign_position). */
export type CampaignRow = typeof campaignPosition.$inferSelect;
/** An underperformer row (app.open_underperformers). */
export type Underperformer = typeof openUnderperformers.$inferSelect;

/**
 * One winning-campaign hit from the Build-1 Lakebase Search index
 * (`brightwave.campaign_search`), as returned by `searchCreatives`. These are
 * CAMPAIGN rows (not creative-catalog rows) — the index Angela built stores one
 * row per campaign with its creative angle + summary + performance, so a BM25
 * search surfaces winning campaigns/angles to replicate.
 */
export type CampaignSearchRow = {
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  category: string | null;
  targetSegment: string | null;
  creativeAngle: string | null;
  campaignSummary: string | null;
  status: string | null;
  roas: number | null;
  perfBand: string | null;
  /** lakebase_bm25 relevance score — smaller (more negative) = more relevant. */
  score: number;
};
/** The 'replicate_winner' | 'reallocate_budget' | 'pause' action space. */
export type ActionType = NonNullable<typeof campaignActions.$inferInsert.actionType>;

/**
 * The ML model's ranked action recommendation for one campaign, in the
 * shape the `rank_actions` tool returns to the model (see APP_WORKSHOP §2b).
 */
export type ActionRecommendation = {
  campaign_id: string;
  recommended_action: 'replicate_winner' | 'reallocate_budget' | 'pause' | null;
  predicted_roas_lift: number | null;
  predicted_net_value_usd: number | null;
  action_ranking: ActionOption[];
};

/** The live position for {campaignId} from the synced mirror, or null. */
export async function getCampaign(
  db: AppDb,
  campaignId: string,
): Promise<CampaignRow | null> {
  const rows = await db
    .select()
    .from(campaignPosition)
    .where(eq(campaignPosition.campaignId, campaignId))
    .limit(1);
  return rows[0] ?? null;
}

/** The open-underperformer row for {campaignId} (+ its matching winner), or null. */
export async function getUnderperformer(
  db: AppDb,
  campaignId: string,
): Promise<Underperformer | null> {
  const rows = await db
    .select()
    .from(openUnderperformers)
    .where(eq(openUnderperformers.campaignId, campaignId))
    .limit(1);
  return rows[0] ?? null;
}

/** The worst open underperformer (largest recoverable spend), or null. */
export async function worstUnderperformer(
  db: AppDb,
): Promise<Underperformer | null> {
  const rows = await db
    .select()
    .from(openUnderperformers)
    .orderBy(desc(openUnderperformers.recoverableSpendUsd))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The ranked underperformer queue the Campaign Desk UI renders — every
 * campaign in the `underperformer` band, biggest recoverable spend first,
 * LEFT JOINed to its matching-winner info + latest recorded action so the UI
 * can flag "has a winner to replicate" and "action taken". Reads ONLY the
 * synced mirror + the app's own writable action table (never mutates them).
 */
export type RankedUnderperformer = {
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  category: string | null;
  roas: number | null;
  spendToDateUsd: number | null;
  attributedRevenueUsd: number | null;
  recoverableSpendUsd: number | null;
  perfSignal: string | null;
  hasMatchingWinner: boolean;
  matchingWinnerCampaignId: string | null;
  /** The action_type of the most recent recorded action, or null if none. */
  latestActionType: ActionType | null;
  latestActionStatus: string | null;
};

export async function rankedUnderperformers(
  db: AppDb,
  limit = 100,
): Promise<RankedUnderperformer[]> {
  // Latest recorded action per campaign (the writable table can hold several
  // rows over a demo; DISTINCT ON grabs the newest by created_at).
  const latestAction = db
    .selectDistinctOn([campaignActions.campaignId], {
      campaignId: campaignActions.campaignId,
      actionType: campaignActions.actionType,
      status: campaignActions.status,
    })
    .from(campaignActions)
    .orderBy(campaignActions.campaignId, desc(campaignActions.createdAt))
    .as('latest_action');

  const rows = await db
    .select({
      campaignId: campaignPosition.campaignId,
      campaignName: campaignPosition.campaignName,
      channel: campaignPosition.channel,
      category: campaignPosition.category,
      roas: campaignPosition.roas,
      spendToDateUsd: campaignPosition.spendToDateUsd,
      attributedRevenueUsd: campaignPosition.attributedRevenueUsd,
      recoverableSpendUsd: campaignPosition.recoverableSpendUsd,
      perfSignal: campaignPosition.perfSignal,
      hasMatchingWinner: openUnderperformers.hasMatchingWinner,
      matchingWinnerCampaignId: openUnderperformers.matchingWinnerCampaignId,
      latestActionType: latestAction.actionType,
      latestActionStatus: latestAction.status,
    })
    .from(campaignPosition)
    .leftJoin(
      openUnderperformers,
      eq(campaignPosition.campaignId, openUnderperformers.campaignId),
    )
    .leftJoin(latestAction, eq(campaignPosition.campaignId, latestAction.campaignId))
    .where(eq(campaignPosition.perfBand, 'underperformer'))
    .orderBy(desc(campaignPosition.recoverableSpendUsd))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    hasMatchingWinner: r.hasMatchingWinner ?? false,
  }));
}

/**
 * Headline numbers for the Campaign Desk KPI row: how many campaigns are in
 * each performance band + the total recoverable spend locked in
 * underperformers. One grouped scan of the synced position mirror.
 */
export type CampaignDeskSummary = {
  bands: { perfBand: string; n: number; recoverableSpendUsd: number }[];
  totalUnderperformers: number;
  totalRecoverableSpendUsd: number;
};

export async function campaignDeskSummary(
  db: AppDb,
): Promise<CampaignDeskSummary> {
  const rows = await db
    .select({
      perfBand: campaignPosition.perfBand,
      n: sql<number>`COUNT(*)::int`,
      recoverableSpendUsd: sql<number>`COALESCE(SUM(${campaignPosition.recoverableSpendUsd}), 0)::float8`,
    })
    .from(campaignPosition)
    .groupBy(campaignPosition.perfBand);

  const bands = rows.map((r) => ({
    perfBand: r.perfBand ?? 'steady',
    n: Number(r.n),
    recoverableSpendUsd: Number(r.recoverableSpendUsd),
  }));
  const under = bands.find((b) => b.perfBand === 'underperformer');
  return {
    bands,
    totalUnderperformers: under?.n ?? 0,
    totalRecoverableSpendUsd: under?.recoverableSpendUsd ?? 0,
  };
}

/**
 * The ML model's ranked action recommendation for {campaignId} — reads the
 * synced mirror of gold_action_recommendations. Returns null when the model
 * hasn't been scored yet (the mirror is empty until the Build-2 ML step).
 */
export async function getRecommendation(
  db: AppDb,
  campaignId: string,
): Promise<ActionRecommendation | null> {
  const rows = await db
    .select()
    .from(actionRecommendations)
    .where(eq(actionRecommendations.campaignId, campaignId))
    .limit(1);
  const rec = rows[0];
  if (!rec) return null;
  return {
    campaign_id: rec.campaignId,
    recommended_action: rec.recommendedAction,
    predicted_roas_lift: rec.predictedRoasLift,
    predicted_net_value_usd: rec.predictedNetValueUsd,
    action_ranking: rec.actionRanking,
  };
}

/**
 * BM25 search over the campaign catalog — the Build-1 Lakebase Search showcase.
 *
 * Retrieves DIRECTLY from Angela's Build-1 Lakebase Search index:
 * `brightwave.campaign_search` (owned by angela.tsai, on the PRODUCTION branch)
 * carries one row per campaign with a `summary_tsv` tsvector GENERATED from
 * campaign_summary + creative_angle + campaign_name, and a BM25 index
 * (`brightwave.campaign_search_bm25`, the `lakebase_bm25` access method) over
 * that column. We query it with the extension's `<@> to_bm25query(...)`
 * operator against the pre-generated `summary_tsv`, so retrieval stays INSIDE
 * Lakebase, pulling from that one index — no separate vector store, no ILIKE
 * scan, no per-row to_tsvector recompute.
 *
 * The index is provisioned OUT-OF-BAND on Angela's branch (not by Drizzle): the
 * table is owned by a different principal than the app service principal, so a
 * boot migration that issued CREATE INDEX would fail with "must be owner". The
 * app SP has read access; it queries the index, it does not manage it.
 *
 * `to_bm25query` takes the query tsvector and the SCHEMA-QUALIFIED index name
 * ('brightwave.campaign_search_bm25'). lakebase_bm25 scores are NEGATIVE —
 * smaller (more negative) means more relevant — so we ORDER BY score ASC; top
 * matches first. Returns CAMPAIGN rows (winning campaigns / creative angles to
 * replicate), not creative-catalog rows.
 */
export async function searchCreatives(
  db: AppDb,
  query: string,
  limit = 8,
): Promise<CampaignSearchRow[]> {
  const q = query.trim();
  // Blank/whitespace query has nothing to rank — skip the BM25 call rather than
  // hand to_bm25query an empty tsvector. (No ILIKE fallback: retrieval is BM25.)
  if (!q) return [];

  // Score against the pre-generated `summary_tsv` column the campaign_search_bm25
  // index is built on. The `<@> to_bm25query(...)` operator yields the BM25 score.
  const result = await db.execute(sql`
    SELECT
      campaign_id,
      campaign_name,
      channel,
      category,
      target_segment,
      creative_angle,
      campaign_summary,
      status,
      roas,
      perf_band,
      (
        summary_tsv
        <@> to_bm25query(
          to_tsvector('english', ${q}),
          'brightwave.campaign_search_bm25'
        )
      ) AS score
    FROM brightwave.campaign_search
    ORDER BY score ASC
    LIMIT ${limit}
  `);

  // Map snake_case DB columns → the camelCase CampaignSearchRow shape the
  // search_creatives tool consumes.
  return (result.rows as Record<string, unknown>[]).map((r) => ({
    campaignId: r.campaign_id as string,
    campaignName: r.campaign_name as string | null,
    channel: r.channel as string | null,
    category: r.category as string | null,
    targetSegment: r.target_segment as string | null,
    creativeAngle: r.creative_angle as string | null,
    campaignSummary: r.campaign_summary as string | null,
    status: r.status as string | null,
    roas: r.roas === null ? null : Number(r.roas),
    perfBand: r.perf_band as string | null,
    score: Number(r.score),
  }));
}

/**
 * Record an approved campaign action to app.campaign_actions_app — the ONLY
 * write the app makes (the synced mirrors are read-only). Runs in a
 * transaction; stamps the approving user + an append-only audit entry, and
 * returns the generated action id. See APP_WORKSHOP §Layer 3a.
 *
 * In the SAME transaction it also records a 'decision' event in
 * app.workflow_state (the Build-2 Layer-1 observability log) so every committed
 * decision is observable next to the scheduled 'trigger' events. Both writes go
 * to app-owned writable tables; the synced mirrors are never touched.
 */
export async function recordCampaignAction(
  db: AppDb,
  args: {
    campaignId: string;
    actionType: ActionType;
    targetCampaignId: string | null;
    draftedBrief: string;
    predictedRoasLift: number | null;
    userEmail: string;
  },
): Promise<{ actionId: string }> {
  const now = new Date();
  const audit: AuditEntry[] = [
    {
      at: now.toISOString(),
      by: args.userEmail,
      action: 'approved',
      notes: 'Campaign action recorded',
      tool: 'execute_campaign_action',
    },
  ];

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(campaignActions)
      .values({
        campaignId: args.campaignId,
        actionType: args.actionType,
        targetCampaignId: args.targetCampaignId,
        draftedBrief: args.draftedBrief,
        predictedRoasLift: args.predictedRoasLift,
        status: 'approved',
        approvedBy: args.userEmail,
        auditTrail: audit,
        decidedAt: now,
      })
      .returning({ id: campaignActions.id });

    // Observability: mirror the committed decision into the workflow-state log
    // so it shows up alongside scheduled trigger events in state_table.json.
    await tx.insert(workflowState).values({
      eventType: 'decision',
      triggerSource: 'user',
      campaignId: args.campaignId,
      status: 'approved',
      detail: {
        actionId: rows[0].id,
        actionType: args.actionType,
        targetCampaignId: args.targetCampaignId,
        predictedRoasLift: args.predictedRoasLift,
        by: args.userEmail,
        at: now.toISOString(),
      },
    });

    return { actionId: rows[0].id };
  });
}
