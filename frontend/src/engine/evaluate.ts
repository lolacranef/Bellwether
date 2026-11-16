// Rule engine (SPECIFICATIONS §4.1, §7B.1). Pure: same inputs → same outputs.
import { DEFAULT_WEIGHTS, STATUS_ORDER, type WeightsConfig } from "../model/config";
import type {
  BomLine, BuildWave, CarveOut, Context, DateStr, EvidenceGrade, Exposure, Flag, PartsDataset, Rule, RuleHit, Status, Tenant,
} from "../model/types";
import { resolveRules, scenarioEvents, sourceIndex, type ActiveRule, type ScenarioSelection } from "./branches";
import { addMonths, addYears } from "./dates";
import { combineGrade } from "./evidence";
import { SupplyGraph } from "./graph";

export interface EvalInput {
  dataset: PartsDataset;
  waves: BuildWave[];
  scenarios: ScenarioSelection[];
  /** Cursor date. Omit or null to evaluate each wave at its own procurement date. */
  date?: DateStr | null;
  weights?: WeightsConfig;
}

const FCC_CONTEXTS: Context[] = ["NEW_FCC_AUTHORIZATION", "IMPORT_MARKETING", "FIRMWARE_UPDATES"];

const CONTEXT_STATUS: Record<Context, Status> = {
  NEW_FCC_AUTHORIZATION: "BLOCKED_NEW_AUTH",
  IMPORT_MARKETING: "BLOCKED_NEW_AUTH",
  FIRMWARE_UPDATES: "AT_RISK",
  FEDERAL_NSS_PROCUREMENT: "BLOCKED_FEDERAL",
  DOD_CONTRACTING: "BLOCKED_DOD",
  DOD_PROCUREMENT_GOODS: "BLOCKED_DOD",
  ALL: "BLOCKED_EXPORT",
  EXPORT_LICENSE_CHIPS: "LICENSE_REQUIRED",
  REMOTE_ACCESS_IAAS: "LICENSE_REQUIRED_TENANT",
  IS_INFORMED_NOTICE: "BLOCKED_EXPORT",
};

export const severityIndex = (s: Status) => STATUS_ORDER.indexOf(s);
const pct = (v: number) => `${Math.round(v * 100)}%`;

interface Ctx {
  data: PartsDataset;
  graph: SupplyGraph;
  rules: ActiveRule[];
  events: ReturnType<typeof scenarioEvents>;
  w: WeightsConfig;
  branches: Record<string, string>;
  concern: string[];
}

export function buildContext(input: EvalInput): Ctx {
  const w = input.weights ?? DEFAULT_WEIGHTS;
  const sources = sourceIndex(input.scenarios);
  const rules = resolveRules(input.scenarios, sources);
  const concern = [...new Set(rules.filter((r) => r.rule.applies_to_context.includes("REMOTE_ACCESS_IAAS"))
    .flatMap((r) => r.rule.target.hq_country_of_ultimate_parent ?? []))];
  return {
    data: input.dataset,
    graph: new SupplyGraph(input.dataset, w.affiliate_hops),
    rules,
    events: scenarioEvents(input.scenarios),
    w,
    branches: Object.fromEntries(input.scenarios.map((s) => [s.bundle.scenario.id, s.branch_id])),
    concern: concern.length ? concern : w.default_concern_countries,
  };
}

/** Effective quantities: wave_quantities.csv rows (if any) replace the wave's own BOM. */
export function effectiveWaves(input: EvalInput): BuildWave[] {
  const wq = input.dataset.wave_quantities ?? [];
  if (!wq.length) return input.waves;
  return input.waves.map((w) => {
    const rows = wq.filter((r) => r.build_wave_id === w.id);
    return rows.length ? { ...w, quantities: Object.fromEntries(rows.map((r) => [r.part_id, r.qty])) } : w;
  });
}

export function evaluate(input: EvalInput): Exposure[] {
  const ctx = buildContext(input);
  const out: Exposure[] = [];
  for (const wave of effectiveWaves(input)) {
    const date = input.date ?? wave.procurement_date;
    for (const [lineId, qty] of Object.entries(wave.quantities)) {
      const line = ctx.data.parts[lineId];
      if (!line || qty <= 0) continue;
      out.push(evalLine(ctx, wave, line, date));
    }
    for (const t of waveTenants(ctx.data, wave)) out.push(evalTenant(ctx, wave, t, date));
  }
  return out;
}

