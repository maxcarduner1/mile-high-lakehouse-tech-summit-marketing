/**
 * The campaign-desk action-taking agent — Brightwave.
 *
 * Built on `@openai/agents` (OpenAI Agents SDK) pointed at Databricks'
 * Responses API. Tools capture `db` + `userEmail` via closure so every
 * action is attributed to the viewing user (OBO).
 *
 * ════════════════════════════════════════════════════════════════════════
 * WHAT SHIPS WORKING vs WHAT THE TRAINEE BUILDS  (see APP_WORKSHOP.md)
 * ════════════════════════════════════════════════════════════════════════
 * SHIPS WORKING:
 *   - The full agent loop (Responses API wiring, streaming, MLflow spans).
 *   - `ask_data` — the investigation tool. Config-driven MAS-OR-Genie:
 *     uses the MAS endpoint if `masEndpointName` is set, else the Genie
 *     space if `genieSpaceId` is set. This is the trainee's Build-1 choice
 *     (they wire ONE backend); the app registers whichever is configured.
 *
 * TRAINEE BUILDS (stubbed here — they THROW "not implemented" so the app
 * still compiles + boots, and the model knows the tools exist):
 *   - `find_underperformer`       → Build 2 (Assist): read the underperformer
 *   - `rank_actions`              → Build 2 (Assist): read the ML recommendation
 *   - `search_creatives`          → Build 2 (Assist): Lakebase Search over creatives
 *   - `execute_campaign_action`   → Build 3 (Act):   the human-in-the-loop write
 *
 * The three-phase chain (Discover → Draft+confirm → Execute) is described in
 * the instructions below so the model attempts it — but Phases 2/3 depend on
 * the stubbed tools, which is the point: the trainee implements them and the
 * chain lights up. Until then, the model can still investigate via ask_data.
 *
 * `configureAgentsSdk()` handles the Databricks Responses API wiring, the
 * `Connection: close` stale-socket workaround, and the 64-char `input[*].id`
 * strip. The endpoint it points at is now config-driven: the client's baseURL
 * is `${ctx.databricksHost}${ctx.agentBaseUrlPath}` and the SDK appends
 * `/responses`, so by default it calls the Unity AI Gateway Responses route
 * (`/ai-gateway/mlflow/v1/responses`) with `model` = the three-part UC name.
 * Base path + model come from config/app.json (agentBaseUrlPath / agentModel,
 * env AGENT_BASE_URL_PATH / AGENT_MODEL) — leave the surrounding wiring alone.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import {
  Agent,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { serviceAuthHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
// Ready-made Lakebase query helpers backing the Assist + Act tools below.
import {
  getCampaign,
  getUnderperformer,
  worstUnderperformer,
  getRecommendation,
  searchCreatives as searchCreativesQuery,
  recordCampaignAction,
  type ActionType,
} from '../db/queries/campaigns.js';
// The data-backend helpers. Both are config-driven and share the same
// DataCallResult shape + ToolProgressEvent stream, so the `ask_data` tool
// below can delegate to EITHER without the UI caring which powers it. This
// preserves the template's MAS-OR-Genie flexibility exactly.
import { callMasEndpoint } from './tools/mas.js';
import { callGenieSpace } from './tools/genie.js';
export type { ToolProgressEvent } from './tools/types.js';

/** Captured detail of the last failing call to the model serving endpoint. */
export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  code?: string;
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** MAS serving-endpoint name the `ask_data` tool talks to WHEN SET. Set in
   * `config/app.json` as `masEndpointName` (env `MAS_ENDPOINT_NAME`). Leave
   * empty to use Genie instead. This is the trainee's Build-1 backend choice
   * — the app registers whichever of MAS/Genie is configured. */
  masEndpointName: string;
  /** Genie space id the `ask_data` tool talks to WHEN `masEndpointName` is
   * empty. Set as `genieSpaceId` (env `GENIE_SPACE_ID`). */
  genieSpaceId: string;
  databricksHost: string;
  /** The agent model the Responses call sends as `model`. For the AI Gateway
   * this is the THREE-PART UC name (e.g.
   * `serverless_sandbox_kgi5wi_catalog.brightwave.brightwave-gpt-5-5`). */
  model: string;
  /** Base path appended to `databricksHost` for the OpenAI client's baseURL;
   * the Responses route is `<databricksHost><agentBaseUrlPath>/responses`.
   * Defaults to the Unity AI Gateway (`/ai-gateway/mlflow/v1`). Config-driven
   * via config/app.json `agentBaseUrlPath` (env AGENT_BASE_URL_PATH). */
  agentBaseUrlPath: string;
  /** Called by long-running tools to surface progress to the UI. */
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  /** Mutated by the OpenAI fetch shim on any non-2xx. */
  modelError?: { current: ModelErrorDetail | null };
};

