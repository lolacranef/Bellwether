// Data model for the proposed-regulation simulation (SPECIFICATIONS §3, §7B.1).
// Dates are ISO strings (YYYY-MM-DD); string comparison orders them correctly.

export type DateStr = string;
export type ISO3 = string;

// ---------- Intelligence ----------

export type SourceType = "PRIMARY" | "LEGAL_ANALYSIS" | "PRESS" | "ANALYST_NOTE" | "RUMOR";
export type Reliability = "A" | "B" | "C" | "D" | "E" | "F";
export type Credibility = 1 | 2 | 3 | 4 | 5 | 6;

export interface Source {
  id: string;
  url: string;
  publisher: string;
  date: DateStr;
  source_type: SourceType;
  reliability: Reliability;
  credibility: Credibility;
  excerpt_note: string; // one-sentence paraphrase, never a long quote
}

export interface IntelItem {
  id: string;
  title: string;
  received_date: DateStr;
  summary: string;
  sources: Source[];
  instruments: string[];
  analyst: string;
  notes: string;
}

export type Authority = "FCC" | "CONGRESS" | "DOW" | "DHS" | "COMMERCE_BIS" | "TREASURY" | "WHITE_HOUSE" | "OTHER";
export type InstrumentType =
  | "ORDER" | "NPRM_FNPRM" | "COVERED_LIST_ENTRY" | "BILL" | "ENTITY_LIST" | "DETERMINATION" | "REPORTED_DRAFT" | "IFR" | "GUIDANCE";
export type LegalStatus = "ENACTED" | "PROPOSED" | "INTRODUCED" | "REPORTED" | "RUMORED" | "WITHDRAWN";

export interface Instrument {
  id: string;
  name: string;
  authority: Authority;
  instrument_type: InstrumentType;
  legal_status: LegalStatus;
  status_history: { date: DateStr; status: LegalStatus; source_id: string }[];
  primary_source_available: boolean;
  rules: string[];
}

// ---------- Rules ----------

export type Context =
  | "NEW_FCC_AUTHORIZATION" | "IMPORT_MARKETING" | "FEDERAL_NSS_PROCUREMENT" | "DOD_CONTRACTING"
  | "DOD_PROCUREMENT_GOODS" | "FIRMWARE_UPDATES" | "ALL"
  | "EXPORT_LICENSE_CHIPS" | "REMOTE_ACCESS_IAAS" | "IS_INFORMED_NOTICE";

export type ListRef = "COVERED_LIST" | "LIST_1260H" | "ENTITY_LIST" | "SDN" | "NS_CMIC";

export type ProductCategory =
  | "OPTICAL_TRANSCEIVER" | "SWITCH" | "SERVER" | "ROUTER_CONSUMER" | "ROUTER_ENTERPRISE"
  | "POWER_INVERTER_CONNECTED" | "NIC" | "BMC" | "PSU" | "OTHER";

export type DefinitionMode = "PRODUCER" | "PRODUCTION_LOCATION" | "EITHER" | "BOTH";
export type ComponentTrigger = "FINISHED_DEVICE" | "CONTAINS_LOGIC_BEARING_COMPONENT" | "CONTAINS_ANY_COMPONENT";
export type OwnershipTest = "ULTIMATE_PARENT" | "DIRECT_PARENT" | "ANY_OWNER_GE_PCT";

export type CarveOutType =
  | "US_BOM_VALUE_MIN" | "DOMESTIC_END_PRODUCT" | "CONDITIONAL_APPROVAL" | "EXISTING_AUTHORIZATION" | "WAIVER";

export interface CarveOut {
  type: CarveOutType;
  threshold?: number | null;
  threshold_schedule?: { from: DateStr; value: number }[];
  expires?: DateStr | null;
  note?: string;
}

export interface VolumeThreshold {
  metric: "GPU_HOURS" | "GPU_COUNT" | "CLUSTER_SHARE";
  value: number;
  unit: string;
  /** false while the value is a placeholder awaiting the rule text. Below-threshold usage then shows WATCH, never CLEAR. */
  confirmed: boolean;
}

