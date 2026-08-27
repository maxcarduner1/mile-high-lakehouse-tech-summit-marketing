/**
 * Brightwave Campaign Desk read routes.
 *
 * The Campaign Desk UI (client Operations page) consumes these. They read the
 * READ-ONLY synced Lakebase mirrors (app.campaign_position,
 * app.open_underperformers) LEFT JOINed to the app's own writable action table
 * — never mutating any of them. Writes happen only through the agent's
 * execute_campaign_action tool (see server/agent/campaigndesk.ts →
 * recordCampaignAction).
 *
 *   GET /api/campaigns/underperformers  → ranked underperformer queue
 *   GET /api/campaigns/summary          → per-band counts + recoverable spend
 *   GET /api/campaigns/:id              → one campaign's live position
 */
import type { Application, Request, Response } from 'express';
import type { AppDb } from '../db/index.js';
import {
  rankedUnderperformers,
  campaignDeskSummary,
  getCampaign,
} from '../db/queries/campaigns.js';

export function registerCampaignRoutes(
  app: Application,
  deps: { db: AppDb },
): void {
  const { db } = deps;

  // Ranked queue of underperforming campaigns (biggest recoverable spend
  // first) — the main Campaign Desk table.
  app.get(
    '/api/campaigns/underperformers',
    async (req: Request, res: Response) => {
      // req.query values are string | string[] | ParsedQs; take the first
      // scalar form and clamp to a sane range (default 100, max 500).
      const raw = req.query.limit;
      const limitStr = Array.isArray(raw) ? raw[0] : raw;
      const parsed = parseInt(typeof limitStr === 'string' ? limitStr : '', 10);
      const limit = Math.min(Math.max(Number.isNaN(parsed) ? 100 : parsed, 1), 500);
      const rows = await rankedUnderperformers(db, limit);
      res.json(rows);
    },
  );

  // Per-band counts + total recoverable spend — the KPI row.
  app.get('/api/campaigns/summary', async (_req: Request, res: Response) => {
    const summary = await campaignDeskSummary(db);
    res.json(summary);
  });

  // One campaign's live position (used for deep links / row detail).
  app.get('/api/campaigns/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const row = await getCampaign(db, id);
    if (!row) {
      res.status(404).json({ error: `Unknown campaign: ${id}` });
      return;
    }
    res.json(row);
  });
}