// ────────────────────────────────────────────────────────────────────────────
// Adding / editing tools — READ THIS before touching `parameters: z.object(...)`.
//
// The Agents SDK ships every tool's zod schema to the Responses API with
// `strict: true`. Strict mode requires EVERY property in `required`. So use
// `.nullable()`, NOT `.optional()`:
//   ❌  reason: z.string().optional()   // breaks with strict:true (masked 502)
//   ✅  reason: z.string().nullable()   // field required, value may be null
// Every field needs a `.describe(...)`. Keep property names snake_case.
// Use the `loggedTool` wrapper (imported as `tool`), not the raw SDK `tool`.
// ────────────────────────────────────────────────────────────────────────────
function makeTools(ctx: AgentContext): Tool[] {
  // ── ask_data — SHIPS WORKING. Config-driven MAS-OR-Genie. ─────────────────
  // Delegates to the MAS endpoint if one is configured, else the Genie space.
  // Both helpers return {answer, trace_id} and stream progress via
  // ctx.onToolProgress → the Thinking panel. Registered ONLY when a backend
  // is configured (otherwise the tool would 404 confusingly).
  const askData = tool({
    name: 'ask_data',
    description:
      'Investigate the governed lakehouse with a natural-language question — the tool generates SQL / retrieves knowledge and returns a synthesized answer. Use for any "why" / "what happened" / investigative question about campaigns, creative performance, or ROAS trends. Prefer ONE narrow, well-formed question over many small ones.',
    parameters: z.object({
      question: z
        .string()
        .describe(
          'A clear, focused English question about the data. Narrow questions finish in 20–40s; broad multi-part questions take longer.',
        ),
    }),
    execute: async ({ question }) =>
      mlflow.withSpan(
        async () =>
          ctx.masEndpointName
            ? callMasEndpoint(ctx, ctx.masEndpointName, question)
            : callGenieSpace(ctx, ctx.genieSpaceId, question),
        {
          name: 'ask_data',
          spanType: mlflow.SpanType.TOOL,
          inputs: { question },
        },
      ),
  });

  // ── find_underperformer — TRAINEE BUILDS (Build 2 · Assist). STUB. ────────
  // TODO — BUILD 2 (trainee): implement this. Read the underperformer campaign
  // for {campaign_id} (or the worst one) from Lakebase app.open_underperformers
  // + app.campaign_position: ROAS, spend, recoverable spend, matching winner.
  // Helper queries are READY in server/db/queries/campaigns.ts:
  // `getUnderperformer`, `worstUnderperformer`, `getCampaign`.
  // See APP_WORKSHOP.md → "Layer 2 — Assist".
  const findUnderperformer = tool({
    name: 'find_underperformer',
    description:
      'Read the live underperforming campaign for {campaign_id} (or the worst underperformer) from Lakebase: ROAS, spend, recoverable spend, matching winner context. Read-only.',
    parameters: z.object({
      campaign_id: z
        .string()
        .nullable()
        .describe('Campaign id, e.g. CMP-0000214. Null → return the worst underperformer.'),
    }),
    execute: async ({ campaign_id }) =>
      mlflow.withSpan(
        async () => {
          // Resolve the target underperformer: the requested campaign, else
          // the worst by recoverable spend.
          const under = campaign_id
            ? await getUnderperformer(ctx.db, campaign_id)
            : await worstUnderperformer(ctx.db);
          if (!under) return { found: false };

          // The live position row for ROAS / spend context.
          const campaign = await getCampaign(ctx.db, under.campaignId);

          return {
            found: true,
            campaign_id: under.campaignId,
            channel: under.channel ?? campaign?.channel ?? null,
            category: under.category ?? campaign?.category ?? null,
            target_segment: under.targetSegment ?? campaign?.targetSegment ?? null,
            roas: under.roas ?? campaign?.roas ?? null,
            spend_to_date_usd: under.spendToDateUsd ?? campaign?.spendToDateUsd ?? null,
            recoverable_spend_usd:
              under.recoverableSpendUsd ?? campaign?.recoverableSpendUsd ?? null,
            has_matching_winner: under.hasMatchingWinner ?? false,
            matching_winner_campaign_id: under.matchingWinnerCampaignId ?? null,
            matching_winner_roas: under.matchingWinnerRoas ?? null,
          };
        },
        {
          name: 'find_underperformer',
          spanType: mlflow.SpanType.TOOL,
          inputs: { campaign_id },
        },
      ),
  });

  // ── rank_actions — TRAINEE BUILDS (Build 2 · Assist). STUB. ────────────────
  // TODO — BUILD 2 (trainee): implement this. Read the ML model's ranked
  // actions for {campaign_id} from Lakebase app.action_recommendations:
  // recommended action type, predicted ROAS lift, predicted net value, and
  // all three options (for what-if). Helper: `getRecommendation` in
  // server/db/queries/campaigns.ts.
  const rankActions = tool({
    name: 'rank_actions',
    description:
      'Read the ML model\'s ranked campaign actions — the demo\'s "ML in the loop" moment. Returns recommended action, predicted ROAS lift, and all three options.',
    parameters: z.object({
      campaign_id: z
        .string()
        .describe('Campaign id, e.g. CMP-0000214'),
    }),
    execute: async ({ campaign_id }) =>
      mlflow.withSpan(
        async () => {
          const rec = await getRecommendation(ctx.db, campaign_id);
          if (!rec) {
            return {
              scored: false,
              note: 'No action recommendation yet — build + score the roas_recommender model (Build 2 ML step), then reset the demo.',
            };
          }
          return rec;
        },
        {
          name: 'rank_actions',
          spanType: mlflow.SpanType.TOOL,
          inputs: { campaign_id },
        },
      ),
  });

  // ── search_creatives — TRAINEE BUILDS (Build 2 · Assist). STUB. ───────────
  // TODO — BUILD 2 (trainee): implement this using Lakebase Search over
  // campaign creative descriptions. See APP_WORKSHOP.md.
  const searchCreatives = tool({
    name: 'search_creatives',
    description:
      'Search the creative catalog (names + descriptions) using Lakebase Search. Returns matching creatives with context.',
    parameters: z.object({
      query: z
        .string()
        .describe('Search query, e.g. "lifestyle" or "social media" or "video"'),
    }),
    execute: async ({ query }) =>
      mlflow.withSpan(
        async () => {
          const matches = await searchCreativesQuery(ctx.db, query);
          if (matches.length === 0) return { found: false, query };
          return {
            found: true,
            query,
            count: matches.length,
            creatives: matches.map((c) => ({
              creative_id: c.creativeId,
              creative_name: c.creativeName,
              creative_type: c.creativeType,
              angle: c.angle,
              description: c.description,
              is_active: c.isActive,
            })),
          };
        },
        {
          name: 'search_creatives',
          spanType: mlflow.SpanType.TOOL,
          inputs: { query },
        },
      ),
  });

  // ── execute_campaign_action — TRAINEE BUILDS (Build 3 · Act). STUB. ───────
  // TODO — BUILD 3 (trainee): implement this. Write a campaign action (approved
  // action + brief) to app.campaign_actions_app + return the action_id.
  // Helper: `recordCampaignAction` in server/db/queries/campaigns.ts.
  const executeCampaignAction = tool({
    name: 'execute_campaign_action',
    description:
      'Record an approved campaign action (replicate_winner / reallocate_budget / pause + drafted brief) to the campaign desk. Writes to app.campaign_actions_app and triggers dataMutated → Campaign Desk refresh. Human-in-the-loop: only call after user approval.',
    parameters: z.object({
      campaign_id: z
        .string()
        .describe('Campaign id, e.g. CMP-0000214'),
      action_type: z
        .string()
        .describe('replicate_winner / reallocate_budget / pause'),
      target_campaign_id: z
        .string()
        .nullable()
        .describe('Winner replicated or reallocation target; null for pause'),
      drafted_brief: z
        .string()
        .describe('The agent-drafted campaign brief'),
      predicted_roas_lift: z
        .number()
        .nullable()
        .describe('Predicted ROAS lift from the model, if available'),
    }),
    execute: async ({
      campaign_id,
      action_type,
      target_campaign_id,
      drafted_brief,
      predicted_roas_lift,
    }) =>
      mlflow.withSpan(
        async () => {
          const { actionId } = await recordCampaignAction(ctx.db, {
            campaignId: campaign_id,
            actionType: action_type as ActionType,
            targetCampaignId: target_campaign_id,
            draftedBrief: drafted_brief,
            predictedRoasLift: predicted_roas_lift,
            userEmail: ctx.userEmail,
          });
          return {
            recorded: true,
            action_id: actionId,
            campaign_id,
            action_type,
            predicted_roas_lift,
          };
        },
        {
          name: 'execute_campaign_action',
          spanType: mlflow.SpanType.TOOL,
          inputs: { campaign_id, action_type, target_campaign_id },
        },
      ),
  });

  // find_underperformer / rank_actions / search_creatives / execute_campaign_action
  // are registered so the MODEL knows they exist (and the trainee sees them
  // in the tool list) — they throw until implemented. ask_data is registered
  // only when a backend is configured.
  const tools: Tool[] = [
    findUnderperformer,
    rankActions,
    searchCreatives,
    executeCampaignAction,
  ];
  if (ctx.masEndpointName || ctx.genieSpaceId) {
    tools.unshift(askData);
  }
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Authenticate the Responses-API gateway client as the APP SERVICE PRINCIPAL,
  // NOT the viewing user's OBO token. The Unity AI Gateway Responses route
  // requires the `ai-gateway` scope; the user's minted `x-forwarded-access-token`
  // lacks it (→ `403 Invalid scope, required scopes: ai-gateway`), while the app
  // SP is authorized. Per-user attribution isn't needed for the agent's model
  // call in this demo, so we use `serviceAuthHeaders()` (always the SP) here.
  // The OBO-attributed callers (ask_data/Genie, warehouse SQL, MLflow) still use
  // `authHeaders(req)` unchanged. See server/lib/auth.ts for the mechanism.
  const headers = await serviceAuthHeaders();
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  // Custom fetch: fresh TCP connection per call (avoids the stale-socket 502
  // after a long ask_data hop) + strip the >64-char `input[*].id` the SDK
  // echoes back on round 2 (Databricks' Responses API rejects long ids and
  // the streaming gateway masks the 400 as a bare 502). See git history.
  // Base URL for the OpenAI/Agents SDK client. The SDK appends `/responses`,
  // so this resolves to `${host}${agentBaseUrlPath}/responses` — the Unity AI
  // Gateway Responses route by default (agentBaseUrlPath = /ai-gateway/mlflow/v1),
  // matching the verified curl. `model` is the three-part UC name (ctx.model).
  const client = new OpenAI({
    apiKey: bearer,
    baseURL: `${ctx.databricksHost}${ctx.agentBaseUrlPath}`,
    maxRetries: 4,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Connection', 'close');
      let body = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as {
            input?: Array<Record<string, unknown>>;
            messages?: Array<Record<string, unknown>>;
          };
          if (Array.isArray(parsed.input)) {
            for (const item of parsed.input) {
              const id = item.id;
              if (typeof id === 'string' && id.length > 64) {
                delete item.id;
              }
            }
          }
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              const content = (m as { content?: unknown }).content;
              if (Array.isArray(content)) {
                for (const part of content as Array<Record<string, unknown>>) {
                  if (part && typeof part === 'object') {
                    delete part.annotations;
                  }
                }
              }
            }
          }
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — pass through */
        }
      }
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString?.() ?? String(input);
      console.debug(
        `[openai-shim] → ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 2000) : '(non-string)'}`,
      );
      const tShim = Date.now();
      let resp: Response;
      try {
        resp = await fetch(input as Parameters<typeof fetch>[0], {
          ...init,
          headers,
          body,
          keepalive: false,
        });
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      if (!resp.ok) {
        try {
          const text = await resp.clone().text();
          let code: string | undefined;
          let message: string | undefined;
          try {
            const parsed = JSON.parse(text) as { error_code?: string; message?: string };
            code = parsed.error_code;
            message = parsed.message;
          } catch {
            /* body wasn't JSON — keep raw text */
          }
          if (ctx.modelError) {
            ctx.modelError.current = {
              status: resp.status,
              url,
              bodyText: text,
              code,
              message,
            };
          }
          console.error(
            `[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 4000) : '(non-string)'}\n  response_body: ${text.slice(0, 4000)}`,
          );
        } catch (e) {
          console.error('[openai-shim] failed to clone error response', e);
        }
      }
      return resp;
    },
  });

  setDefaultOpenAIClient(client);
  // Tracing is auto-wired by mlflow-tracing; disable to see raw agent loops.
  setTracingDisabled(false);

  const tools = makeTools(ctx);
  if (tools.length === 0) {
    console.warn('[agent] No tools configured — ask_data backend not set.');
  }

  const agent = new Agent({
    name: 'brightwave-campaign-desk',
    model: ctx.model,
    tools,
    instructions: `You are the Brightwave Campaign Desk agent. Your role is to help Priya Anand (CMO, Brightwave) isolate drivers of winning campaigns and execute targeted optimization moves.`,
  });

  // Agent is ready for use. Caller (chat-stream/agent-stream.ts) wires it
  // into the event stream.
  global.agentInstanceDEV = { agent, tools };
}

// DEV: place for the global agent instance (so tools can debug-log).
// This is NOT a proper DI pattern — it's a workaround for the Agents SDK's
// async agent construction (needs to happen inside configureAgentsSdk before
// the first chat message). In production, return the agent from this module
// and wire it properly.
declare global {
  var agentInstanceDEV: { agent: Agent; tools: Tool[] } | undefined;
}
