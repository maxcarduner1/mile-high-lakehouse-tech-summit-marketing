-- ─────────────────────────────────────────────────────────────────────────
-- Brightwave Campaign Desk — the LIVE ranked "Visualize" view (Build-2 Layer 1)
-- ─────────────────────────────────────────────────────────────────────────
-- This is the query the app's Campaign Desk renders as its ranked queue: every
-- campaign in the `underperformer` performance band, worst-first by recoverable
-- spend, LEFT JOINed to (a) its matching-winner flag from the open-underperformer
-- table, (b) the ML action recommendation, and (c) the latest recorded action
-- from the writable table (so a committed decision is reflected on the next read
-- — the closed loop).
--
-- Runtime form: the app reads the Lakebase synced mirror (app.campaign_position,
-- app.open_underperformers, app.action_recommendations) + its own writable
-- app.campaign_actions_app via Drizzle. The equivalent Databricks SQL below runs
-- against the Build-1 Gold Delta tables (serverless warehouse) and returns the
-- same ranked result — this is what produced view_result.json.
--
-- Hero record: CMP-0000790 (apparel / gen_z / display, ROAS 1.15, recoverable
-- $196,579.69) whose matching winner is CMP-0000469 (ROAS 4.99).
-- ─────────────────────────────────────────────────────────────────────────

SELECT
    p.campaign_id,
    p.campaign_name,
    p.channel,
    p.category,
    p.target_segment,
    p.roas,
    p.spend_to_date_usd,
    p.attributed_revenue_usd,
    p.recoverable_spend_usd,
    p.perf_signal,
    u.has_matching_winner,
    u.matching_winner_campaign_id,
    r.recommended_action,
    r.predicted_roas_lift,
    r.predicted_net_value_usd,
    a.action_type   AS latest_action_type,
    a.status        AS latest_action_status,
    a.approved_by   AS latest_action_approved_by
FROM serverless_sandbox_kgi5wi_catalog.brightwave.gold_campaign_position AS p
LEFT JOIN serverless_sandbox_kgi5wi_catalog.brightwave.gold_open_underperformers AS u
       ON p.campaign_id = u.campaign_id
LEFT JOIN serverless_sandbox_kgi5wi_catalog.brightwave.gold_action_recommendations AS r
       ON p.campaign_id = r.campaign_id
-- latest recorded action per campaign from the writable Postgres table
-- (in the live app this is a DISTINCT ON (campaign_id) ... ORDER BY created_at DESC
--  join against app.campaign_actions_app; shown here as the closed-loop source)
LEFT JOIN (
    SELECT campaign_id, action_type, status, approved_by,
           ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY created_at DESC) AS rn
    FROM app.campaign_actions_app
) AS a
       ON p.campaign_id = a.campaign_id AND a.rn = 1
WHERE p.perf_band = 'underperformer'
ORDER BY p.recoverable_spend_usd DESC
LIMIT 100;
