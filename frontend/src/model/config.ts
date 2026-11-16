// Editable weights and cost assumptions (SPECIFICATIONS §4.1 step 6, §4.3).
// The spec names config/weights.yaml; this is the same table as a typed module so the browser build needs no YAML parser.
import type { Credibility, LegalStatus, Reliability, Status } from "./types";

/** Least to most severe. "Most severe" in §4.1 step 5 means the highest index. */
export const STATUS_ORDER: Status[] = [
  "CLEAR", "WATCH", "APPROVAL_EXPIRING", "AT_RISK", "LICENSE_REQUIRED", "LICENSE_REQUIRED_TENANT",
  "BLOCKED_DOD", "BLOCKED_FEDERAL", "BLOCKED_EXPORT", "BLOCKED_NEW_AUTH",
];

export interface WeightsConfig {
  severity: Record<Status, number>;
  legal_status_confidence: Record<LegalStatus, number>;
  reliability_confidence: Record<Reliability, number>;
  credibility_confidence: Record<Credibility, number>;
  no_primary_source_factor: number;
  approval_warning_months: number;
  ownership_lookback_months: number;
  affiliate_hops: number;
  default_concern_countries: string[];
}

export const DEFAULT_WEIGHTS: WeightsConfig = {
  severity: {
    CLEAR: 0, WATCH: 0.2, APPROVAL_EXPIRING: 0.4, AT_RISK: 0.5, LICENSE_REQUIRED: 0.6, LICENSE_REQUIRED_TENANT: 0.6,
    BLOCKED_DOD: 0.8, BLOCKED_FEDERAL: 0.8, BLOCKED_EXPORT: 1, BLOCKED_NEW_AUTH: 1,
  },
  legal_status_confidence: { ENACTED: 1, PROPOSED: 0.7, INTRODUCED: 0.6, REPORTED: 0.5, RUMORED: 0.3, WITHDRAWN: 0 },
  // F and 6 mean "cannot be judged" in the Admiralty scale; they rank as the weakest grades here.
  reliability_confidence: { A: 1, B: 0.9, C: 0.75, D: 0.6, E: 0.4, F: 0.35 },
  credibility_confidence: { 1: 1, 2: 0.9, 3: 0.75, 4: 0.5, 5: 0.3, 6: 0.25 },
  no_primary_source_factor: 0.9,
  approval_warning_months: 6,
  ownership_lookback_months: 36,
  affiliate_hops: 3,
  default_concern_countries: ["CHN", "RUS", "IRN", "PRK"],
};

/** config/generations.yaml equivalent: per-port power and relative port density for SHIFT_GENERATION. */
export const GENERATIONS: Record<number, { watts_per_port: number; gbps_per_port: number }> = {
  800: { watts_per_port: 16, gbps_per_port: 800 },
  1600: { watts_per_port: 25, gbps_per_port: 1600 },
  3200: { watts_per_port: 38, gbps_per_port: 3200 },
};

/** getCostModel() stand-in until a host simulator supplies one (§9). */
export const COST_MODEL = {
  carrying_cost_per_month: 0.01, // share of inventory value per month for PULL_FORWARD
  us_content_unit_cost_uplift: 0.14,
  us_content_lead_time_weeks: 10,
  enclave_fixed_cost_usd: 2_500_000,
  enclave_schedule_weeks: 6,
  relocate_fixed_cost_usd: 15_000_000,
  relocate_schedule_weeks: 26,
  veu_schedule_weeks: 0,
};
