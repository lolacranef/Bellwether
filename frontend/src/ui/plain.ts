// Plain-language labels (aimed at a 5th-grade reader). Technical terms stay available under "More detail".
import type { Context, EvidenceGrade, Flag, LegalStatus, ProductCategory, Segment, Status } from "../model/types";

export const STATUS_PLAIN: Record<Status, string> = {
  CLEAR: "OK",
  WATCH: "Keep an eye on",
  APPROVAL_EXPIRING: "Permission running out",
  AT_RISK: "Could be affected",
  LICENSE_REQUIRED: "Needs a permit",
  LICENSE_REQUIRED_TENANT: "Customer needs a permit",
  BLOCKED_DOD: "Not allowed for the military",
  BLOCKED_FEDERAL: "Not allowed for government",
  BLOCKED_EXPORT: "Can't be shipped",
  BLOCKED_NEW_AUTH: "Can't get US approval",
};

export const CATEGORY_PLAIN: Record<ProductCategory, string> = {
  OPTICAL_TRANSCEIVER: "Fiber-optic plugs",
  SWITCH: "Network switches",
  SERVER: "AI computers",
  ROUTER_CONSUMER: "Internet routers",
  ROUTER_ENTERPRISE: "Business routers",
  POWER_INVERTER_CONNECTED: "Battery power converters",
  NIC: "Network cards",
  BMC: "Control chips",
  PSU: "Power supplies",
  OTHER: "Other parts",
};

export const CATEGORY_HELP: Partial<Record<ProductCategory, string>> = {
  OPTICAL_TRANSCEIVER: "They turn computer signals into light so data can travel through glass cables.",
  SWITCH: "They connect thousands of computers so they can talk to each other.",
  SERVER: "The powerful computers that run artificial intelligence.",
  ROUTER_CONSUMER: "Small routers used at remote offices.",
  POWER_INVERTER_CONNECTED: "They connect batteries and solar panels to the building's power.",
};

export const SEGMENT_PLAIN: Record<Segment, string> = {
  COMMERCIAL: "businesses",
  FEDERAL_NSS: "government security",
  DOD: "the military",
  MIXED: "businesses and government",
};

export const COUNTRY: Record<string, string> = {
  USA: "United States", CHN: "China", MYS: "Malaysia", IDN: "Indonesia", SGP: "Singapore", THA: "Thailand", TWN: "Taiwan",
  VNM: "Vietnam", JPN: "Japan", RUS: "Russia", IRN: "Iran", BRA: "Brazil", PRK: "North Korea",
};
export const country = (c: string) => COUNTRY[c] ?? (c || "unknown");

export const CONTEXT_PLAIN: Record<Context, string> = {
  NEW_FCC_AUTHORIZATION: "getting US approval to sell a new device",
  IMPORT_MARKETING: "bringing a device into the US to sell",
  FEDERAL_NSS_PROCUREMENT: "use in government security systems",
  DOD_CONTRACTING: "contracts with the military",
  DOD_PROCUREMENT_GOODS: "products bought by the military",
  FIRMWARE_UPDATES: "software updates",
  ALL: "everything",
  EXPORT_LICENSE_CHIPS: "shipping top AI chips",
  REMOTE_ACCESS_IAAS: "renting computer power to customers",
  IS_INFORMED_NOTICE: "a direct government notice",
};

export const LEGAL_PLAIN: Record<LegalStatus, string> = {
  ENACTED: "Official rule",
  PROPOSED: "Proposed",
  INTRODUCED: "A bill in Congress",
  REPORTED: "Reported in the news",
  RUMORED: "A rumor",
  WITHDRAWN: "Dropped",
};

export const FLAG_PLAIN: Record<Flag, string> = {
  RECENT_OWNERSHIP_CHANGE: "Owner changed recently",
  OUT_OF_JURISDICTION: "US rule, building abroad",
  DISCLOSURE_REQUIRED: "Must be reported",
  ASSUMED_CARVE_OUT: "Based on a guess",
  OFFBOARDED: "Customer removed",
};

