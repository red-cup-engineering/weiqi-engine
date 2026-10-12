// The semantic event layer — the platform's signature feature, per the
// plan: "the engine is the executable form of the glossary." Each event
// type here corresponds to a named glossary term, and carries that term's
// path (as `termRef`) so a consumer (UI hover-card, post-game timeline,
// teacher review tool) can link straight to the corpus's own definition.
//
// This module is a pure function over one move's before/after state: it
// takes no game history beyond what Game already tracks (the single
// `activeKoPoint`), and returns both the events fired and the updated
// activeKoPoint for Game to carry forward. `annotatePass` is the
// equivalent pure function for the other kind of turn, a pass, which has
// no board to diff.
//
// Deferred events (do not add naive detectors for these — house doctrine
// is that this code is a sound model of the theory, not merely something
// that runs):
//   - cut: no `cut.md` exists in this corpus's glossary yet (see
//     content/text/glossary/terms/). Even once one does, a sound
//     definition needs more than local adjacency: it needs to know the two
//     enemy groups a cutting move separates were actually *connectable*,
//     which is a life-and-death-shaped question ("could this shape have
//     lived as one group"), not a same-move board diff. Add it once
//     cut.md exists and pins down what "connectable" means.
//   - false-eye / seki: eye.md, false-eye.md, and seki.md each describe
//     conditions (diagonal control, mutually-unfillable shared liberties)
//     that require reading whether a group can live, not just diffing one
//     move's board. eye-formed below already ships the smallest sound
//     approximation available to a pure move-diff (a "simple eye": every
//     orthogonal neighbor is the same color, no diagonal check) and is
//     documented as such; false-eye and seki need a real life-and-death
//     solver, which this module is not, so they are not represented here
//     rather than shipped wrong.
//   - liberty / territory / dame / superko: liberty is already the
//     currency atari/capture are defined in terms of, not an event of its
//     own; territory and dame are whole-board, end-of-game scoring facts
//     (scoring.mts's job) rather than per-move diffs; superko only ever
//     rejects a move (see game.mts's IllegalReason), so there is never an
//     accepted move left to annotate.
//   - group-settled: the constitution's purpose statement pairs this with
//     group-killed ("group settled/killed"), but settlement is a
//     dead-stone-marking-time fact (scoring.mts's removeDeadStones, driven
//     by agreement or life-and-death reading), not a per-move board diff —
//     the same reason false-eye/seki above are deferred rather than
//     shipped as an unsound move-diff detector.

import { findGroup, neighbors, opponent, pointToCoord } from "./board.mjs";

/**
 * Glossary term slug -> durable science-corpus reference.
 *
 * The terms remain owned by the Weiqi science section after this engine moved
 * to Red Cup. A package-relative source path would falsely claim engineering
 * owns that corpus and would break for installed registry consumers.
 */
export const TERM_PATH = Object.freeze({
  atari: "science://lenticule-science/weiqi/terms/atari",
  capture: "science://lenticule-science/weiqi/terms/capture",
  ko: "science://lenticule-science/weiqi/terms/ko",
  connection: "science://lenticule-science/weiqi/terms/connection",
  eye: "science://lenticule-science/weiqi/terms/eye",
  "life-and-death": "science://lenticule-science/weiqi/terms/life-and-death",
  pass: "science://lenticule-science/weiqi/terms/pass",
});

  

function mkEvent(type, term, detail) {
  return { type, term, termRef: TERM_PATH[term], detail };
}

/** A "simple eye" test: every orthogonal neighbor of `point` is `color` (edges/corners satisfied trivially by having fewer neighbors). No diagonal-control check — see the limitation note in the package README. */
function isSimpleEye(board, width, height, point, color) {
  if (board[point] !== 0) return false;
  for (const n of neighbors(width, height, point)) {
    if (board[n] !== color) return false;
  }
  return true;
}

