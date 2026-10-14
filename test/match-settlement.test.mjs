import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE } from "../src/board.mjs";
import { admitWeiqiMatchCommand, createWeiqiMatch, verifyWeiqiMatch } from "../src/match.mjs";
import { WALL_MOVES } from "./helpers/session-fixtures.mjs";

const config = Object.freeze({ size: 5, ruleset: "chinese" });
const players = Object.freeze({ black: "principal:black", white: "principal:white" });
let keys = 0;

function submit(match, principal, command) {
  keys += 1;
  return admitWeiqiMatchCommand(match, { principal, idempotencyKey: `k${keys}`, expectedVersion: match.session.version, command }, 1000 + keys);
}

function accept(match, principal, command) {
  const admission = submit(match, principal, command);
  assert.equal(admission.ok, true, JSON.stringify({ principal, command, admission }));
  if (!admission.ok) throw new Error(admission.reason);
  return admission.match;
}

function walledMatch() {
  let match = createWeiqiMatch(config, players);
  for (const [index, move] of WALL_MOVES.entries()) {
    match = accept(match, index % 2 === 0 ? players.black : players.white,
      { kind: "play", move });
  }
  match = accept(match, players.black, { kind: "pass" });
  match = accept(match, players.white, { kind: "play", move: "A3" });
  match = accept(match, players.black, { kind: "pass" });
  match = accept(match, players.white, { kind: "pass" });
  assert.equal(match.session.state.mainPhaseEnded, true);
  return match;
}

test("a principal may resign off-turn, only as its own color, and the log replays it", () => {
  let match = createWeiqiMatch(config, players);
  match = accept(match, players.black, { kind: "play", move: "C3" });
  const wrongColor = submit(match, players.black, { kind: "resign", color: WHITE });
  assert.deepEqual(wrongColor, { ok: false, reason: "not-your-color" });
  const resigned = accept(match, players.black, { kind: "resign", color: BLACK });
  assert.deepEqual(resigned.session.state.result, { by: "resignation", winner: WHITE, loser: BLACK });
  assert.equal(resigned.log.length, 2);
  assert.equal(verifyWeiqiMatch(resigned).valid, true);
  const after = submit(resigned, players.white, { kind: "play", move: "D4" });
  assert.deepEqual(after, { ok: false, reason: "illegal-command" });
});

test("a settlement counts only once both principals have proposed the same dead stones", () => {
  const match = walledMatch();
  const early = submit(createWeiqiMatch(config, players), players.black, { kind: "settle", dead: [] });
  assert.deepEqual(early, { ok: false, reason: "illegal-command" });

  const first = submit(match, players.black, { kind: "settle", dead: ["A3"] });
  assert.ok(first.ok && !first.duplicate && "proposed" in first && first.proposed);
  if (!first.ok || first.duplicate) return;
  assert.deepEqual(first.match.pendingSettlement, { principal: players.black, dead: ["A3"] });
  assert.equal(first.match.session.state.result, null);
  assert.equal(first.match.session.version, match.session.version, "a proposal does not advance the session");
  assert.equal(first.match.log.length, match.log.length + 1, "but it is in the log");

  const counter = submit(first.match, players.white, { kind: "settle", dead: [] });
  assert.ok(counter.ok && "proposed" in counter && counter.proposed);
  if (!counter.ok) return;
  assert.deepEqual(counter.match.pendingSettlement, { principal: players.white, dead: [] });

  const agreed = submit(counter.match, players.black, { kind: "settle", dead: [] });
  assert.ok(agreed.ok && !agreed.duplicate && !("proposed" in agreed));
  if (!agreed.ok) return;
  assert.equal(agreed.match.pendingSettlement, null);
  const result = agreed.match.session.state.result;
  assert.ok(result && result.by === "count");
  if (result && result.by === "count") {
    assert.deepEqual(result.dead, []);
    assert.equal(result.score.blackTerritory, 0, "with A3 alive, Black's side is neutralized");
  }
  assert.equal(verifyWeiqiMatch(agreed.match).valid, true);
  const rebuilt = verifyWeiqiMatch(agreed.match);
  assert.ok(rebuilt.valid && rebuilt.stateHash === agreed.match.stateHash);
});

