import type { ProductFeedbackCategory } from "../analytics.js";

export interface GuildPrivacyResponse {
  productAnalyticsEnabled: boolean;
  contributionRetentionDays: 7;
  aggregateRetentionDays: 180;
  feedbackRetentionDays: 60;
}

export interface ProductFeedbackRequest {
  category: ProductFeedbackCategory;
  message: string;
}

export interface ProductFeedbackResponse { id: number; createdAt: string }

export interface ProductMetricSummary {
  day: string;
  event: string;
  module: string | null;
  step: string | null;
  outcome: string;
  appVersion: string;
  cohortBucket: number;
  count: number;
  guildCount: number;
}

export interface ProductMetricsResponse {
  privacyThreshold: 3;
  metrics: ProductMetricSummary[];
}
