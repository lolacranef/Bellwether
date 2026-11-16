// Acceptance checks for seed scenario 1 (SPECIFICATIONS §7.4).
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/engine/evaluate";
import { applyLevers, compareLevers } from "../src/engine/levers";
import { cell, input, run } from "./helpers";

describe("§7.4.1 As reported", () => {
  const ex = run();
  it("blocks the China-produced supplier's 3.2T modules in W3 and W4, graded REPORTED / no primary source", () => {
    for (const w of ["W3", "W4"]) {
      const c = cell(ex, w, "XCVR-A-3200");
      expect(c.status).toBe("BLOCKED_NEW_AUTH");
      expect(c.triggered_rules).toContain("R2");
      expect(c.evidence_grade).toMatch(/REPORTED \/ no primary source$/);
    }
  });
  it("leaves W1 and W2 transceivers clear of the new-authorization rules", () => {
    for (const [w, line] of [["W1", "XCVR-A-800"], ["W1", "XCVR-C-800"], ["W2", "XCVR-A-1600"], ["W2", "XCVR-D-1600"]]) {
      const c = cell(ex, w, line);
      expect(c.hits.filter((h) => h.status === "BLOCKED_NEW_AUTH")).toEqual([]);
      expect(c.triggered_rules).not.toContain("R2");
    }
    expect(cell(ex, "W1", "XCVR-A-800").status).toBe("CLEAR");
    expect(cell(ex, "W2", "XCVR-D-1600").status).toBe("CLEAR");
  });
  it("leaves the US-owned suppliers clear in W3", () => {
    expect(cell(ex, "W3", "XCVR-C-3200").status).toBe("CLEAR");
  });
});

