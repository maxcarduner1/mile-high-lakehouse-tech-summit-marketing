-- The ranked underperformer table — the heart of the Campaign Desk analytics
-- page. Every campaign flagged `underperformer`, ordered by recoverable spend
-- (biggest recoverable budget first), with its matching-winner info joined in
-- from gold_open_underperformers so the UI can show "has a winner to
-- replicate". The hero campaign CMP-0000214 (Apparel Display Q2, ROAS ~1.1)
-- surfaces near the top. See roas_by_channel.sql for the shared header.
-- @param catalog STRING = serverless_sandbox_kgi5wi_catalog
-- @param schema STRING = brightwave
SELECT
  p.campaign_id,
  p.campaign_name,
  p.channel,
  p.category,
  CAST(p.roas AS DOUBLE) AS roas,
  CAST(ROUND(p.spend_to_date_usd, 2) AS DOUBLE) AS spend_to_date_usd,
  CAST(ROUND(p.attributed_revenue_usd, 2) AS DOUBLE) AS attributed_revenue_usd,
  CAST(ROUND(p.recoverable_spend_usd, 2) AS DOUBLE) AS recoverable_spend_usd,
  COALESCE(u.has_matching_winner, FALSE) AS has_matching_winner,
  u.matching_winner_campaign_id
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_campaign_position') p
LEFT JOIN IDENTIFIER(:catalog || '.' || :schema || '.gold_open_underperformers') u
  ON p.campaign_id = u.campaign_id
WHERE p.perf_band = 'underperformer'
ORDER BY p.recoverable_spend_usd DESC
LIMIT 25