export interface Rule {
  id: string;
  instrument_id: string;
  description: string;
  /** Extension: false keeps a rule out of evaluation unless a branch switches it on. Default true. */
  enabled?: boolean;
  /** Extension: DISCLOSURE rules change what a license application must contain, not the status. Default STATUS. */
  effect?: "STATUS" | "DISCLOSURE";
  applies_to_context: Context[];
  target: {
    entity_ids?: string[];
    include_affiliates?: boolean;
    entity_list_refs?: ListRef[];
    production_country?: ISO3[];
    /** Extension for "foreign-produced": matches when the production country is NOT in this list. */
    production_country_not_in?: ISO3[];
    producer_nationality?: ISO3[];
    definition_mode?: DefinitionMode;
    hq_country_of_ultimate_parent?: ISO3[];
    smuggling_risk_hq_country?: ISO3[];
    ownership_test?: OwnershipTest;
    ownership_pct_threshold?: number | null;
  };
  scope: {
    /** null or omitted = every category */
    product_categories?: ProductCategory[] | null;
    component_trigger?: ComponentTrigger;
    min_generation_gbps?: number | null;
    new_models_only?: boolean;
    volume_threshold?: VolumeThreshold | null;
    installed_base_treatment?: "EXEMPT" | "COVERED" | "UNKNOWN";
  };
  timing: {
    effective_date: DateStr | null;
    transition_years?: number | null;
    sunset_or_expiry?: DateStr | null;
    /** Extension: a context with its own start date (1260H contracting vs. goods). */
    context_effective_dates?: Partial<Record<Context, DateStr>>;
  };
  carve_outs: CarveOut[];
  confidence_note: string;
}

// ---------- Scenarios ----------

export interface BranchOverride { rule_id: string; path: string; value: unknown }
export interface Branch { id: string; name: string; description?: string; overrides: BranchOverride[] }

export interface IsInformedEvent {
  id: string;
  rule_id: string;
  date: DateStr;
  target_part_id?: string;
  target_tenant_id?: string;
  note: string;
}

export interface Scenario {
  id: string;
  name: string;
  created: DateStr;
  intel_items: string[];
  rules: { rule_id: string; likelihood: number; likelihood_basis: string }[];
  branches: Branch[];
  horizon: { start: DateStr; end: DateStr; step: "MONTH" | "QUARTER" };
  events?: IsInformedEvent[];
}

/** A scenario file: the scenario plus every intel item, instrument and rule it references. */
export interface ScenarioBundle {
  label: "ILLUSTRATIVE" | "USER";
  scenario: Scenario;
  intel_items: IntelItem[];
  instruments: Instrument[];
  rules: Rule[];
}

// ---------- Datacenter ----------

export type Segment = "COMMERCIAL" | "FEDERAL_NSS" | "DOD" | "MIXED";
export type OpticsForm = "PLUGGABLE" | "LPO" | "CPO";

export interface BuildWave {
  id: string;
  name: string;
  procurement_date: DateStr;
  energize_date: DateStr;
  customer_segment: Segment;
  optics_generation_gbps: number;
  optics_form: OpticsForm;
  quantities: Record<string, number>;
  site_country: ISO3;
  operator_hq_country: ISO3;
  tenants: string[];
  /** Overrides the default (site_country === "USA") for whether FCC equipment rules reach this wave. */
  fcc_jurisdiction?: boolean;
  /** Set by APPLY_VEU: assumed date a validated end-user authorization is granted. */
  veu_assumed_date?: DateStr;
  /** Set by levers that split a wave, so deltas roll up to the original. */
  parent_wave_id?: string;
  /** Extra one-off costs and schedule weeks added by levers. */
  lever_costs_usd?: number;
  lever_schedule_weeks?: number;
}

export interface Datacenter { label: "ILLUSTRATIVE" | "USER"; waves: BuildWave[] }

export type ComponentRole = "dsp" | "laser" | "tia_driver" | "substrate" | "pcb" | "bmc" | "asic" | "gpu" | "firmware" | "other";
export type Relationship = "assembles" | "supplies_component" | "owns" | "affiliate_of";

