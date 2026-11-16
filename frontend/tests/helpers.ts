import { loadSeed, OPTICS_SCENARIO, REMOTE_ACCESS_SCENARIO } from "../src/data/seed";
import { evaluate, type EvalInput } from "../src/engine/evaluate";
import type { Exposure } from "../src/model/types";

export const seed = loadSeed();

export function input(opts: { optics?: string | null; remote?: string | null; date?: string | null } = {}): EvalInput {
  const scenarios = [];
  if (opts.optics !== null) scenarios.push({ bundle: OPTICS_SCENARIO, branch_id: opts.optics ?? "as-reported" });
  if (opts.remote) scenarios.push({ bundle: REMOTE_ACCESS_SCENARIO, branch_id: opts.remote });
  return { dataset: seed.dataset, waves: seed.datacenter.waves, scenarios, date: opts.date ?? null };
}

export function cell(ex: Exposure[], wave: string, row: string): Exposure {
  const key = /^T\d+$/.test(row) ? `${wave}|tenant:${row}` : `${wave}|${row}`;
  const e = ex.find((x) => x.key === key);
  if (!e) throw new Error(`No cell ${key}. Have: ${ex.map((x) => x.key).join(", ")}`);
  return e;
}

export const run = (opts: Parameters<typeof input>[0] = {}) => evaluate(input(opts));