export function annotateMove(input) {
  const { width, height, prevPosition, nextPosition, point, color, captured, selfCaptured, activeKoPoint } = input;
  const events = [];
  const opp = opponent(color);
  let nextActiveKoPoint = activeKoPoint;

  // ko-resolved: this move occupies the previously-active ko point, ending
  // that particular ko's tension (whether by legal retake or by the
  // defender filling it).
  if (activeKoPoint !== null && point === activeKoPoint) {
    events.push(mkEvent("ko-resolved", "ko", { point: pointToCoord(width, point) }));
    nextActiveKoPoint = null;
  }

  // capture / group-killed: one aggregate "capture" event for the move,
  // plus one "group-killed" event per distinct group removed (a single
  // move can capture more than one enemy group at once).
  if (captured.length > 0) {
    events.push(
      mkEvent("capture", "capture", {
        point: pointToCoord(width, point),
        by: color,
        stonesCaptured: captured.reduce((n, g) => n + g.stones.length, 0),
        groupsCaptured: captured.length,
      }),
    );
    for (const g of captured) {
      events.push(
        mkEvent("group-killed", "life-and-death", {
          color: g.color,
          groupSize: g.stones.length,
          stones: g.stones.map((s) => pointToCoord(width, s)),
        }),
      );
    }
  }
  if (selfCaptured) {
    events.push(
      mkEvent("capture", "capture", {
        point: pointToCoord(width, point),
        by: opp,
        stonesCaptured: selfCaptured.stones.length,
        groupsCaptured: 1,
        selfCapture: true,
      }),
    );
    events.push(
      mkEvent("group-killed", "life-and-death", {
        color: selfCaptured.color,
        groupSize: selfCaptured.stones.length,
        stones: selfCaptured.stones.map((s) => pointToCoord(width, s)),
        selfCapture: true,
      }),
    );
  }

  // ko-started: the classic single-stone-for-single-stone ko shape —
  // exactly one stone captured, and the placed stone is itself alone with
  // exactly one liberty, which is the point just vacated by the capture.
  if (!selfCaptured && captured.length === 1 && captured[0].stones.length === 1) {
    const placedGroup = findGroup(nextPosition.board, width, height, point);
    const capturedPoint = captured[0].stones[0];
    if (placedGroup.stones.length === 1 && placedGroup.liberties.size === 1 && placedGroup.liberties.has(capturedPoint)) {
      events.push(mkEvent("ko-started", "ko", { point: pointToCoord(width, capturedPoint) }));
      nextActiveKoPoint = capturedPoint;
    }
  }

  // atari-given: opponent groups adjacent to the played point that now sit
  // at exactly one liberty and were NOT already at one liberty before this
  // move (otherwise every quiet move next to an existing atari would
  // re-fire the event).
  const seenOpp = new Set();
  for (const n of neighbors(width, height, point)) {
    if (nextPosition.board[n] === opp && !seenOpp.has(n)) {
      const g = findGroup(nextPosition.board, width, height, n);
      for (const s of g.stones) seenOpp.add(s);
      if (g.liberties.size === 1) {
        const wasAlreadyAtari = findGroup(prevPosition.board, width, height, n).liberties.size === 1;
        if (!wasAlreadyAtari) {
          const libertyPoint = [...g.liberties][0];
          events.push(
            mkEvent("atari-given", "atari", {
              point: pointToCoord(width, libertyPoint),
              color: opp,
              groupSize: g.stones.length,
            }),
          );
        }
      }
    }
  }

  // atari-escaped: mover's own groups, adjacent to the played point, that
  // were in atari before this move and — still present on the board
  // afterward — now have more than one liberty. Covers both escape by
  // extension and escape by capturing the attacker.
  const seenMine = new Set();
  for (const n of neighbors(width, height, point)) {
    if (prevPosition.board[n] === color && !seenMine.has(n)) {
      const gBefore = findGroup(prevPosition.board, width, height, n);
      for (const s of gBefore.stones) seenMine.add(s);
      if (gBefore.liberties.size === 1 && nextPosition.board[n] === color) {
        const gAfter = findGroup(nextPosition.board, width, height, n);
        if (gAfter.liberties.size > 1) {
          events.push(mkEvent("atari-escaped", "atari", { color, groupSize: gAfter.stones.length }));
        }
      }
    }
  }

  // connection: the played stone merges two or more previously-distinct
  // friendly groups into one. A simple one-group extension does not count
  // — connection.md's sense is specifically joining stones that were not
  // already one group.
  {
    const friendlyGroupIds = new Set();
    for (const n of neighbors(width, height, point)) {
      if (prevPosition.board[n] === color) {
        const g = findGroup(prevPosition.board, width, height, n);
        friendlyGroupIds.add(Math.min(...g.stones));
      }
    }
    if (friendlyGroupIds.size >= 2) {
      events.push(
        mkEvent("connection", "connection", {
          point: pointToCoord(width, point),
          color,
          mergedGroups: friendlyGroupIds.size,
        }),
      );
    }
  }

  // eye-formed: empty points adjacent to the played stone that just
  // transitioned into being a simple eye for `color` (all neighbors now
  // that color) and were not a simple eye immediately before this move.
  for (const n of neighbors(width, height, point)) {
    if (nextPosition.board[n] === 0) {
      const wasEye = isSimpleEye(prevPosition.board, width, height, n, color);
      const isEyeNow = isSimpleEye(nextPosition.board, width, height, n, color);
      if (isEyeNow && !wasEye) {
        events.push(mkEvent("eye-formed", "eye", { point: pointToCoord(width, n), color }));
      }
    }
  }

  return { events, nextActiveKoPoint };
}

/**
 * Annotate a pass — the other kind of turn, which places no stone and so
 * has no board to diff. `endsMainPhase` is true exactly when this pass is
 * the second of two consecutive passes (per pass.md/R12: "two consecutive
 * passes... end the main phase of play"), i.e. the caller's own
 * passStreak has just reached 2; Game decides that, since it is the one
 * tracking the streak across turns.
 */
export function annotatePass(color, endsMainPhase) {
  const events = [mkEvent("pass", "pass", { color })];
  if (endsMainPhase) {
    events.push(mkEvent("game-ended", "pass", { color, trigger: "two-consecutive-passes" }));
  }
  return events;
}