export interface BomLine {
  id: string;
  category: ProductCategory;
  sku: string;
  brand: string;
  generation_gbps: number | null;
  form_factor: string;
  fcc_auth: {
    fcc_id: string | null;
    grant_date: DateStr | null;
    conditional_approval_expiry: DateStr | null;
    conditional_approval_assumed?: boolean;
  };
  is_new_model: boolean;
  unit_cost_usd: number;
  lead_time_weeks: number;
  us_bom_value_share: { estimate: number; low: number; high: number; basis: string };
  alternates: string[];
}

export interface SupplierEdge {
  parent_node_id: string;
  child_node_id: string;
  relationship: Relationship;
  component_role: ComponentRole;
  logic_bearing: boolean;
  value_share_est: number | null;
  evidence_source_id: string;
  evidence_grade: string; // e.g. "B2"
}

export interface ListFlag { list: ListRef; date: DateStr }

export interface Entity {
  node_id: string;
  name: string;
  sayari_entity_id: string;
  country_of_incorporation: ISO3;
  production_country: ISO3;
  owner_chain_summary: string;
  list_flags: ListFlag[];
}

export interface EvidenceRow {
  source_id: string;
  url: string;
  publisher: string;
  date: DateStr;
  source_type: SourceType;
  reliability: Reliability;
  credibility: Credibility;
  note: string;
}

export type KycStatus = "VERIFIED" | "PARTIAL" | "UNVERIFIED";

export interface Tenant {
  id: string;
  build_wave_id: string;
  name: string;
  sayari_entity_id: string;
  ultimate_parent_id: string;
  ultimate_parent_hq: ISO3;
  allocated_gpus: number;
  monthly_gpu_hours: number;
  kyc_status: KycStatus;
  evidence_source_id: string;
  /** Set by OFFBOARD_TENANT. */
  offboard_date?: DateStr;
}

export interface OwnershipRecord {
  entity_node_id: string;
  parent_node_id: string;
  pct: number;
  from_date: DateStr;
  to_date: DateStr | null;
  evidence_source_id: string;
}

export interface PartsDataset {
  label: "ILLUSTRATIVE" | "USER";
  parts: Record<string, BomLine>;
  entities: Record<string, Entity>;
  edges: SupplierEdge[];
  evidence: Record<string, EvidenceRow>;
  tenants: Record<string, Tenant>;
  ownership: OwnershipRecord[];
  /** Optional wave quantity overrides from wave_quantities.csv. */
  wave_quantities?: { build_wave_id: string; part_id: string; qty: number }[];
}

// ---------- Results ----------

export type Status =
  | "CLEAR" | "WATCH" | "APPROVAL_EXPIRING" | "AT_RISK" | "LICENSE_REQUIRED" | "LICENSE_REQUIRED_TENANT"
  | "BLOCKED_DOD" | "BLOCKED_FEDERAL" | "BLOCKED_EXPORT" | "BLOCKED_NEW_AUTH";

export type Flag = "RECENT_OWNERSHIP_CHANGE" | "OUT_OF_JURISDICTION" | "DISCLOSURE_REQUIRED" | "ASSUMED_CARVE_OUT" | "OFFBOARDED";

export interface EvidenceGrade {
  reliability: Reliability;
  credibility: Credibility;
  legal_status: LegalStatus;
  no_primary_source: boolean;
  label: string; // "C3 / REPORTED / no primary source"
  confidence: number; // 0..1
}

export interface RuleHit {
  rule_id: string;
  scenario_id: string;
  instrument_id: string;
  context: Context;
  status: Status;
  path: string[];
  carve_out_applied: string | null;
  note: string | null;
  flags: Flag[];
  likelihood: number;
  evidence: EvidenceGrade;
  weighted_risk: number;
}

export interface Exposure {
  key: string;
  build_wave_id: string;
  row_kind: "LINE" | "TENANT";
  bom_line_id?: string;
  tenant_id?: string;
  date: DateStr;
  branches: Record<string, string>;
  status: Status;
  flags: Flag[];
  hits: RuleHit[];
  triggered_rules: string[];
  path: string[];
  carve_out_applied: string | null;
  weighted_risk: number;
  evidence_grade: string;
}
