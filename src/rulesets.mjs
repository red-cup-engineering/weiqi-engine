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
  // A ruleset identifier is one of the five authored, finite names.
  // Object.prototype keys such as "constructor" are not Go rulesets.
  if (typeof name !== "string" || !Object.hasOwn(RULESETS, name)) {
    throw new Error(`Unknown ruleset: "${name}" (known: ${Object.keys(RULESETS).join(", ")})`);
  }
  return RULESETS[name];
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
  // Only these sizes have an authored standard fixed-star handicap table.
  // Smaller Go regression boards are legal to simulate, but importing 19x19
  // star coordinates onto such a board would be a false configuration.
  const table = size === 9 ? NINE_BY_COUNT
    : size === 13 ? THIRTEEN_BY_COUNT
      : size === 19 ? NINETEEN_BY_COUNT : null;
  if (table === null) {
    throw new Error(`No standard fixed-star handicap placement for ${size}x${size}`);
  }
  const points = table[count];
  if (!points) {
    const max = Math.max(...Object.keys(table).map(Number));
    throw new Error(`${size}x${size} has no standard fixed-star handicap placement beyond ${max} stones (got ${count})`);
  }
  return points;
}


/**
 * A game's scoring compensation is a rule of Go, not a browser display
 * setting. Standard even-game komi belongs to the declared ruleset above;
 * handicap games use nominal 0.5 komi. Under area counting Chinese rules
 * transfer half a point per handicap stone from Black and to White, while
 * AGA adds one White point for each handicap stone after the first. Japanese
 * territory and Ing/New Zealand area counts add no further compensation.
 *
 * Source: Lenticule Science / Handicap Placement and Komi Values; British Go
 * Association's Comparison of Some Go Rules and AGA Rules.
 * This returns pure numeric scoring inputs; it does not adjudicate stones.
 */
export function handicapScorePolicy(ruleset, handicap = 0, mode = ruleset?.scoring === "territory" ? "territory" : "area") {
  if (!ruleset || !Object.hasOwn(RULESETS, ruleset.name) || RULESETS[ruleset.name] !== ruleset)
    throw new TypeError("Handicap score needs an original declared Weiqi ruleset");
  if (!Number.isSafeInteger(handicap) || handicap < 0 || handicap === 1)
    throw new TypeError("Handicap score needs 0 or an integer of at least two stones");
  if (mode !== "area" && mode !== "territory")
    throw new TypeError("Handicap score needs area or territory counting");
  if (handicap === 0) {
    return Object.freeze({
      komi: mode === "territory" ? (ruleset.komi_territory ?? ruleset.komi) : ruleset.komi,
      blackAdjustment: 0, whiteAdjustment: 0,
    });
  }
  const chineseArea = mode === "area" && ruleset.name === "chinese";
  const agaArea = mode === "area" && ruleset.name === "aga";
  return Object.freeze({
    komi: 0.5,
    blackAdjustment: chineseArea ? -handicap / 2 : 0,
    whiteAdjustment: chineseArea ? handicap / 2 : agaArea ? handicap - 1 : 0,
  });
}