export function waveTenants(data: PartsDataset, wave: BuildWave): Tenant[] {
  const ids = new Set(wave.tenants);
  for (const t of Object.values(data.tenants)) if (t.build_wave_id === wave.id) ids.add(t.id);
  // A wave split by a lever keeps its tenants on the sub-wave that lists them.
  if (wave.parent_wave_id && !wave.tenants.length) return [];
  return [...ids].map((id) => data.tenants[id]).filter((t): t is Tenant => !!t);
}

// ---------------------------------------------------------------- lines

export function evalLine(ctx: Ctx, wave: BuildWave, line: BomLine, date: DateStr, inheritCpo = true): Exposure {
  const hits: RuleHit[] = [];
  for (const ar of ctx.rules) {
    for (const c of ar.rule.applies_to_context) {
      const h = evalRuleOnLine(ctx, ar, c, wave, line, date);
      if (h) hits.push(h);
    }
  }
  for (const ev of ctx.events) {
    if (ev.target_part_id !== line.id || date < ev.date) continue;
    const ar = ctx.rules.find((r) => r.rule.id === ev.rule_id);
    if (ar) hits.push(mkHit(ctx, ar, "IS_INFORMED_NOTICE", "BLOCKED_EXPORT", [line.id], null, `Is-informed notice from ${ev.date}: ${ev.note}`, [], []));
  }
  // CPO: optical engines sit inside the switch package, so the switch inherits optics exposure.
  if (inheritCpo && wave.optics_form === "CPO" && line.category === "SWITCH") {
    for (const optId of Object.keys(wave.quantities)) {
      const opt = ctx.data.parts[optId];
      if (!opt || opt.category !== "OPTICAL_TRANSCEIVER" || wave.quantities[optId] <= 0) continue;
      const sub = evalLine(ctx, wave, opt, date, false);
      for (const h of sub.hits) {
        if (h.status === "CLEAR") continue;
        hits.push({ ...h, path: [line.id, ...h.path], note: `Inherited from co-packaged optical engine ${opt.id}. ${h.note ?? ""}`.trim() });
      }
    }
  }
  return summarize(ctx, `${wave.id}|${line.id}`, wave, date, "LINE", hits, { bom_line_id: line.id });
}

function startDate(rule: Rule, c: Context): DateStr | null {
  const eff = rule.timing.context_effective_dates?.[c] ?? rule.timing.effective_date;
  if (!eff) return null;
  if (c === "FEDERAL_NSS_PROCUREMENT" && rule.timing.transition_years) return addYears(eff, rule.timing.transition_years);
  return eff;
}

function inScope(rule: Rule, line: BomLine): boolean {
  const cats = rule.scope.product_categories;
  if (cats && cats.length && !cats.includes(line.category)) return false;
  const min = rule.scope.min_generation_gbps;
  if (min != null && (line.generation_gbps == null || line.generation_gbps < min)) return false;
  return true;
}

const needsNewAuth = (line: BomLine, eff: DateStr) =>
  line.is_new_model || !line.fcc_auth.grant_date || line.fcc_auth.grant_date >= eff;

