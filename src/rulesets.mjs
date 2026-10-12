// Rulesets as declared data objects — not code forks.
//
// This is a direct transcription of the identifier vocabulary and value
// tables in rulesets.md's "Stable identifiers" section. If that document's
// tables ever change, this file should change to match, and vice versa:
// the two are meant to cite each other.

  

export const RULESETS = Object.freeze({
  chinese: Object.freeze({
    name: "chinese",
    ko_regime: "positional_superko",
    suicide: "illegal",
    scoring: "area",
    komi: 7.5,
    handicap_placement: "fixed_star_points",
  }),
  japanese: Object.freeze({
    name: "japanese",
    ko_regime: "simple_ko",
    suicide: "illegal",
    scoring: "territory",
    komi: 6.5,
    handicap_placement: "fixed_star_points",
  }),
  aga: Object.freeze({
    name: "aga",
    ko_regime: "situational_superko",
    suicide: "illegal",
    scoring: "area_or_territory",
    komi: 7.5,
    komi_territory: 6.5,
    handicap_placement: "fixed_star_points",
  }),
  newzealand: Object.freeze({
    name: "newzealand",
    ko_regime: "positional_superko",
    suicide: "legal",
    scoring: "area",
    komi: 7,
    handicap_placement: "fixed_star_points",
  }),
  ing: Object.freeze({
    name: "ing",
    ko_regime: "positional_superko",
    suicide: "illegal",
    scoring: "area",
    komi: 8,
    handicap_placement: "fixed_star_points",
  }),
});

export function getRuleset(name) {
  const r = RULESETS[name];
  if (!r) {
    throw new Error(`Unknown ruleset: "${name}" (known: ${Object.keys(RULESETS).join(", ")})`);
  }
  return r;
}

// --- Handicap placement -----------------------------------------------
//
// All five rulesets in the corpus use fixed_star_points (rulesets.md), so
// handicap placement is one shared table keyed by board size, not by
// ruleset. Star points for 9x9 are verified directly against regression
// position R13 (the 4-stone case). 13x13 and 19x19 points follow the
// standard hoshi layout (corners at the 4th line from each edge, 19x19
// additionally at the edge-middles and center) and the standard
// count-to-points handicap table transcribed from
// handicap-placement-and-komi-values.md's "Standard placement order for
// fixed handicaps" section.

const NINE = { UL: "C7", UR: "G7", LL: "C3", LR: "G3", C: "E5" };
const THIRTEEN = { UL: "D10", UR: "K10", LL: "D4", LR: "K4", C: "G7" };
const NINETEEN = {
  UL: "D16",
  UR: "Q16",
  LL: "D4",
  LR: "Q4",
  TM: "K16",
  BM: "K4",
  LM: "D10",
  RM: "Q10",
  C: "K10",
};

/**
 * Points 2-5 follow the same corner-then-center order on every board size
 * that defines them at all: two diagonal corners (upper right, lower
 * left), the third corner (lower right), the fourth corner (upper left),
 * then tengen (center).
 */
function firstFive(t) {
  return {
    2: [t.UR, t.LL],
    3: [t.UR, t.LL, t.LR],
    4: [t.UR, t.LL, t.LR, t.UL],
    5: [t.UR, t.LL, t.LR, t.UL, t.C],
  };
}

// 9x9 and 13x13 have no standard side-star handicap points, so neither
// defines a placement beyond 5 stones (see note above).
const NINE_BY_COUNT = firstFive(NINE);
const THIRTEEN_BY_COUNT = firstFive(THIRTEEN);

// 19x19 continues to 9 stones, but the set is NOT a monotonically growing
// superset of the previous count from 5 stones on: tengen is included at 5
// and 7 stones and excluded at 6 and 8 (replaced by the side stars, then
// added back), only returning for good at 9. A single add-order list
// cannot represent that, so each count is its own explicit point set.
const NINETEEN_BY_COUNT = {
  ...firstFive(NINETEEN),
  6: [NINETEEN.UR, NINETEEN.LL, NINETEEN.LR, NINETEEN.UL, NINETEEN.LM, NINETEEN.RM],
  7: [NINETEEN.UR, NINETEEN.LL, NINETEEN.LR, NINETEEN.UL, NINETEEN.LM, NINETEEN.RM, NINETEEN.C],
  8: [NINETEEN.UR, NINETEEN.LL, NINETEEN.LR, NINETEEN.UL, NINETEEN.LM, NINETEEN.RM, NINETEEN.TM, NINETEEN.BM],
  9: [
    NINETEEN.UR,
    NINETEEN.LL,
    NINETEEN.LR,
    NINETEEN.UL,
    NINETEEN.LM,
    NINETEEN.RM,
    NINETEEN.TM,
    NINETEEN.BM,
    NINETEEN.C,
  ],
};

/** Standard handicap-stone placements for `count` stones (2-9) on `size`. */
export function handicapPoints(size, count) {
  if (!Number.isInteger(count) || count < 2) {
    throw new Error(`Handicap count must be an integer >= 2, got ${count}`);
  }
  const table = size === 9 ? NINE_BY_COUNT : size === 13 ? THIRTEEN_BY_COUNT : NINETEEN_BY_COUNT;
  const points = table[count];
  if (!points) {
    const max = Math.max(...Object.keys(table).map(Number));
    throw new Error(`${size}x${size} has no standard fixed-star handicap placement beyond ${max} stones (got ${count})`);
  }
  return points;
}
