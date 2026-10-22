import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLACK, WHITE, EMPTY, findGroup, findGroupBoundaryIncidence, neighbors,
} from "../src/board.mjs";
import { createPositionFromCells } from "../src/position.mjs";
import { Game } from "../src/game.mjs";

/**
 * Exact finite boundary-data refusal case: three connected black stones have
 * one DISTINCT liberty but two source-qualified edge contacts. No physical
 * RT entropy, Crofton density, territory or ko legality is inferred.
 */
test("one qi endpoint forgets two contact witnesses on the same 2x2 group", () => {
  const cells = Uint8Array.from([BLACK, BLACK, BLACK, EMPTY]);
  const measured = findGroupBoundaryIncidence(cells, 2, 2, 0);
  assert.deepEqual(measured.stones, [0, 1, 2]);
  assert.deepEqual(measured.liberties, [3]);
  assert.deepEqual(measured.contacts, [
    { stone: 1, endpoint: 3 }, { stone: 2, endpoint: 3 },
  ]);
  assert.deepEqual(measured.sharedLiberties, [3]);
  assert.equal(measured.endpointInjective, false);
  assert.ok(Object.isFrozen(measured));
  assert.ok(Object.isFrozen(measured.contacts));
  assert.ok(Object.isFrozen(measured.contacts[0]));
});

/** Every observed liberty has one contact witness in this source position. */
test("one-to-one contact endpoint readout is recoverable in a single-stone group", () => {
  const cells = Uint8Array.from([BLACK, EMPTY, EMPTY, WHITE]);
  const measured = findGroupBoundaryIncidence(cells, 2, 2, 0);
  assert.deepEqual(measured.stones, [0]);
  assert.deepEqual(measured.liberties, [1, 2]);
  assert.deepEqual(measured.contacts, [
    { stone: 0, endpoint: 1 }, { stone: 0, endpoint: 2 },
  ]);
  assert.deepEqual(measured.sharedLiberties, []);
  assert.equal(measured.endpointInjective, true);
  assert.throws(() => findGroupBoundaryIncidence(cells, 2, 2, 1));
});

/**
 * Exhaust all 3^6 valid stone assignments on the 3x2 rectangle. Each occupied
 * root's readout must recover EXACTLY the original source group's qi-set and
 * precisely those occupied-to-empty neighbor contacts. This deliberately
 * does not assert that any liberty is a legal next move under ko/history.
 */
test("contact fibers exactly project onto native liberties on all 3^6 boards", () => {
  const width = 3, height = 2, points = width * height;
  let examined = 0, noninjective = 0;
  for (let state = 0; state < 3 ** points; state++) {
    let code = state;
    const cells = new Uint8Array(points);
    for (let i = 0; i < points; i++) {
      cells[i] = code % 3;
      code = Math.floor(code / 3);
    }
    for (let root = 0; root < points; root++) {
      if (cells[root] === EMPTY) continue;
      examined++;
      const native = findGroup(cells, width, height, root);
      const readout = findGroupBoundaryIncidence(cells, width, height, root);
      const expectedContacts = native.stones.flatMap(stone =>
        neighbors(width, height, stone)
          .filter(endpoint => cells[endpoint] === EMPTY)
          .map(endpoint => ({ stone, endpoint })))
        .sort((a, b) => a.endpoint - b.endpoint || a.stone - b.stone);
      const expectedLiberties = [...native.liberties].sort((a, b) => a - b);
      assert.deepEqual(readout.contacts, expectedContacts);
      assert.deepEqual(readout.liberties, expectedLiberties);
      assert.deepEqual([...new Set(readout.contacts.map(c => c.endpoint))],
        expectedLiberties, "support must be precisely qi, not multiset");
      assert.equal(readout.contacts.length >= readout.liberties.length, true);
      const unique = readout.contacts.length === readout.liberties.length;
      assert.equal(readout.endpointInjective, unique);
      assert.deepEqual(readout.sharedLiberties, expectedLiberties.filter(q =>
        readout.contacts.filter(c => c.endpoint === q).length > 1));
      if (!unique) noninjective++;
    }
  }
  assert.ok(examined > 2000);
  assert.ok(noninjective > 0, "strict loss must arise in finite source positions");
});

test("Game exposes source-specific contact witnesses without mutating history", () => {
  const position = createPositionFromCells(2, 2,
    [BLACK, BLACK, BLACK, EMPTY], WHITE);
  const game = new Game(2, "japanese", position);
  const head = game.current;
  const events = game.moveEvents.length;
  const history = game.history.length;
  const measured = game.groupBoundaryIncidenceAt("A1");
  assert.deepEqual(measured.liberties, [3]);
  assert.equal(measured.endpointInjective, false);
  assert.equal(measured.contacts.length, 2);
  assert.equal(game.current, head);
  assert.equal(game.history.length, history);
  assert.equal(game.moveEvents.length, events);
  assert.throws(() => game.groupBoundaryIncidenceAt("B2"));
  assert.throws(() => game.groupBoundaryIncidenceAt("Z9"));
});