function evalRuleOnLine(ctx: Ctx, ar: ActiveRule, c: Context, wave: BuildWave, line: BomLine, date: DateStr): RuleHit | null {
  const r = ar.rule;
  if (c === "REMOTE_ACCESS_IAAS" || c === "IS_INFORMED_NOTICE") return null;
  const start = startDate(r, c);
  if (!start || date < start) return null;
  if (r.timing.sunset_or_expiry && date >= r.timing.sunset_or_expiry) return null;
  if (!inScope(r, line)) return null;
  const eff = r.timing.context_effective_dates?.[c] ?? r.timing.effective_date ?? start;

  if (c === "EXPORT_LICENSE_CHIPS") {
    if (r.effect === "DISCLOSURE") return null;
    const hq = wave.operator_hq_country;
    const lists = [...(r.target.smuggling_risk_hq_country ?? []), ...(r.target.hq_country_of_ultimate_parent ?? [])];
    if (!lists.includes(hq)) return null;
    if (wave.veu_assumed_date && date >= wave.veu_assumed_date) {
      return mkHit(ctx, ar, c, "CLEAR", [line.id], `Validated end-user authorization (assumed granted ${wave.veu_assumed_date})`,
        `Operator headquartered in ${hq}.`, [], ["ASSUMED_CARVE_OUT"]);
    }
    return mkHit(ctx, ar, c, "LICENSE_REQUIRED", [line.id], null, `Operator headquartered in ${hq}, which this rule lists.`, [], []);
  }

  if (c === "FEDERAL_NSS_PROCUREMENT" && !["FEDERAL_NSS", "MIXED"].includes(wave.customer_segment)) return null;
  if ((c === "DOD_CONTRACTING" || c === "DOD_PROCUREMENT_GOODS") && !["DOD", "MIXED"].includes(wave.customer_segment)) return null;
  if ((c === "NEW_FCC_AUTHORIZATION" || r.scope.new_models_only) && !needsNewAuth(line, eff)) return null;

  const m = matchTarget(ctx, r, line, date);
  if (!m) return null;

  let status = CONTEXT_STATUS[c];
  const flags: Flag[] = [];
  let carve: string | null = null;
  let note: string | null = m.note;
  const co = applyCarveOuts(ctx, r.carve_outs, line, date, eff);
  if (co) {
    status = co.status;
    carve = co.text;
    if (co.assumed) flags.push("ASSUMED_CARVE_OUT");
  }
  if (FCC_CONTEXTS.includes(c) && !(wave.fcc_jurisdiction ?? wave.site_country === "USA") && status !== "CLEAR") {
    flags.push("OUT_OF_JURISDICTION");
    note = `Would be ${status} at a US site. FCC equipment rules don't reach a site in ${wave.site_country}, but the supplier is restricted in the US market. ${note ?? ""}`.trim();
    status = "WATCH";
  }
  return mkHit(ctx, ar, c, status, [line.id, ...m.path], carve, note, m.grades, flags);
}

interface TargetMatch { path: string[]; grades: string[]; note: string | null }

function matchTarget(ctx: Ctx, r: Rule, line: BomLine, date: DateStr): TargetMatch | null {
  const t = r.target;
  const hasEntity = !!(t.entity_ids?.length || t.entity_list_refs?.length);
  const hasCountry = !!(t.production_country?.length || t.production_country_not_in?.length || t.producer_nationality?.length);
  if (!hasEntity && !hasCountry) return { path: [], grades: [], note: "Category-wide rule." };
  const nodes = ctx.graph.treeNodes(line.id, r.scope.component_trigger ?? "FINISHED_DEVICE");
  for (const n of nodes) {
    let path = n.path, grades = n.grades, note: string | null = null;
    if (hasEntity) {
      const em = entityMatch(ctx, r, n.node, date);
      if (!em) continue;
      path = [...path, ...em.path];
      grades = [...grades, ...em.grades];
      note = em.note;
    }
    if (hasCountry) {
      const cm = countryMatch(ctx, r, n.node);
      if (!cm) continue;
      path = [...path, ...cm.path];
      grades = [...grades, ...cm.grades];
      note = [note, cm.note].filter(Boolean).join(" ");
    }
    return { path, grades, note };
  }
  return null;
}

function entityMatch(ctx: Ctx, r: Rule, node: string, date: DateStr): TargetMatch | null {
  const t = r.target;
  const candidates = [{ node, path: [] as string[], grades: [] as string[] }, ...(t.include_affiliates ? ctx.graph.related(node) : [])];
  for (const c of candidates) {
    const via = c.path.length ? ` via ${ctx.graph.name(c.node)}` : "";
    if (t.entity_ids?.includes(c.node)) {
      return { path: c.path, grades: c.grades, note: `${ctx.graph.name(node)} matches named target${via}.` };
    }
    const flag = ctx.graph.entity(c.node)?.list_flags.find((f) => t.entity_list_refs?.includes(f.list) && f.date <= date);
    if (flag) return { path: c.path, grades: c.grades, note: `${ctx.graph.name(c.node)} is on ${flag.list} since ${flag.date}${via ? " (affiliate path)" : ""}.` };
  }
  return null;
}

