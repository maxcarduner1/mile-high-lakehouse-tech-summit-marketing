# Mile High Lakehouse — Marketing

## Business challenge

Brightwave is struggling to capitalize on its own winners. Dozens of campaigns run at once, but the factors that make the top ones succeed — channel mix, creative, and audience targeting — are only understood weeks later, when attribution (the batch work of deciding which touchpoint earned the sale) finally lands. By then the winning formula has not been copied to the campaigns that could have used it, and underperformers have spent every day in the meantime.

Return on ad spend is the ratio of revenue earned to money spent on a campaign. It erodes because lessons from the best campaigns do not reach the rest until the report says so, and by then the quarter is largely spent. About 20% of paid spend (~$40M/yr) sits in underperforming campaigns whose fixes are visible in the winners but are not applied until weeks too late.

The fix has to be AI-assisted without the AI spend running open-ended. A content assistant generating copy at volume risks runaway cost and off-brand output.

## What they want to solve

A live view that isolates which campaigns are and are not working, surfaces the factors driving the top performers, and prescribes how to replicate them across the underperformers — reallocating budget and applying the winning channel, creative, and targeting mix — while the quarter is still in play.

## Business outcomes to defend

| Outcome | Detail |
| --- | --- |
| ~$4M/yr | Recovered from smarter spend reallocation |
| Higher | Return on ad spend |
| Capped | Auditable, on-brand AI |
| Real-time | Batch-attribution latency to media decisions |

## Current Databricks estate

- A lakehouse aggregating campaign, spend, and engagement data.
- Feeds attribution and media-mix models under Unity Catalog governance.
- Marketers work from batch performance dashboards that refresh on a schedule.
- Budget reallocation decisions lag the market.

## Who you are building for

### Business personas

**Zanele Mthembu — CMO**

She cares about the ~$200M in annual media spend she owns, and the ~$40M of it currently flowing to underperformers before the attribution report catches up.

> Did we scale what's working this week instead of next quarter?

**Mio Nakamura — VP Marketing Operations**

She cares about total AI spend across the marketing org, where content generation is the fastest-growing slice of a company-wide pie. The ~$300K/yr here needs a hard ceiling because volume compounds, and off-brand output carries a cost beyond tokens.

> What does generated content cost us, what share of AI spend is it, and is it on brand?

### Technical personas

**Henrik Dahl — Director of Marketing Data & Analytics Engineering**

He cares about getting campaign, spend, and conversion data live enough that a reallocation decision is not already stale.

> Is the number a marketer acts on current, or last night's?

**Samir Chaudhry — Platform Engineering Lead, Marketing Technology**

He was asked to explain how off-brand copy made it into a live campaign, so he cares about tracing the output back through the campaign and creative data to its source. He needs to show what the model was working from and what it was permitted to produce.

> When something off-brand ships, can I show where it came from?