describe("§7.4.2 RAISE_US_CONTENT", () => {
  it("moves W3 to WATCH when the US-content range straddles 65%", () => {
    const { input: after } = applyLevers(input(), [{ kind: "RAISE_US_CONTENT", line_id: "XCVR-A-3200", wave_id: "W3" }]);
    const line = after.dataset.parts["XCVR-A-3200+USC"];
    expect(line.us_bom_value_share.estimate).toBeGreaterThanOrEqual(0.65);
    expect(line.us_bom_value_share.low).toBeLessThan(0.65);
    const c = cell(evaluate(after), "W3", "XCVR-A-3200+USC");
    expect(c.status).toBe("WATCH");
    expect(c.carve_out_applied).toMatch(/low end doesn't/);
  });
  it("moves to CLEAR when the whole range is above the threshold", () => {
    const base = input();
    const { input: after } = applyLevers(base, [{ kind: "RAISE_US_CONTENT", line_id: "XCVR-A-3200", wave_id: "W3" }]);
    after.dataset.parts["XCVR-A-3200+USC"].us_bom_value_share = { estimate: 0.8, low: 0.7, high: 0.9, basis: "test" };
    expect(cell(evaluate(after), "W3", "XCVR-A-3200+USC").status).toBe("CLEAR");
  });
  it("reports Δ cost and Δ schedule", () => {
    const r = compareLevers(input(), [{ kind: "RAISE_US_CONTENT", line_id: "XCVR-A-3200", wave_id: "W3" }]);
    const w3 = r.waves.find((w) => w.wave_id === "W3")!;
    expect(w3.delta_risk).toBeLessThan(0);
    expect(w3.delta_cost_usd).toBeGreaterThan(0);
    // W3's schedule is set by its longest lead time (US supplier C, 30 weeks), which the 22-week USC variant doesn't exceed.
    expect(w3.delta_schedule_weeks).toBe(0);
    const w4 = compareLevers(input(), [{ kind: "RAISE_US_CONTENT", line_id: "XCVR-A-3200", wave_id: "W4" }]).waves.find((w) => w.wave_id === "W4")!;
    expect(w4.after.schedule_weeks).toBeGreaterThanOrEqual(w4.before.schedule_weeks);
  });
});

describe("§7.4.3 W4 (FEDERAL_NSS, CPO)", () => {
  it("the CPO switch inherits the optics exposure", () => {
    const sw = cell(run(), "W4", "SW-CPO-3200");
    expect(sw.status).toBe("BLOCKED_NEW_AUTH");
    expect(sw.path[0]).toBe("SW-CPO-3200");
    expect(sw.path).toContain("XCVR-A-3200");
  });
  it("switching W4 to pluggable optics removes the inheritance", () => {
    const { input: after } = applyLevers(input(), [{ kind: "CHANGE_OPTICS_FORM", wave_id: "W4", form: "PLUGGABLE" }]);
    expect(cell(evaluate(after), "W4", "SW-CPO-3200").status).toBe("CLEAR");
  });
  it("R3 shows BLOCKED_FEDERAL only after the five-year transition", () => {
    const hasR3 = (date: string) => cell(run({ date }), "W4", "XCVR-A-3200").hits.some((h) => h.rule_id === "R3" && h.status === "BLOCKED_FEDERAL");
    expect(hasR3("2029-04-01")).toBe(false);
    expect(hasR3("2032-06-29")).toBe(false);
    expect(hasR3("2032-06-30")).toBe(true);
  });
});

describe("§7.4.4 W2 (MIXED) and the 1260H list", () => {
  it("flags DoD contracting exposure from 2026-06-30, goods from 2027-06-30", () => {
    const ctxs = (date: string) => cell(run({ date }), "W2", "XCVR-A-1600").hits.filter((h) => h.rule_id === "R4").map((h) => h.context);
    expect(ctxs("2026-06-29")).toEqual([]);
    expect(ctxs("2026-06-30")).toEqual(["DOD_CONTRACTING"]);
    expect(ctxs("2027-06-30")).toEqual(["DOD_CONTRACTING", "DOD_PROCUREMENT_GOODS"]);
    expect(cell(run(), "W2", "XCVR-A-1600").status).toBe("BLOCKED_DOD");
  });
  it("FEDERAL_ENCLAVE splits it out and re-sources the federal pool", () => {
    const r = applyLevers(input(), [{ kind: "FEDERAL_ENCLAVE", wave_id: "W2", federal_share: 0.3 }]);
    const ex = evaluate(r.input);
    const w2 = ex.filter((e) => e.build_wave_id.startsWith("W2"));
    expect(w2.some((e) => e.build_wave_id === "W2-FED")).toBe(true);
    expect(w2.filter((e) => e.status === "BLOCKED_DOD")).toEqual([]);
    const fed = r.input.waves.find((w) => w.id === "W2-FED")!;
    expect(fed.quantities["XCVR-A-1600"]).toBeUndefined();
    const report = compareLevers(input(), [{ kind: "FEDERAL_ENCLAVE", wave_id: "W2", federal_share: 0.3 }]);
    expect(report.waves.find((w) => w.wave_id === "W2")!.delta_cost_usd).toBeGreaterThan(0);
  });
});

describe("§7.4.5 Edge routers", () => {
  it("shows APPROVAL_EXPIRING in the six months before the assumed Conditional Approval expires", () => {
    const at = (date: string) => cell(run({ date }), "W1", "RTR-EDGE-1").status;
    expect(at("2026-10-01")).toBe("CLEAR");
    expect(at("2027-03-29")).toBe("CLEAR");
    expect(at("2027-03-30")).toBe("APPROVAL_EXPIRING");
    expect(at("2027-09-30")).toBe("BLOCKED_NEW_AUTH");
    const w2 = cell(run(), "W2", "RTR-EDGE-1");
    expect(w2.status).toBe("APPROVAL_EXPIRING");
    expect(w2.flags).toContain("ASSUMED_CARVE_OUT");
  });
  it("SEEK_CONDITIONAL_APPROVAL can extend it", () => {
    const { input: after } = applyLevers(input(), [{ kind: "SEEK_CONDITIONAL_APPROVAL", line_id: "RTR-EDGE-1", assumed_grant: "2027-06-01", term_months: 18 }]);
    expect(cell(evaluate(after), "W2", "RTR-EDGE-1").status).toBe("CLEAR");
  });
});

describe("§7.4.6 Dropped", () => {
  it("only R1, R4, R5 and R6 remain", () => {
    const ex = run({ optics: "dropped" });
    const fired = new Set(ex.flatMap((e) => e.hits.map((h) => h.rule_id)));
    for (const r of fired) expect(["R1", "R4", "R5", "R6"]).toContain(r);
    expect(cell(ex, "W3", "XCVR-A-3200").status).toBe("CLEAR");
    expect(cell(ex, "W1", "INV-BESS-1").status).toBe("BLOCKED_NEW_AUTH");
    expect(cell(ex, "W2", "XCVR-A-1600").status).toBe("BLOCKED_DOD");
  });
});

describe("other branches", () => {
  it("Delayed: R2 starts 2028-01-01 and S.5548 never fires", () => {
    const ex = run({ optics: "delayed", date: "2027-12-01" });
    expect(cell(ex, "W3", "XCVR-A-3200").status).toBe("CLEAR");
    expect(cell(run({ optics: "delayed", date: "2033-01-01" }), "W4", "XCVR-A-3200").triggered_rules).not.toContain("R3");
  });
  it("Broadened: 1.6T is covered with no carve-out and either definition", () => {
    const ex = run({ optics: "broadened" });
    expect(cell(ex, "W2", "XCVR-A-1600").hits.some((h) => h.rule_id === "R2")).toBe(true);
    expect(cell(ex, "W2", "XCVR-A-1600").hits.some((h) => h.rule_id === "R2-LIST")).toBe(true);
    expect(cell(ex, "W2", "XCVR-D-1600").status).toBe("CLEAR");
  });
  it("RAISE_US_CONTENT doesn't help in Broadened, where the carve-out is gone", () => {
    const { input: after } = applyLevers(input({ optics: "broadened" }), [{ kind: "RAISE_US_CONTENT", line_id: "XCVR-A-3200", wave_id: "W3" }]);
    expect(cell(evaluate(after), "W3", "XCVR-A-3200+USC").status).toBe("BLOCKED_NEW_AUTH");
  });
  it("inverters: the domestic US alternate clears", () => {
    const { input: after } = applyLevers(input(), [{ kind: "SWAP_SUPPLIER", line_id: "INV-BESS-1", alternate_id: "INV-BESS-US" }]);
    expect(cell(evaluate(after), "W3", "INV-BESS-US").status).toBe("CLEAR");
  });
});

describe("evidence and determinism", () => {
  it("never shows a blocked status without an evidence grade", () => {
    for (const e of run({ optics: "broadened", remote: "megaspeed-listed" })) {
      if (e.status.startsWith("BLOCKED")) expect(e.evidence_grade).not.toBe("");
    }
  });
  it("gives the same output for the same input", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