function countryMatch(ctx: Ctx, r: Rule, node: string): TargetMatch | null {
  const t = r.target;
  const ent = ctx.graph.entity(node);
  if (!ent) return null;
  const mode = t.definition_mode ?? (t.producer_nationality?.length ? "PRODUCER" : "PRODUCTION_LOCATION");
  const pc = ent.production_country;
  const locationRule = !!(t.production_country?.length || t.production_country_not_in?.length);
  const byLocation = locationRule &&
    (!t.production_country?.length || t.production_country.includes(pc)) &&
    (!t.production_country_not_in?.length || !t.production_country_not_in.includes(pc));
  const prod = ctx.graph.producerNationality(node);
  const byProducer = !!t.producer_nationality?.includes(prod.country);
  const ok = mode === "PRODUCER" ? byProducer : mode === "PRODUCTION_LOCATION" ? byLocation
    : mode === "EITHER" ? byProducer || byLocation : byProducer && byLocation;
  if (!ok) return null;
  const usesProducer = mode !== "PRODUCTION_LOCATION" && byProducer;
  return {
    path: usesProducer ? prod.path : [],
    grades: usesProducer ? prod.grades : [],
    note: usesProducer ? `Producer nationality ${prod.country} (ultimate parent ${ctx.graph.name(prod.path.at(-1) ?? node)}).`
      : `Produced in ${pc}.`,
  };
}

function thresholdAt(co: CarveOut, date: DateStr): number {
  let v = co.threshold ?? 0;
  for (const s of (co.threshold_schedule ?? []).slice().sort((a, b) => a.from.localeCompare(b.from))) if (s.from <= date) v = s.value;
  return v;
}

interface CarveResult { status: Status; text: string; assumed: boolean }

function applyCarveOuts(ctx: Ctx, carveOuts: CarveOut[], line: BomLine, date: DateStr, eff: DateStr): CarveResult | null {
  const partial: CarveResult[] = [];
  for (const co of carveOuts) {
    switch (co.type) {
      case "EXISTING_AUTHORIZATION": {
        const g = line.fcc_auth.grant_date;
        if (!line.is_new_model && g && g < eff) return { status: "CLEAR", text: `Existing authorization (granted ${g})`, assumed: false };
        break;
      }
      case "US_BOM_VALUE_MIN":
      case "DOMESTIC_END_PRODUCT": {
        if (co.type === "DOMESTIC_END_PRODUCT") {
          const asm = ctx.graph.assembler(line.id);
          if (ctx.graph.entity(asm ?? "")?.production_country !== "USA") break;
        }
        const thr = thresholdAt(co, date);
        const s = line.us_bom_value_share;
        const label = co.type === "US_BOM_VALUE_MIN" ? "US BOM value" : "Domestic end product: US content";
        const range = `${pct(s.estimate)} (range ${pct(s.low)}–${pct(s.high)})`;
        if (s.low >= thr) return { status: "CLEAR", text: `${label} ${range} ≥ ${pct(thr)}`, assumed: false };
        if (s.estimate >= thr) partial.push({ status: "WATCH", text: `${label} ${range}: estimate meets ${pct(thr)} but the low end doesn't`, assumed: false });
        break;
      }
      case "CONDITIONAL_APPROVAL": {
        const exp = line.fcc_auth.conditional_approval_expiry;
        if (!exp) break;
        const assumed = !!line.fcc_auth.conditional_approval_assumed;
        const tag = assumed ? " (assumed)" : "";
        const warnFrom = addMonths(exp, -ctx.w.approval_warning_months);
        if (date < warnFrom) return { status: "CLEAR", text: `Conditional Approval until ${exp}${tag}`, assumed };
        if (date < exp) partial.push({ status: "APPROVAL_EXPIRING", text: `Conditional Approval expires ${exp}${tag}`, assumed });
        break;
      }
      case "WAIVER":
        break; // noted on the rule; a waiver is never assumed by the engine
    }
  }
  if (!partial.length) return null;
  return partial.reduce((a, b) => (severityIndex(b.status) < severityIndex(a.status) ? b : a));
}

// ---------------------------------------------------------------- tenants

