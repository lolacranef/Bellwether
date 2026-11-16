// Turns loaded scenarios + selected branches into the list of rules the engine evaluates.
import type { Instrument, IsInformedEvent, Rule, ScenarioBundle, Source } from "../model/types";
import { instrumentSourceGrade, type RawGrade } from "./evidence";

export interface ScenarioSelection { bundle: ScenarioBundle; branch_id: string }

export interface ActiveRule {
  rule: Rule;
  scenario_id: string;
  branch_id: string;
  likelihood: number;
  instrument: Instrument;
  instGrade: RawGrade;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = structuredClone(value);
}

export function sourceIndex(selections: ScenarioSelection[]): Map<string, Source> {
  const m = new Map<string, Source>();
  for (const s of selections) for (const item of s.bundle.intel_items) for (const src of item.sources) m.set(src.id, src);
  return m;
}

export function resolveRules(selections: ScenarioSelection[], sources = sourceIndex(selections)): ActiveRule[] {
  const out: ActiveRule[] = [];
  for (const { bundle, branch_id } of selections) {
    const sc = bundle.scenario;
    const branch = sc.branches.find((b) => b.id === branch_id);
    if (!branch) throw new Error(`Scenario ${sc.id} has no branch "${branch_id}".`);
    const rules = new Map(bundle.rules.map((r) => [r.id, r]));
    const instruments = new Map(bundle.instruments.map((i) => [i.id, i]));
    for (const entry of sc.rules) {
      const base = rules.get(entry.rule_id);
      if (!base) throw new Error(`Scenario ${sc.id} references missing rule ${entry.rule_id}.`);
      const rule = structuredClone(base);
      let likelihood = entry.likelihood;
      for (const ov of branch.overrides.filter((o) => o.rule_id === entry.rule_id)) {
        if (ov.path === "likelihood") likelihood = Number(ov.value);
        else setPath(rule as unknown as Record<string, unknown>, ov.path, ov.value);
      }
      if (rule.enabled === false) continue;
      const instrument = instruments.get(rule.instrument_id);
      if (!instrument) throw new Error(`Rule ${rule.id} references missing instrument ${rule.instrument_id}.`);
      out.push({ rule, scenario_id: sc.id, branch_id, likelihood, instrument, instGrade: instrumentSourceGrade(instrument, sources) });
    }
  }
  return out;
}

export function scenarioEvents(selections: ScenarioSelection[]): (IsInformedEvent & { scenario_id: string })[] {
  return selections.flatMap((s) => (s.bundle.scenario.events ?? []).map((e) => ({ ...e, scenario_id: s.bundle.scenario.id })));
}
