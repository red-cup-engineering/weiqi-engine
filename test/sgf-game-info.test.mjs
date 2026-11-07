import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BLACK, WHITE } from "../src/board.mjs";
import { parseSgfCollection, serializeSgfCollection, gameRecordToSgf, sgfToGameRecord } from "../src/sgf.mjs";

describe("SGF game-info projection", () => {
  const info = "RU[Japanese]KM[6.5]RE[W+R]PB[Black player]PW[White player]";
  const expected = {
    size: 9, ruleset: "Japanese", komi: 6.5, result: "W+R", handicap: undefined,
    moves: [{ color: BLACK, point: 20 }, { color: WHITE, point: 60 }],
  };

  test("reads the same game information at the root, a continuation or a nested branch", () => {
    for (const text of [
      `(;GM[1]FF[4]SZ[9]${info};B[cc];W[gg])`,
      `(;GM[1]FF[4]SZ[9];${info};B[cc];W[gg])`,
      `(;GM[1]FF[4]SZ[9];B[cc];W[gg]${info})`,
      `(;GM[1]FF[4]SZ[9];C[Shared opening];B[cc](; ;${info};W[gg])(;RU[Chinese]KM[7.5];W[dd]))`,
    ]) {
      const record = sgfToGameRecord(text);
      assert.deepEqual(record, expected);
      assert.deepEqual(sgfToGameRecord(gameRecordToSgf(record)), expected);
    }
  });

  test("keeps a selected game's handicap declaration distinct from its root setup", () => {
    const record = sgfToGameRecord("(;GM[1]SZ[9]AB[cc][gg](;RU[Japanese]KM[0.5]HA[2];W[ee];B[dd])(;RU[Chinese]HA[2];W[ff]))");
    assert.equal(record.handicapCount, 2);
    assert.deepEqual(record.handicap, ["C3", "G7"]);
    assert.equal(record.ruleset, "Japanese");
    assert.equal(record.komi, 0.5);
    assert.deepEqual(record.moves, [{ color: WHITE, point: 40 }, { color: BLACK, point: 30 }]);
  });

  test("does not borrow game information from a sibling branch or another game", () => {
    const text = "(;GM[1]SZ[9];B[cc](;W[gg])(;RU[Japanese]KM[6.5]RE[W+R];W[dd]))"
      + "(;SZ[13]RU[Chinese]KM[7.5]RE[B+1];B[ee])";
    const record = sgfToGameRecord(text);
    assert.equal(record.ruleset, undefined);
    assert.equal(record.komi, undefined);
    assert.equal(record.result, undefined);
    assert.equal(record.size, 9);
    assert.deepEqual(record.moves, expected.moves);
    const trees = parseSgfCollection(text);
    assert.equal(trees[0].children[1].nodes[0].properties.RU[0], "Japanese");
    assert.deepEqual(parseSgfCollection(serializeSgfCollection(trees)), trees);
  });

  test("allows only one game-info node on the selected path", () => {
    for (const text of [
      "(;SZ[9]RU[Chinese];B[aa];RU[Japanese])",
      "(;SZ[9]KM[7.5];B[aa](;RU[Japanese];W[bb]))",
      "(;SZ[9];RU[Japanese];B[aa];RE[W+R])",
      "(;SZ[9]PB[Alice];B[aa](;RU[Japanese];W[bb]))",
      "(;SZ[9]RU[Japanese];B[aa];PB[Alice])",
    ]) {
      assert.throws(() => sgfToGameRecord(text), /game-info.*one node/i, text);
      const trees = parseSgfCollection(text);
      assert.deepEqual(parseSgfCollection(serializeSgfCollection(trees)), trees,
        "generic tree parsing does not enforce game-specific projection semantics");
    }
  });

  test("classifies standard game-info fields separately from node annotations", () => {
    const fields = ["AN", "BR", "BT", "CP", "DT", "EV", "GN", "GC", "ON", "OT",
      "PB", "PC", "PW", "RE", "RO", "RU", "SO", "TM", "US", "WR", "WT", "HA", "KM"];
    for (const field of fields) {
      const value = field === "HA" ? "0" : field === "KM" ? "6.5" : "example";
      assert.throws(() => sgfToGameRecord(`(;SZ[9]${field}[${value}];RU[Japanese];B[aa])`),
        /game-info.*one node/i, field);
    }
    const record = sgfToGameRecord("(;SZ[9]C[Opening]N[Root];C[Later];RU[Japanese]KM[6.5];B[cc];C[Move comment];W[gg])");
    assert.equal(record.ruleset, "Japanese");
    assert.deepEqual(record.moves, expected.moves);
  });

  test("validates scalar values where the selected game-info node actually occurs", () => {
    for (const [property, error] of [
      ["RU[Chinese][Japanese]", /exactly one value/],
      ["KM[6.5][7.5]", /exactly one value/],
      ["RE[W+R][B+R]", /exactly one value/],
      ["HA[2][3]", /exactly one value/],
      ["KM[]", /Invalid SGF komi/],
      ["KM[NaN]", /Invalid SGF komi/],
      ["HA[-2]", /Invalid SGF handicap/],
    ]) {
      assert.throws(() => sgfToGameRecord(`(;GM[1]SZ[9];B[aa](;${property};W[bb]))`), error);
    }
  });
});
