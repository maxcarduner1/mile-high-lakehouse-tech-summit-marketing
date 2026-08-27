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
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  campaignPosition,
  openUnderperformers,
  actionRecommendations,
  creatives,
  campaignActions,
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
 * Text search over the creative catalog in Lakebase Postgres — the Lakebase
 * Search showcase. Case-insensitive match across the creative's name, angle,
 * type, and description; only active creatives; top matches first.
 */
export async function searchCreatives(
  db: AppDb,
  query: string,
  limit = 8,
): Promise<CreativeRow[]> {
  const q = query.trim();
  if (!q) return [];
  const term = `%${q}%`;
  const match = or(
    ilike(creatives.creativeName, term),
    ilike(creatives.angle, term),
    ilike(creatives.creativeType, term),
    ilike(creatives.description, term),
  );
  return db
    .select()
    .from(creatives)
    .where(and(eq(creatives.isActive, true), match))
    // Rank name/angle hits above description-only hits, then stable by name.
    .orderBy(
      desc(
        sql`(${ilike(creatives.creativeName, term)})::int + (${ilike(creatives.angle, term)})::int`,
      ),
      creatives.creativeName,
    )
    .limit(limit);
}

/**
 * Record an approved campaign action to app.campaign_actions_app — the ONLY
 * write the app makes (the synced mirrors are read-only). Runs in a
 * transaction; stamps the approving user + an append-only audit entry, and
 * returns the generated action id. See APP_WORKSHOP §Layer 3a.
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
    return { actionId: rows[0].id };
  });
}
