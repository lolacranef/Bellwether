// Seed data, labeled ILLUSTRATIVE (SPECIFICATIONS §5, §7, §7B). Same file format students upload.
import parts from "./parts.csv?raw";
import edges from "./supplier_edges.csv?raw";
import entities from "./entities.csv?raw";
import evidence from "./evidence.csv?raw";
import tenants from "./tenants.csv?raw";
import ownership from "./ownership_history.csv?raw";
import datacenter from "./datacenter.json";
import optics from "./scenarios/optics-covered-list.json";
import remote from "./scenarios/remote-access.json";
import { importDataset, type ImportFiles } from "../../import/importer";
import type { Datacenter, ScenarioBundle } from "../../model/types";

export const SEED_FILES: ImportFiles = {
  "parts.csv": parts,
  "supplier_edges.csv": edges,
  "entities.csv": entities,
  "evidence.csv": evidence,
  "tenants.csv": tenants,
  "ownership_history.csv": ownership,
};

export const SEED_DATACENTER = datacenter as unknown as Datacenter;
export const OPTICS_SCENARIO = optics as unknown as ScenarioBundle;
export const REMOTE_ACCESS_SCENARIO = remote as unknown as ScenarioBundle;
export const SEED_SCENARIOS = [OPTICS_SCENARIO, REMOTE_ACCESS_SCENARIO];

export function loadSeed() {
  const result = importDataset(SEED_FILES, "ILLUSTRATIVE");
  if (!result.dataset) {
    throw new Error(`Seed data failed validation:\n${result.issues.filter((i) => i.level === "error").map((i) => `${i.file}:${i.row ?? "-"} ${i.message}`).join("\n")}`);
  }
  return { dataset: result.dataset, summary: result.summary, issues: result.issues, datacenter: SEED_DATACENTER, scenarios: SEED_SCENARIOS };
}
