-- Recoverable spend concentrated in underperforming campaigns, by category.
-- "Where is wasted budget sitting?" — the categories with the most spend
-- locked up in campaigns flagged `underperformer`. See roas_by_channel.sql
-- for the shared header / conventions.
-- @param catalog STRING = serverless_sandbox_kgi5wi_catalog
-- @param schema STRING = brightwave
SELECT
  category,
  CAST(COUNT(*) AS BIGINT) AS underperformer_count,
  CAST(ROUND(SUM(recoverable_spend_usd), 2) AS DOUBLE) AS recoverable_spend_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_campaign_position')
WHERE perf_band = 'underperformer'
  AND category IS NOT NULL
GROUP BY category
ORDER BY recoverable_spend_usd DESC
LIMIT 10
