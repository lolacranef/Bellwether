// Evidence propagation (SPECIFICATIONS §4.2): an exposure is only as strong as its weakest link —
// the instrument's legal status, its best source, and the weakest supplier edge on the path.
import type { WeightsConfig } from "../model/config";
import type { Credibility, EvidenceGrade, Instrument, LegalStatus, Reliability, Source } from "../model/types";

const REL: Reliability[] = ["A", "B", "C", "D", "E", "F"];
const LEGAL_ORDER: LegalStatus[] = ["ENACTED", "PROPOSED", "INTRODUCED", "REPORTED", "RUMORED", "WITHDRAWN"];

export interface RawGrade { reliability: Reliability; credibility: Credibility }

export function parseGrade(s: string | undefined | null): RawGrade {
  const m = /^([A-F])([1-6])$/.exec((s ?? "").trim());
  return m ? { reliability: m[1] as Reliability, credibility: Number(m[2]) as Credibility } : { reliability: "F", credibility: 6 };
}

const score = (g: RawGrade) => REL.indexOf(g.reliability) * 10 + g.credibility;

/** Best (strongest) of several grades. */
export function best(grades: RawGrade[]): RawGrade {
  return grades.reduce<RawGrade | null>((b, g) => (!b || score(g) < score(b) ? g : b), null) ?? { reliability: "F", credibility: 6 };
}

/** Weakest letter and weakest number, taken independently. */
export function weakest(grades: RawGrade[]): RawGrade {
  let r = 0, c = 1;
  for (const g of grades) {
    r = Math.max(r, REL.indexOf(g.reliability));
    c = Math.max(c, g.credibility);
  }
  return { reliability: REL[r], credibility: c as Credibility };
}

export function weakerLegal(a: LegalStatus, b: LegalStatus): LegalStatus {
  return LEGAL_ORDER.indexOf(a) >= LEGAL_ORDER.indexOf(b) ? a : b;
}

/** The instrument's best supporting source among those cited in its status history. */
export function instrumentSourceGrade(inst: Instrument, sources: Map<string, Source>): RawGrade {
  const gs = inst.status_history.map((h) => sources.get(h.source_id)).filter((s): s is Source => !!s)
    .map((s) => ({ reliability: s.reliability, credibility: s.credibility }));
  return best(gs);
}

export function combineGrade(inst: Instrument, instGrade: RawGrade, pathGrades: string[], w: WeightsConfig): EvidenceGrade {
  const g = weakest([instGrade, ...pathGrades.map(parseGrade)]);
  const noPrimary = !inst.primary_source_available;
  const label = `${g.reliability}${g.credibility} / ${inst.legal_status}${noPrimary ? " / no primary source" : ""}`;
  const confidence = w.legal_status_confidence[inst.legal_status] * w.reliability_confidence[g.reliability] *
    w.credibility_confidence[g.credibility] * (noPrimary ? w.no_primary_source_factor : 1);
  return { reliability: g.reliability, credibility: g.credibility, legal_status: inst.legal_status, no_primary_source: noPrimary, label, confidence };
}

/** Lower is weaker; used to pick the weakest grade among equally severe hits. */
export const gradeStrength = (g: EvidenceGrade) => g.confidence;