function evalTenant(ctx: Ctx, wave: BuildWave, t: Tenant, date: DateStr): Exposure {
  const hits: RuleHit[] = [];
  const extraFlags: Flag[] = [];
  const tenantGrade = t.evidence_source_id ? gradeOfEvidence(ctx, t.evidence_source_id) : "F6";

  if (t.offboard_date && date >= t.offboard_date) {
    return summarize(ctx, `${wave.id}|tenant:${t.id}`, wave, date, "TENANT", [], { tenant_id: t.id }, ["OFFBOARDED"]);
  }

  for (const ar of ctx.rules) {
    const r = ar.rule;
    for (const c of r.applies_to_context) {
      const start = startDate(r, c);
      if (!start || date < start) continue;
      if (r.timing.sunset_or_expiry && date >= r.timing.sunset_or_expiry) continue;

      if (c === "REMOTE_ACCESS_IAAS") {
        if (t.kyc_status === "UNVERIFIED") {
          hits.push(mkHit(ctx, ar, c, "WATCH", [t.id], null,
            "KYC unverified: the ultimate parent can't be confirmed, so this tenant can't be cleared.", [tenantGrade], []));
          continue;
        }
        const hq = parentHq(ctx, t, r, date);
        const concern = hq.countries.filter((x) => r.target.hq_country_of_ultimate_parent?.includes(x));
        if (!concern.length) continue;
        const vt = r.scope.volume_threshold;
        const usage = !vt ? Infinity : vt.metric === "GPU_COUNT" ? t.allocated_gpus : t.monthly_gpu_hours;
        const usageText = vt ? `${usage.toLocaleString("en-US")} ${vt.unit}` : "";
        const thrText = vt ? `${vt.value.toLocaleString("en-US")}${vt.confirmed ? "" : " (placeholder; real value TBD)"}` : "";
        if (!vt || usage > vt.value) {
          hits.push(mkHit(ctx, ar, c, "LICENSE_REQUIRED_TENANT", [t.id, ...hq.path], null,
            `Ultimate parent HQ ${concern.join("/")}; usage ${usageText} exceeds the threshold of ${thrText}.`, [tenantGrade], []));
        } else if (!vt.confirmed) {
          hits.push(mkHit(ctx, ar, c, "WATCH", [t.id, ...hq.path], null,
            `Ultimate parent HQ ${concern.join("/")}; usage ${usageText} is below the threshold of ${thrText}, which isn't confirmed.`, [tenantGrade], []));
        } else {
          hits.push(mkHit(ctx, ar, c, "CLEAR", [t.id, ...hq.path], `Below the significant-volume threshold (${thrText})`,
            `Ultimate parent HQ ${concern.join("/")}.`, [tenantGrade], []));
        }
      } else if (c === "EXPORT_LICENSE_CHIPS" && r.effect === "DISCLOSURE") {
        const hq = parentHq(ctx, t, r, date);
        if (hq.countries.some((x) => r.target.hq_country_of_ultimate_parent?.includes(x))) {
          hits.push(mkHit(ctx, ar, c, "CLEAR", [t.id, ...hq.path], null,
            "Any license application for this wave must disclose this tenant as an IaaS remote end user.", [tenantGrade], ["DISCLOSURE_REQUIRED"]));
        }
      } else if (c === "ALL") {
        const m = tenantEntityMatch(ctx, r, t, date);
        if (m) hits.push(mkHit(ctx, ar, c, "BLOCKED_EXPORT", [t.id, ...m.path], null, m.note, [tenantGrade, ...m.grades], []));
      }
    }
  }
  for (const ev of ctx.events) {
    if (ev.target_tenant_id !== t.id || date < ev.date) continue;
    const ar = ctx.rules.find((r) => r.rule.id === ev.rule_id);
    if (ar) hits.push(mkHit(ctx, ar, "IS_INFORMED_NOTICE", "BLOCKED_EXPORT", [t.id], null, `Is-informed notice from ${ev.date}: ${ev.note}`, [], []));
  }

  // Analyst signal only: never changes the legal status.
  const windowStart = addMonths(date, -ctx.w.ownership_lookback_months);
  const recent = ctx.data.ownership.some((o) =>
    o.entity_node_id === t.id && o.to_date && o.to_date >= windowStart && o.from_date <= date &&
    ctx.concern.includes(ctx.data.entities[o.parent_node_id]?.country_of_incorporation ?? ""));
  if (recent) extraFlags.push("RECENT_OWNERSHIP_CHANGE");

  return summarize(ctx, `${wave.id}|tenant:${t.id}`, wave, date, "TENANT", hits, { tenant_id: t.id }, extraFlags);
}

