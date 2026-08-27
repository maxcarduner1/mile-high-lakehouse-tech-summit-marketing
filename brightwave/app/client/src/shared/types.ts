/**
 * Types that cross the client/server boundary. Keep in sync with
 * server/db/queries/campaigns.ts + server/db/queries/chat.ts.
 *
 * The app is small enough that hand-copying these is simpler than a
 * shared package. If this file grows past ~200 lines, consider a
 * proper shared lib.
 *
 * ─────────────────────────────────────────────────────────────────────
 * REPURPOSING THE TEMPLATE (single most important file to update)
 * ─────────────────────────────────────────────────────────────────────
 * This is the canonical schema for the *domain* — every page, fetch
 * helper, badge, and SQL projection uses what's defined here. When you
 * swap the data model:
 *
 *   1. Replace the entity types below (`CampaignRow`, `CampaignActionRow`,
 *      `CreativeRow`, etc.) with the shape your demo cares about.
 *   2. Update the matching SQL/Drizzle queries in
 *      `server/db/queries/campaigns.ts` so `/api/...` endpoints return
 *      rows that match the new types. Rename the queries file too.
 *   3. Update the fetch helpers in `client/src/lib/campaigns.ts` (rename
 *      to match your domain — e.g. `lib/turbines.ts`).
 *   4. The string-enum types (`CampaignActionStatus`, `PerfBand`,
 *      channel names, category names) drive badges in `shared/badges.tsx`
 *      — keep those two files aligned. Adding a new enum value means
 *      adding a matching color mapping in `badges.tsx`.
 *   5. The agent's tool argument schemas in `server/agent/campaigndesk.ts`
 *      reference these types implicitly (the Zod schemas mirror field names).
 *      Update tool descriptions + Zod shapes when you swap entities.
 *
 * Search the codebase for each type name below to find all references
 * before renaming. There is no compile-time guarantee that SQL projects
 * the right columns — type-checking helps the client side, but the
 * server queries are stringly-typed against the warehouse.
 * ───────────────────────────────────────────────────────────────────── */

export type PerfBand = 'winner' | 'underperformer' | 'steady' | 'paused';
export type CampaignActionStatus = 'proposed' | 'approved' | 'executed' | 'overridden';
export type ActionType = 'replicate_winner' | 'reallocate_budget' | 'pause';

export type CampaignRow = {
  id: string;
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  category: string | null;
  targetSegment: string | null;
  creativeId: string | null;
  campaignSummary: string | null;
  status: string | null;
  roas: number | null;
  spendToDateUsd: number | null;
  attributedRevenueUsd: number | null;
  perfSignal: string | null;
  recoverableSpendUsd: number | null;
  perfBand: PerfBand;
};

export type CreativeRow = {
  id: string;
  creativeId: string;
  creativeName: string | null;
  creativeType: string | null;
  angle: string | null;
  description: string | null;
  isActive: boolean | null;
};

export type AuditEntry = {
  at: string;
  by: string;
  // Brightwave actions + the legacy template actions ('rejected'/'escalated'/
  // 'email_sent') the unchanged operations/ views still switch on. Trainees
  // narrow this to their real action set when they rebuild the views.
  action:
    | 'proposed'
    | 'approved'
    | 'executed'
    | 'declined'
    | 'note'
    | 'rejected'
    | 'escalated'
    | 'email_sent';
  notes?: string;
  tool?: string;
};

export type CampaignActionRow = {
  id: string;
  campaignId: string;
  actionType: ActionType;
  targetCampaignId: string | null;
  draftedBrief: string | null;
  predictedRoasLift: number | null;
  status: CampaignActionStatus;
  approvedBy: string | null;
  auditTrail: AuditEntry[];
  createdAt: string;
  decidedAt: string | null;
};

export type CampaignActionDetail = {
  action_id: string;
  campaign_id: string;
  action_type: ActionType;
  target_campaign_id: string | null;
  drafted_brief: string | null;
  predicted_roas_lift: number | null;
  status: CampaignActionStatus;
  approved_by: string | null;
  audit_trail: AuditEntry[];
  created_at: string;
  decided_at: string | null;
};

export type CampaignSummary = {
  total_underperformers: number;
  total_recoverable_spend_usd: number;
  avg_roas: number;
};

// ── Campaign Desk (client Operations page) — the ranked underperformer queue.
// Mirrors server/db/queries/campaigns.ts → RankedUnderperformer /
// CampaignDeskSummary. Keep the two aligned.
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
  latestActionType: ActionType | null;
  latestActionStatus: string | null;
};

export type CampaignDeskSummary = {
  bands: { perfBand: string; n: number; recoverableSpendUsd: number }[];
  totalUnderperformers: number;
  totalRecoverableSpendUsd: number;
};
