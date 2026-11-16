// Student data import contract (SPECIFICATIONS §5, §7B.5).
// Takes the CSV texts, validates them, and returns a PartsDataset plus a summary.
import { parseCsv } from "./csv";
import type {
  BomLine, ComponentRole, Credibility, Entity, EvidenceRow, KycStatus, ListFlag, ListRef, OwnershipRecord,
  PartsDataset, ProductCategory, Relationship, Reliability, SourceType, SupplierEdge, Tenant,
} from "../model/types";

export interface ImportFiles {
  "parts.csv": string;
  "supplier_edges.csv": string;
  "entities.csv": string;
  "evidence.csv": string;
  "tenants.csv"?: string;
  "ownership_history.csv"?: string;
  "wave_quantities.csv"?: string;
}

export interface ImportIssue { level: "error" | "warning"; file: string; row: number | null; message: string }

export interface ImportSummary {
  parts_loaded: number;
  nodes: number;
  edges: number;
  tenants: number;
  unresolved_owners: string[];
  lines_without_evidence: string[];
  errors: number;
  warnings: number;
}

export interface ImportResult {
  ok: boolean;
  dataset: PartsDataset | null;
  issues: ImportIssue[];
  summary: ImportSummary;
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  "parts.csv": ["part_id", "sku", "brand", "category", "generation_gbps", "form_factor", "fcc_id", "grant_date", "is_new_model",
    "unit_cost_usd", "lead_time_weeks", "us_value_est", "us_value_low", "us_value_high", "us_value_basis"],
  "supplier_edges.csv": ["parent_node_id", "child_node_id", "relationship", "component_role", "logic_bearing", "value_share_est",
    "evidence_source_id", "evidence_grade"],
  "entities.csv": ["node_id", "name", "sayari_entity_id", "country_of_incorporation", "production_country", "owner_chain_summary",
    "list_flags", "list_flag_dates"],
  "evidence.csv": ["source_id", "url", "publisher", "date", "source_type", "reliability", "credibility", "note"],
  "tenants.csv": ["tenant_id", "build_wave_id", "name", "sayari_entity_id", "ultimate_parent_id", "ultimate_parent_hq",
    "allocated_gpus", "monthly_gpu_hours", "kyc_status", "evidence_source_id"],
  "ownership_history.csv": ["entity_node_id", "parent_node_id", "pct", "from_date", "to_date", "evidence_source_id"],
  "wave_quantities.csv": ["build_wave_id", "part_id", "qty"],
};

const LIST_MAP: Record<string, ListRef> = {
  covered_list: "COVERED_LIST", "1260h": "LIST_1260H", entity_list: "ENTITY_LIST", sdn: "SDN", ns_cmic: "NS_CMIC",
};
const CATEGORIES: ProductCategory[] = ["OPTICAL_TRANSCEIVER", "SWITCH", "SERVER", "ROUTER_CONSUMER", "ROUTER_ENTERPRISE",
  "POWER_INVERTER_CONNECTED", "NIC", "BMC", "PSU", "OTHER"];