export const RULE_SHORT: Record<string, string> = {
  R1: "Banned-parts rule", "R1-FW": "Software ban idea", R2: "Fiber-plug ban (news)", "R2-LIST": "Plug makers banned (rumor)",
  R3: "Senate bill S.5548", R4: "Military company list", R5: "Foreign routers rule", R6: "Foreign power converters rule",
  RA1: "Computer-rental permit", RA2: "Chip permit: 5 countries", RA3: "Chip permit: China-owned", RA4: "List your customers",
  RA5: "Megaspeed ban (what if)", RA6: "Surprise notices",
};

export const RULE_PLAIN: Record<string, string> = {
  R1: "A new device can't get US approval if one of its \"brain\" chips comes from a company on the government's banned list.",
  "R1-FW": "An idea being discussed: also ban software from those companies. That would reach devices people already own.",
  R2: "Reported in the news, not official yet: new Chinese-made fiber-optic plugs at the fastest speed (3.2T) couldn't get US approval, unless at least 65% of their value is American.",
  "R2-LIST": "A rumor: four big Chinese makers of fiber-optic plugs get added to the banned list.",
  R3: "A bill in Congress: government security systems couldn't use plugs from InnoLight or Eoptolink, after a five-year wait.",
  R4: "The military can't sign contracts with InnoLight (from June 2026) or buy its products (from June 2027).",
  R5: "New foreign-made small routers can't get US approval, unless they get special permission that lasts up to 18 months.",
  R6: "New foreign-made \"smart\" battery power converters can't get US approval, unless they are made in America.",
  RA1: "Data centers in other countries need a permit to rent lots of computer power to companies owned from China, Russia or Iran.",
  RA2: "Companies based in Indonesia, Malaysia, Singapore, Thailand or Brazil need a permit to buy top AI chips.",
  RA3: "Selling top AI chips to companies owned from China needs a permit anywhere in the world.",
  RA4: "When asking for a chip permit, a company must list its customers that are owned from China, Russia or Iran.",
  RA5: "What if the government bans a company called Megaspeed, and everyone connected to it?",
  RA6: "The government can name one product or customer and require a permit, starting that same day.",
};

export const BRANCH_PLAIN: Record<string, { name: string; text: string }> = {
  "as-reported": { name: "As the news says", text: "The fiber-plug ban starts in January 2027, with the 65% American exception. The Senate bill passes in mid-2027." },
  delayed: { name: "Delayed a year", text: "The fiber-plug ban starts a year later, in January 2028. The Senate bill never passes." },
  broadened: { name: "Made stricter", text: "The ban also covers slower 1.6T plugs, with no exception. Four plug makers go on the banned list, and the software ban starts in 2027." },
  dropped: { name: "Never happens", text: "None of the reported or proposed rules happen. Only today's official rules apply. This is the starting point." },
  "as-issued": { name: "As written", text: "The new chip rules start on 14 February 2027, 90 days after they were announced." },
  "megaspeed-listed": { name: "Megaspeed banned", text: "Megaspeed and every company connected to it are banned from 1 March 2027." },
  tightened: { name: "Stricter limit", text: "The \"lots of computer power\" limit is set very low, so even small customers need a permit." },
  "rolled-back": { name: "Cancelled", text: "The new permit rules are cancelled." },
};

export const SCENARIO_PLAIN: Record<string, { name: string; text: string }> = {
  "SCN-OPTICS-2026": { name: "Story 1 · Fiber-optic parts", text: "New US rules about parts made by Chinese companies." },
  "SCN-REMOTE-ACCESS-2026": { name: "Story 2 · Renting out computers", text: "New US rules about who can use AI computers abroad." },
};

/** How sure are we, in words. Uses the same confidence number the engine computes. */
export function sureness(g: EvidenceGrade): { label: string; level: 1 | 2 | 3 | 4; why: string } {
  const c = g.confidence;
  const level = c >= 0.75 ? 4 : c >= 0.5 ? 3 : c >= 0.25 ? 2 : 1;
  const label = ["", "A guess", "Not very sure", "Fairly sure", "Very sure"][level];
  const why = g.no_primary_source
    ? `This comes from ${LEGAL_PLAIN[g.legal_status].toLowerCase()}. There is no official document yet.`
    : g.legal_status === "ENACTED" ? "This is an official rule with a published document."
    : `This is ${LEGAL_PLAIN[g.legal_status].toLowerCase()}, so it may still change.`;
  return { label, level: level as 1 | 2 | 3 | 4, why };
}
