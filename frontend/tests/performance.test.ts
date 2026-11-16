// §8: ≤ 2 s to re-evaluate 50 BOM lines × 6 waves × 4 branches × 48 months.
import { expect, it } from "vitest";
import { OPTICS_SCENARIO, REMOTE_ACCESS_SCENARIO } from "../src/data/seed";
import { monthRange } from "../src/engine/dates";
import { evaluate } from "../src/engine/evaluate";
import type { BomLine, SupplierEdge } from "../src/model/types";
import { seed } from "./helpers";

it("meets the performance budget", () => {
  const dataset = structuredClone(seed.dataset);
  const base = Object.values(dataset.parts);
  const extra: BomLine[] = [];
  const edges: SupplierEdge[] = [];
  for (let i = 0; extra.length + base.length < 50; i++) {
    const p = base[i % base.length];
    const id = `${p.id}#${i}`;
    extra.push({ ...p, id });
    edges.push(...dataset.edges.filter((e) => e.parent_node_id === p.id).map((e) => ({ ...e, parent_node_id: id })));
  }
  for (const p of extra) dataset.parts[p.id] = p;
  dataset.edges.push(...edges);
  const allLines = Object.fromEntries(Object.keys(dataset.parts).map((id) => [id, 10]));
  const waves = seed.datacenter.waves.map((w) => ({ ...w, quantities: allLines }));
  const months = monthRange("2027-01-01", "2030-12-01");
  expect(months.length).toBe(48);
  const t0 = performance.now();
  let cells = 0;
  for (const branch of ["as-reported", "delayed", "broadened", "dropped"]) {
    for (const date of months) {
      cells += evaluate({ dataset, waves, date, scenarios: [{ bundle: OPTICS_SCENARIO, branch_id: branch }, { bundle: REMOTE_ACCESS_SCENARIO, branch_id: "as-issued" }] }).length;
    }
  }
  const ms = performance.now() - t0;
  expect(cells).toBeGreaterThanOrEqual(50 * 6 * 4 * 48);
  expect(ms).toBeLessThan(2000);
});
