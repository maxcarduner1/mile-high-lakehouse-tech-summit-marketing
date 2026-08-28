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
 * app.action_recommendations, app.creatives). recordCampaignAction is the
 * ONLY writer — it inserts into the app's own app.campaign_actions_app table.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  campaignPosition,
  openUnderperformers,
  actionRecommendations,
  creatives,
  campaignActions,
  workflowState,
  type ActionOption,
  type AuditEntry,
} from '../schema.js';

/** A campaign's live position row (app.campaign_position). */
export type CampaignRow = typeof campaignPosition.$inferSelect;
/** An underperformer row (app.open_underperformers). */
export type Underperformer = typeof openUnderperformers.$inferSelect;
/** A single creative catalog row (app.creatives). */
export type CreativeRow = typeof creatives.$inferSelect;
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
 * Full-text search over the creative catalog — the Lakebase Search showcase.
 *
 * Retrieves DIRECTLY from the Lakebase Search index: a Postgres full-text
 * (tsvector) GIN index over the creative's searchable text (name + angle +
 * type + description), defined on `app.creatives` as `creatives_fts_idx`
 * (see schema.ts). This keeps retrieval INSIDE Lakebase — no separate vector
 * store. The `docExpr` below is the SAME to_tsvector(...) expression the index
 * is built on, so the planner can use the GIN index for the `@@` match.
 *
 * Natural queries ("social lifestyle", "back to school promo") are parsed with
 * websearch_to_tsquery; results are ranked by ts_rank relevance, then name.
 * Only active creatives; top matches first.
 */
export async function searchCreatives(
  db: AppDb,
  query: string,
  limit = 8,
): Promise<CreativeRow[]> {
  const q = query.trim();
  if (!q) return [];

  // The indexed full-text document: MUST match creatives_fts_idx exactly so
  // the GIN index is used. name + angle + type + description, English config.
  const docExpr = sql`to_tsvector('english', coalesce(${creatives.creativeName}, '') || ' ' || coalesce(${creatives.angle}, '') || ' ' || coalesce(${creatives.creativeType}, '') || ' ' || coalesce(${creatives.description}, ''))`;

  // Primary query parser: websearch_to_tsquery handles natural phrases like
  // "social lifestyle" or 'back to school -clearance'.
  const websearch = sql`websearch_to_tsquery('english', ${q})`;
  // Graceful prefix fallback for very short/odd queries ("lux" → "luxe…"):
  // rewrite each lexeme of plainto_tsquery to a prefix (:*) tsquery. This stays
  // a SINGLE Lakebase FTS query (no ILIKE), still index-backed by the same
  // tsvector `@@`. Empty for all-stopword input, which is harmless.
  const prefix = sql`to_tsquery('english', regexp_replace(plainto_tsquery('english', ${q})::text, '''(\\s|$)', ''':*\\1', 'g'))`;
  // Combined query used for BOTH the match predicate and the relevance rank.
  const tsq = sql`(${websearch} || ${prefix})`;

  return db
    .select()
    .from(creatives)
    .where(and(eq(creatives.isActive, true), sql`${docExpr} @@ ${tsq}`))
    // Rank by full-text relevance (ts_rank), then stable by name.
    .orderBy(desc(sql`ts_rank(${docExpr}, ${tsq})`), creatives.creativeName)
    .limit(limit);
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