function currentOwners(ctx: Ctx, nodeId: string, date: DateStr) {
  return ctx.data.ownership.filter((o) => o.entity_node_id === nodeId && o.from_date <= date && (!o.to_date || o.to_date >= date));
}

function parentHq(ctx: Ctx, t: Tenant, r: Rule, date: DateStr): { countries: string[]; path: string[] } {
  const test = r.target.ownership_test ?? "ULTIMATE_PARENT";
  if (test === "ULTIMATE_PARENT") {
    const hq = t.ultimate_parent_hq || ctx.data.entities[t.ultimate_parent_id]?.country_of_incorporation || "";
    return { countries: hq ? [hq] : [], path: t.ultimate_parent_id ? [t.ultimate_parent_id] : [] };
  }
  const owners = currentOwners(ctx, t.id, date).sort((a, b) => b.pct - a.pct);
  const picked = test === "DIRECT_PARENT" ? owners.slice(0, 1) : owners.filter((o) => o.pct >= (r.target.ownership_pct_threshold ?? 0));
  return {
    countries: picked.map((o) => ctx.data.entities[o.parent_node_id]?.country_of_incorporation ?? "").filter(Boolean),
    path: picked.map((o) => o.parent_node_id),
  };
}

function tenantEntityMatch(ctx: Ctx, r: Rule, t: Tenant, date: DateStr): TargetMatch | null {
  const starts = [t.id, t.ultimate_parent_id, ...currentOwners(ctx, t.id, date).map((o) => o.parent_node_id)].filter(Boolean);
  for (const s of [...new Set(starts)]) {
    const m = entityMatch(ctx, r, s, date);
    if (m) return { path: s === t.id ? m.path : [s, ...m.path], grades: m.grades, note: m.note };
  }
  return null;
}

function gradeOfEvidence(ctx: Ctx, id: string): string {
  const e = ctx.data.evidence[id];
  return e ? `${e.reliability}${e.credibility}` : "F6";
}

// ---------------------------------------------------------------- shared

function mkHit(ctx: Ctx, ar: ActiveRule, c: Context, status: Status, path: string[], carve: string | null,
  note: string | null, pathGrades: string[], flags: Flag[]): RuleHit {
  const evidence: EvidenceGrade = combineGrade(ar.instrument, ar.instGrade, pathGrades, ctx.w);
  return {
    rule_id: ar.rule.id, scenario_id: ar.scenario_id, instrument_id: ar.instrument.id, context: c, status, path,
    carve_out_applied: carve, note, flags, likelihood: ar.likelihood, evidence,
    weighted_risk: ar.likelihood * ctx.w.severity[status] * evidence.confidence,
  };
}

function summarize(ctx: Ctx, key: string, wave: BuildWave, date: DateStr, kind: "LINE" | "TENANT", hits: RuleHit[],
  ids: { bom_line_id?: string; tenant_id?: string }, extraFlags: Flag[] = []): Exposure {
  let status: Status = "CLEAR";
  for (const h of hits) if (severityIndex(h.status) > severityIndex(status)) status = h.status;
  const top = hits.filter((h) => h.status === status);
  // Among equally severe hits, report the weakest evidence: a red badge never hides a soft source.
  const lead = top.reduce<RuleHit | null>((a, b) => (!a || b.evidence.confidence < a.evidence.confidence ? b : a), null);
  const flags = [...new Set([...hits.flatMap((h) => h.flags), ...extraFlags])];
  return {
    key, build_wave_id: wave.id, row_kind: kind, ...ids, date, branches: ctx.branches, status, flags, hits,
    triggered_rules: [...new Set(hits.filter((h) => h.status !== "CLEAR").map((h) => h.rule_id))],
    path: lead?.path ?? [],
    carve_out_applied: lead?.carve_out_applied ?? hits.find((h) => h.carve_out_applied)?.carve_out_applied ?? null,
    weighted_risk: hits.reduce((m, h) => Math.max(m, h.weighted_risk), 0),
    evidence_grade: lead?.evidence.label ?? "",
  };
}

