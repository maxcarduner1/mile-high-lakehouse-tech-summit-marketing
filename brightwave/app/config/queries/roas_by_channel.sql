-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Brightwave analytics queries (config/queries/*.sql).                 ║
-- ║                                                                      ║
-- ║ Each file is ONE chart on the Campaign Desk analytics page. They run ║
-- ║ live against the SQL warehouse (the Brightwave Gold Delta tables),   ║
-- ║ NOT the Lakebase mirror — this is the "lakehouse analytics" half of  ║
-- ║ the story (aggregate scans across all campaigns).                    ║
-- ║                                                                      ║
-- ║ Rules:                                                               ║
-- ║   1. Reference tables via IDENTIFIER() built from the :catalog and   ║
-- ║      :schema params — `FROM IDENTIFIER(:catalog || '.' || :schema    ║
-- ║      || '.gold_campaign_position')`, NOT a hardcoded name — so the   ║
-- ║      same SQL resolves on any workspace. charts.ts binds them at     ║
-- ║      runtime from config/app.json (env → appConfig.data).            ║
-- ║   2. Give type-generation a describe-time sample via the @param      ║
-- ║      annotations below (used ONLY during DESCRIBE QUERY at typegen;   ║
-- ║      the runtime still binds the real values). Point the sample at a ║
-- ║      workspace where the Gold tables already exist.                  ║
-- ║   3. Register the query key → filename in charts.ts's QUERY_FILES    ║
-- ║      map and reference it from AnalyticsView.tsx.                     ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Marketing efficiency by channel: average ROAS + campaign count per channel.
-- Shows which channels are pulling their weight across the whole book.
-- @param catalog STRING = serverless_sandbox_kgi5wi_catalog
-- @param schema STRING = brightwave
SELECT
  channel,
  CAST(COUNT(*) AS BIGINT) AS campaign_count,
  CAST(ROUND(AVG(roas), 2) AS DOUBLE) AS avg_roas
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_campaign_position')
WHERE channel IS NOT NULL
GROUP BY channel
ORDER BY avg_roas DESC
