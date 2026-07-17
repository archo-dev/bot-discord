import { Hono } from "hono";
import { z } from "zod";
import { PRODUCT_FEEDBACK_CATEGORIES, type GuildPrivacyResponse, type ProductFeedbackResponse } from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import { getGuildPrivacy, insertProductFeedback, setGuildPrivacy } from "../db/queries.js";
import { purgeGuildContributions } from "../analytics/service.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

export const privacyRouter = new Hono<AppContext>();

function response(enabled: boolean): GuildPrivacyResponse {
  return { productAnalyticsEnabled: enabled, contributionRetentionDays: 7, aggregateRetentionDays: 180, feedbackRetentionDays: 60 };
}

privacyRouter.get("/guilds/:guildId/privacy", async (c) => {
  return c.json(response(await getGuildPrivacy(c.env.DB, c.req.param("guildId")!)));
});

const privacySchema = z.object({ productAnalyticsEnabled: z.boolean() }).strict();
privacyRouter.patch("/guilds/:guildId/privacy", async (c) => {
  const parsed = privacySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const guildId = c.req.param("guildId")!;
  await setGuildPrivacy(c.env.DB, guildId, parsed.data.productAnalyticsEnabled);
  if (!parsed.data.productAnalyticsEnabled) await purgeGuildContributions(c.env, guildId);
  return c.json(response(parsed.data.productAnalyticsEnabled));
});

const feedbackSchema = z.object({
  category: z.enum(PRODUCT_FEEDBACK_CATEGORIES),
  message: z.string().trim().min(1).max(1000),
}).strict();
privacyRouter.post("/guilds/:guildId/feedback", rateLimit({ name: "product-feedback", limit: 3, windowSeconds: 3600 }), async (c) => {
  const parsed = feedbackSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const created = await insertProductFeedback(c.env.DB, c.req.param("guildId")!, parsed.data.category, parsed.data.message);
  const body: ProductFeedbackResponse = created;
  return c.json(body, 201);
});
