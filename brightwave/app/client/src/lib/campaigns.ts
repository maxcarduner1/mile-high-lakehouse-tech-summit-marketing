/**
 * REST helpers for the Brightwave Campaign Desk.
 *
 * These hit the read-only campaign routes (server/routes/campaigns.ts), which
 * SELECT from the synced Lakebase mirrors (app.campaign_position,
 * app.open_underperformers) joined to the app's writable action table. The
 * TYPES live in `shared/types.ts` — change those there, not here. This file
 * should only contain `fetch` calls.
 */
import { okOrThrow } from './api';
import type {
  RankedUnderperformer,
  CampaignDeskSummary,
} from '@/shared/types';

/** The ranked underperformer queue (biggest recoverable spend first). */
export async function fetchUnderperformers(
  limit = 100,
): Promise<RankedUnderperformer[]> {
  const res = await okOrThrow(
    await fetch(`/api/campaigns/underperformers?limit=${limit}`),
    '/api/campaigns/underperformers',
  );
  return res.json() as Promise<RankedUnderperformer[]>;
}

/** Per-band counts + total recoverable spend (the KPI row). */
export async function fetchCampaignSummary(): Promise<CampaignDeskSummary> {
  const res = await okOrThrow(
    await fetch('/api/campaigns/summary'),
    '/api/campaigns/summary',
  );
  return res.json() as Promise<CampaignDeskSummary>;
}