test("matching proposals from both sides settle with the stones removed, and a proposal naming an empty point is refused", () => {
  const match = walledMatch();
  const bad = submit(match, players.white, { kind: "settle", dead: ["C3"] });
  assert.deepEqual(bad, { ok: false, reason: "illegal-command" });
  const white = accept(match, players.white, { kind: "settle", dead: ["a3"] });
  const black = accept(white, players.black, { kind: "settle", dead: ["A3"] });
  const result = black.session.state.result;
  assert.ok(result && result.by === "count");
  if (result && result.by === "count") {
    assert.deepEqual(result.dead, ["A3"]);
    assert.equal(result.score.blackScore, 10);
    assert.equal(result.score.margin, "White by 7.5");
  }
});


test("match settlement proposals cannot bypass renewed passes after a resumed game", () => {
  let match = createWeiqiMatch({ size: 9, ruleset: "chinese" }, players);
  match = accept(match, players.black, { kind: "play", move: "E5" });
  match = accept(match, players.white, { kind: "play", move: "D4" });
  match = accept(match, players.black, { kind: "pass" });
  match = accept(match, players.white, { kind: "pass" });
  assert.equal(match.session.state.passStreak, 2);
  const atCount = submit(match, players.white, { kind: "settle", dead: [] });
  assert.equal(atCount.ok, true);
  if (!atCount.ok) return;
  assert.equal(atCount.match.pendingSettlement?.principal, players.white);
  match = accept(atCount.match, players.black, { kind: "play", move: "C3" });
  assert.equal(match.pendingSettlement, null, "resuming play clears a proposed count");
  assert.equal(match.session.state.mainPhaseEnded, true);
  assert.equal(match.session.state.passStreak, 0);
  const premature = submit(match, players.white, { kind: "settle", dead: [] });
  assert.deepEqual(premature, { ok: false, reason: "illegal-command" });
  assert.equal(match.log.at(-1).intent.command.move, "C3", "rejected proposal must not enter log");
  assert.equal(verifyWeiqiMatch(match).valid, true);

  match = accept(match, players.white, { kind: "pass" });
  assert.deepEqual(submit(match, players.black, { kind: "settle", dead: [] }),
    { ok: false, reason: "illegal-command" });
  match = accept(match, players.black, { kind: "pass" });
  const proposal = submit(match, players.white, { kind: "settle", dead: [] });
  assert.equal(proposal.ok, true);
  if (!proposal.ok) return;
  const agreed = submit(proposal.match, players.black, { kind: "settle", dead: [] });
  assert.equal(agreed.ok, true);
  if (agreed.ok) {
    assert.equal(agreed.match.session.state.result?.by, "count");
    assert.equal(verifyWeiqiMatch(agreed.match).valid, true);
  }
});


test("a handicap match opens with White to move and the stones on the board", () => {
  const match = createWeiqiMatch({ size: 9, ruleset: "chinese", handicap: 3 }, players);
  assert.deepEqual(match.session.state.handicap, ["G7", "C3", "G3"]);
  const blackFirst = submit(match, players.black, { kind: "play", move: "E5" });
  assert.deepEqual(blackFirst, { ok: false, reason: "not-your-turn" });
  const white = accept(match, players.white, { kind: "play", move: "E5" });
  assert.equal(white.session.version, 1);
  assert.equal(verifyWeiqiMatch(white).valid, true);
});


test("matched duplicate dead-stone proposals produce a one-stone canonical result", () => {
  const match = walledMatch();
  const first = submit(match, players.white,
    { kind: "settle", dead: ["a3", "A3"] });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.match.pendingSettlement.dead, ["A3"],
    "the match already treats dead marking as a set");
  const agreed = submit(first.match, players.black,
    { kind: "settle", dead: [" A3 ", "a3"] });
  assert.equal(agreed.ok, true);
  if (!agreed.ok) return;
  assert.deepEqual(agreed.match.session.state.result.dead, ["A3"],
    "the engine's final result must agree with the match's normalized proposal");
  assert.equal(agreed.match.session.state.result.score.blackPrisoners, 1);
  assert.equal(verifyWeiqiMatch(agreed.match).valid, true);
});



test("durable match rejects a proposed partial dead group before writing it to the log", () => {
  const match = walledMatch();
  const partial = submit(match, players.white,
    { kind: "settle", dead: ["B3"] });
  assert.deepEqual(partial, { ok: false, reason: "illegal-command" });
  assert.equal(match.pendingSettlement, null);
  assert.equal(match.log.at(-1).intent.command.kind, "pass");
  assert.equal(verifyWeiqiMatch(match).valid, true);
  const all = submit(match, players.white,
    { kind: "settle", dead: ["B1", "B2", "B3", "B4", "B5"] });
  assert.equal(all.ok, true);
  if (all.ok) assert.equal(all.match.pendingSettlement.dead.length, 5);
});

