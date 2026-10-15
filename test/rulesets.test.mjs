import { test } from "node:test";
import assert from "node:assert/strict";
import { RULESETS, getRuleset, handicapPoints } from "../src/rulesets.mjs";

test("all five rulesets.md rulesets are present with the documented parameter values", () => {
  assert.deepEqual(RULESETS.chinese, {
    name: "chinese",
    ko_regime: "positional_superko",
    suicide: "illegal",
    scoring: "area",
    komi: 7.5,
    handicap_placement: "fixed_star_points",
  });
  assert.deepEqual(RULESETS.japanese, {
    name: "japanese",
    ko_regime: "simple_ko",
    suicide: "illegal",
    scoring: "territory",
    komi: 6.5,
    handicap_placement: "fixed_star_points",
  });
  assert.deepEqual(RULESETS.aga, {
    name: "aga",
    ko_regime: "situational_superko",
    suicide: "illegal",
    scoring: "area_or_territory",
    komi: 7.5,
    komi_territory: 6.5,
    handicap_placement: "fixed_star_points",
  });
  assert.deepEqual(RULESETS.newzealand, {
    name: "newzealand",
    ko_regime: "positional_superko",
    suicide: "legal",
    scoring: "area",
    komi: 7,
    handicap_placement: "fixed_star_points",
  });
  assert.deepEqual(RULESETS.ing, {
    name: "ing",
    ko_regime: "positional_superko",
    suicide: "illegal",
    scoring: "area",
    komi: 8,
    handicap_placement: "fixed_star_points",
  });
});

test("getRuleset throws on an unknown name", () => {
  assert.throws(() => getRuleset("klingon"), /Unknown ruleset/);
});

test("ruleset selection rejects inherited object keys instead of treating them as Go rules", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.throws(() => getRuleset(name), /Unknown ruleset/,
      `Object.prototype.${name} is not a Go ruleset`);
  }
  for (const name of Object.keys(RULESETS)) {
    assert.strictEqual(getRuleset(name), RULESETS[name],
      `every actual Go ruleset remains unchanged: ${name}`);
  }
});

test("handicap placement refuses nonstandard board sizes instead of borrowing 19x19 coordinates", () => {
  for (const size of [1, 5, 7, 8, 10, 17, 20]) {
    assert.throws(() => handicapPoints(size, 2), /No standard fixed-star/,
      `there is no sourced fixed-hoshi table for ${size}x${size}`);
  }
  for (const size of [9, 13, 19]) {
    const points = handicapPoints(size, 2);
    assert.equal(points.length, 2);
  }
});


test("R13: 4-stone 9x9 handicap is exactly {C3, G3, C7, G7}", () => {
  const pts = handicapPoints(9, 4);
  assert.deepEqual(new Set(pts), new Set(["C3", "G3", "C7", "G7"]));
});

test("9x9 handicap tops out at 5 stones (no standard placement beyond the 5 star points)", () => {
  assert.doesNotThrow(() => handicapPoints(9, 5));
  assert.throws(() => handicapPoints(9, 6));
});

test("13x13 handicap tops out at 5 stones, 19x19 supports up to 9", () => {
  assert.throws(() => handicapPoints(13, 6));
  assert.doesNotThrow(() => handicapPoints(19, 9));
  assert.throws(() => handicapPoints(19, 10));
});

test("2-5 stone handicap point sets are strictly increasing on every size (tengen hasn't entered the picture yet)", () => {
  for (const size of [9, 13, 19]) {
    let prev = new Set();
    for (let n = 2; n <= 5; n++) {
      const cur = new Set(handicapPoints(size, n));
      assert.equal(cur.size, n);
      for (const p of prev) assert.ok(cur.has(p), `size ${size}, count ${n} dropped point ${p} present at count ${n - 1}`);
      prev = cur;
    }
  }
});

test("19x19 handicap tables match handicap-placement-and-komi-values.md exactly, including non-monotonic tengen", () => {
  // Per the doctrine's placement-order table: tengen (center, K10) is
  // present at 5 and 7 stones and ABSENT at 6 and 8 -- not a superset
  // relationship the way 2-5 and 9 are.
  const corners = new Set(["D16", "Q16", "D4", "Q4"]);
  const withCenter5 = new Set(handicapPoints(19, 5));
  assert.equal(withCenter5.size, 5);
  assert.ok(withCenter5.has("K10"), "5 stones includes tengen");
  for (const c of corners) assert.ok(withCenter5.has(c));

  const six = new Set(handicapPoints(19, 6));
  assert.deepEqual(six, new Set([...corners, "D10", "Q10"]));
  assert.ok(!six.has("K10"), "6 stones excludes tengen");

  const seven = new Set(handicapPoints(19, 7));
  assert.deepEqual(seven, new Set([...six, "K10"]));

  const eight = new Set(handicapPoints(19, 8));
  assert.deepEqual(eight, new Set([...corners, "D10", "Q10", "K16", "K4"]));
  assert.ok(!eight.has("K10"), "8 stones excludes tengen");

  const nine = new Set(handicapPoints(19, 9));
  assert.deepEqual(nine, new Set([...eight, "K10"]));
  assert.equal(nine.size, 9, "9 stones is all nine hoshi");
});
