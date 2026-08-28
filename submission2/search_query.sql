-- ─────────────────────────────────────────────────────────────────────────
-- Brightwave — RETRIEVAL FROM THE BUILD-1 LAKEBASE SEARCH INDEX (Assist · 2c)
-- ─────────────────────────────────────────────────────────────────────────
-- The `search_creatives` agent tool retrieves DIRECTLY from Angela's Build-1
-- Lakebase Search index — NOT a separate vector store. The index is a BM25
-- index built with the Lakebase `lakebase_text` extension's `lakebase_bm25`
-- access method, on the production Lakebase branch
-- (projects/birghtwave/branches/production):
--
--   Table:  brightwave.campaign_search   (owner: angela.tsai — Build 1)
--   Column: summary_tsv  tsvector  GENERATED ALWAYS AS
--             to_tsvector('english', campaign_summary || creative_angle || campaign_name)
--   Index:  CREATE INDEX campaign_search_bm25
--             ON brightwave.campaign_search USING lakebase_bm25 (summary_tsv);
--
-- The app queries that index with the extension's `<@> to_bm25query(...)`
-- operator (BM25 scores are negative; smaller = more relevant). This is the
-- exact SQL the app's `searchCreatives` helper runs
-- (brightwave/app/server/db/queries/campaigns.ts) — retrieval stays INSIDE
-- Lakebase, pulling from the one Build-1 index, with no ILIKE scan and no
-- separate/external vector store.
--
-- Live execution evidence + returned rows: see search_result.json (this run
-- used query_text = 'social lifestyle apparel'; top hits are Apparel Social
-- lifestyle winners incl. CMP-0000469, the matching winner for hero
-- underperformer CMP-0000790).
-- ─────────────────────────────────────────────────────────────────────────

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
              to_tsvector('english', :query_text),   -- e.g. 'social lifestyle apparel'
              'brightwave.campaign_search_bm25'       -- the Build-1 Lakebase Search index
            )
    ) AS bm25_score
FROM brightwave.campaign_search              -- Angela's Build-1 Lakebase Search index
ORDER BY bm25_score ASC                      -- most relevant first (scores are negative)
LIMIT 8;