const RELATIONSHIPS: Relationship[] = ["assembles", "supplies_component", "owns", "affiliate_of"];
const ROLES: ComponentRole[] = ["dsp", "laser", "tia_driver", "substrate", "pcb", "bmc", "asic", "gpu", "firmware", "other"];
const SOURCE_TYPES: SourceType[] = ["PRIMARY", "LEGAL_ANALYSIS", "PRESS", "ANALYST_NOTE", "RUMOR"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Sayari entity IDs are 22-character URL-safe base64 strings.
const SAYARI_RE = /^[A-Za-z0-9_-]{22}$/;

const bool = (s: string) => /^(true|yes|1)$/i.test(s);
const num = (s: string) => (s === "" ? NaN : Number(s));
const optDate = (s: string) => (s === "" ? null : s);

export function importDataset(files: ImportFiles, label: "ILLUSTRATIVE" | "USER" = "USER"): ImportResult {
  const issues: ImportIssue[] = [];
  const err = (file: string, row: number | null, message: string) => issues.push({ level: "error", file, row, message });
  const warn = (file: string, row: number | null, message: string) => issues.push({ level: "warning", file, row, message });

  const tables: Record<string, Record<string, string>[]> = {};
  for (const [name, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const text = files[name as keyof ImportFiles];
    if (text === undefined) {
      if (["tenants.csv", "ownership_history.csv", "wave_quantities.csv"].includes(name)) { tables[name] = []; continue; }
      err(name, null, "File is missing.");
      tables[name] = [];
      continue;
    }
    const rows = parseCsv(text);
    const header = rows.length ? Object.keys(rows[0]) : text.split(/\r?\n/)[0].split(",").map((h) => h.trim());
    const missing = cols.filter((c) => !header.includes(c));
    if (missing.length) err(name, null, `Missing columns: ${missing.join(", ")}.`);
    tables[name] = rows;
  }

  // ---- evidence ----
  const evidence: Record<string, EvidenceRow> = {};
  tables["evidence.csv"].forEach((r, i) => {
    const row = i + 2;
    if (!r.source_id) return err("evidence.csv", row, "source_id is empty.");
    if (!SOURCE_TYPES.includes(r.source_type as SourceType)) err("evidence.csv", row, `Unknown source_type "${r.source_type}".`);
    if (!/^[A-F]$/.test(r.reliability)) err("evidence.csv", row, `Reliability must be A–F, got "${r.reliability}".`);
    if (!/^[1-6]$/.test(r.credibility)) err("evidence.csv", row, `Credibility must be 1–6, got "${r.credibility}".`);
    evidence[r.source_id] = {
      source_id: r.source_id, url: r.url, publisher: r.publisher, date: r.date,
      source_type: r.source_type as SourceType, reliability: r.reliability as Reliability,
      credibility: Number(r.credibility) as Credibility, note: r.note,
    };
  });

  // ---- entities ----
  const entities: Record<string, Entity> = {};
  tables["entities.csv"].forEach((r, i) => {
    const row = i + 2;
    if (!r.node_id) return err("entities.csv", row, "node_id is empty.");
    const flags = r.list_flags ? r.list_flags.split("|").map((s) => s.trim()).filter(Boolean) : [];
    const dates = r.list_flag_dates ? r.list_flag_dates.split("|").map((s) => s.trim()).filter(Boolean) : [];
    const list_flags: ListFlag[] = [];
    if (flags.length !== dates.length) {
      err("entities.csv", row, `${r.node_id}: ${flags.length} list flag(s) but ${dates.length} date(s). Every flag needs a date.`);
    }
    flags.forEach((f, j) => {
      const list = LIST_MAP[f.toLowerCase()];
      if (!list) return err("entities.csv", row, `${r.node_id}: unknown list flag "${f}".`);
      const d = dates[j];
      if (!d || !DATE_RE.test(d)) return err("entities.csv", row, `${r.node_id}: list flag "${f}" has no valid date.`);
      list_flags.push({ list, date: d });
    });
    if (!r.sayari_entity_id) warn("entities.csv", row, `${r.node_id}: no Sayari entity ID.`);
    else if (!SAYARI_RE.test(r.sayari_entity_id)) warn("entities.csv", row, `${r.node_id}: Sayari ID "${r.sayari_entity_id}" doesn't look like a Sayari entity ID.`);
    entities[r.node_id] = {
      node_id: r.node_id, name: r.name, sayari_entity_id: r.sayari_entity_id,
      country_of_incorporation: r.country_of_incorporation, production_country: r.production_country,
      owner_chain_summary: r.owner_chain_summary, list_flags,
    };
  });

  // ---- parts ----
  const parts: Record<string, BomLine> = {};
  tables["parts.csv"].forEach((r, i) => {
    const row = i + 2;
    if (!r.part_id) return err("parts.csv", row, "part_id is empty.");
    if (!CATEGORIES.includes(r.category as ProductCategory)) err("parts.csv", row, `${r.part_id}: unknown category "${r.category}".`);
    const est = num(r.us_value_est), low = num(r.us_value_low), high = num(r.us_value_high);
    if ([est, low, high].some((v) => Number.isNaN(v) || v < 0 || v > 1)) {
      err("parts.csv", row, `${r.part_id}: US value shares must be numbers between 0 and 1.`);
    } else if (!(low <= est && est <= high)) {
      err("parts.csv", row, `${r.part_id}: needs us_value_low ≤ us_value_est ≤ us_value_high (got ${low}, ${est}, ${high}).`);
    }
    for (const d of ["grant_date", "conditional_approval_expiry"]) {
      if (r[d] && !DATE_RE.test(r[d])) err("parts.csv", row, `${r.part_id}: ${d} must be YYYY-MM-DD.`);
    }
    parts[r.part_id] = {
      id: r.part_id, category: r.category as ProductCategory, sku: r.sku, brand: r.brand,
      generation_gbps: r.generation_gbps === "" ? null : Number(r.generation_gbps),
      form_factor: r.form_factor,
      fcc_auth: {
        fcc_id: r.fcc_id || null, grant_date: optDate(r.grant_date),
        conditional_approval_expiry: optDate(r.conditional_approval_expiry ?? ""),
        conditional_approval_assumed: bool(r.conditional_approval_assumed ?? ""),
      },
      is_new_model: bool(r.is_new_model),
      unit_cost_usd: num(r.unit_cost_usd), lead_time_weeks: num(r.lead_time_weeks),
      us_bom_value_share: { estimate: est, low, high, basis: r.us_value_basis },
      alternates: (r.alternates ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    };
  });

  // ---- edges ----
  const edges: SupplierEdge[] = [];
  const knownNode = (id: string) => id in entities || id in parts;
  tables["supplier_edges.csv"].forEach((r, i) => {
    const row = i + 2;
    const rel = r.relationship as Relationship;
    if (!RELATIONSHIPS.includes(rel)) err("supplier_edges.csv", row, `Unknown relationship "${r.relationship}".`);
    const role = (r.component_role || "other") as ComponentRole;
    if (!ROLES.includes(role)) err("supplier_edges.csv", row, `Unknown component_role "${r.component_role}".`);
    const lb = bool(r.logic_bearing);
    if (!knownNode(r.parent_node_id)) err("supplier_edges.csv", row, `Parent "${r.parent_node_id}" is neither a part nor an entity.`);
    if (!(r.child_node_id in entities)) {
      if (lb) err("supplier_edges.csv", row, `Logic-bearing node "${r.child_node_id}" has no row in entities.csv.`);
      else err("supplier_edges.csv", row, `Child "${r.child_node_id}" has no row in entities.csv.`);
    }
    if (!r.evidence_source_id || !(r.evidence_source_id in evidence)) {
      err("supplier_edges.csv", row, `Edge ${r.parent_node_id} → ${r.child_node_id} has no matching row in evidence.csv ("${r.evidence_source_id}").`);
    }
    if (r.evidence_grade && !/^[A-F][1-6]$/.test(r.evidence_grade)) {
      err("supplier_edges.csv", row, `evidence_grade must look like "B2", got "${r.evidence_grade}".`);
    }
    edges.push({
      parent_node_id: r.parent_node_id, child_node_id: r.child_node_id, relationship: rel, component_role: role,
      logic_bearing: lb, value_share_est: r.value_share_est === "" ? null : Number(r.value_share_est),
      evidence_source_id: r.evidence_source_id, evidence_grade: r.evidence_grade || "F6",
    });
  });

  // ---- tenants ----
  const tenants: Record<string, Tenant> = {};
  tables["tenants.csv"].forEach((r, i) => {
    const row = i + 2;
    if (!r.tenant_id) return err("tenants.csv", row, "tenant_id is empty.");
    if (!["VERIFIED", "PARTIAL", "UNVERIFIED"].includes(r.kyc_status)) err("tenants.csv", row, `${r.tenant_id}: kyc_status must be VERIFIED, PARTIAL or UNVERIFIED.`);
    if (r.evidence_source_id && !(r.evidence_source_id in evidence)) err("tenants.csv", row, `${r.tenant_id}: evidence "${r.evidence_source_id}" not in evidence.csv.`);
    if (r.ultimate_parent_id && !(r.ultimate_parent_id in entities)) warn("tenants.csv", row, `${r.tenant_id}: ultimate parent "${r.ultimate_parent_id}" has no entity row.`);
    if (!r.sayari_entity_id) warn("tenants.csv", row, `${r.tenant_id}: no Sayari entity ID.`);
    tenants[r.tenant_id] = {
      id: r.tenant_id, build_wave_id: r.build_wave_id, name: r.name, sayari_entity_id: r.sayari_entity_id,
      ultimate_parent_id: r.ultimate_parent_id, ultimate_parent_hq: r.ultimate_parent_hq,
      allocated_gpus: num(r.allocated_gpus) || 0, monthly_gpu_hours: num(r.monthly_gpu_hours) || 0,
      kyc_status: r.kyc_status as KycStatus, evidence_source_id: r.evidence_source_id,
    };
  });

  // ---- ownership history ----
  const ownership: OwnershipRecord[] = [];
  tables["ownership_history.csv"].forEach((r, i) => {
    const row = i + 2;
    if (!(r.entity_node_id in entities) && !(r.entity_node_id in tenants)) err("ownership_history.csv", row, `"${r.entity_node_id}" is not an entity or tenant.`);
    if (!(r.parent_node_id in entities)) err("ownership_history.csv", row, `Parent "${r.parent_node_id}" has no entity row.`);
    if (!DATE_RE.test(r.from_date) || (r.to_date && !DATE_RE.test(r.to_date))) err("ownership_history.csv", row, "Dates must be YYYY-MM-DD.");
    if (r.evidence_source_id && !(r.evidence_source_id in evidence)) err("ownership_history.csv", row, `Evidence "${r.evidence_source_id}" not in evidence.csv.`);
    ownership.push({
      entity_node_id: r.entity_node_id, parent_node_id: r.parent_node_id, pct: num(r.pct) || 0,
      from_date: r.from_date, to_date: optDate(r.to_date), evidence_source_id: r.evidence_source_id,
    });
  });

  const wave_quantities = tables["wave_quantities.csv"].map((r, i) => {
    if (!(r.part_id in parts)) err("wave_quantities.csv", i + 2, `Part "${r.part_id}" is not in parts.csv.`);
    return { build_wave_id: r.build_wave_id, part_id: r.part_id, qty: num(r.qty) || 0 };
  });

  // ---- summary ----
  const ownedChildren = new Set(edges.filter((e) => e.relationship === "owns").map((e) => e.child_node_id));
  const unresolved_owners = Object.values(entities)
    .filter((e) => !ownedChildren.has(e.node_id) && /^(|unknown|unresolved)$/i.test(e.owner_chain_summary.trim()))
    .map((e) => e.node_id);
  const partsWithEvidence = new Set(edges.filter((e) => e.parent_node_id in parts && e.evidence_source_id in evidence).map((e) => e.parent_node_id));
  const lines_without_evidence = Object.keys(parts).filter((p) => !partsWithEvidence.has(p));
  lines_without_evidence.forEach((p) => warn("parts.csv", null, `${p}: no supplier edge with evidence.`));

  const errors = issues.filter((i) => i.level === "error").length;
  const summary: ImportSummary = {
    parts_loaded: Object.keys(parts).length, nodes: Object.keys(entities).length, edges: edges.length,
    tenants: Object.keys(tenants).length, unresolved_owners, lines_without_evidence,
    errors, warnings: issues.length - errors,
  };
  const ok = errors === 0;
  return {
    ok,
    dataset: ok ? { label, parts, entities, edges, evidence, tenants, ownership, wave_quantities } : null,
    issues,
    summary,
  };
}

export function formatSummary(s: ImportSummary): string {
  return [
    `Parts loaded: ${s.parts_loaded}`,
    `Nodes: ${s.nodes} (edges: ${s.edges}, tenants: ${s.tenants})`,
    `Unresolved owners: ${s.unresolved_owners.length ? s.unresolved_owners.join(", ") : "none"}`,
    `Lines with no evidence: ${s.lines_without_evidence.length ? s.lines_without_evidence.join(", ") : "none"}`,
    `Errors: ${s.errors} · Warnings: ${s.warnings}`,
  ].join("\n");
}
