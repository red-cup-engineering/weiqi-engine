// Shared Red Cup Go opponent policies; the only implementation consumed by
// local browser play, offline tests and the on-chain Go arena. Rules stay in
// the upstream Weiqi kernel, and each chooser takes that kernel as a port.
// The host's character/actor policy, when installed, may select from these
// legal decision policies but cannot assume this supplies agent memory.
// The scripted local Weiqi opponents.
// (weiqi-platform-plan.md, "Engines and AI": "scripted weak bots first
// (random-legal, greedy-capture, simple-heuristic)"). Five tiers now live
// here, in ascending order: random-legal ("Wandering"), greedy-capture
// ("Grabby"), a liberty-counting Defender ("Watchful"), a simple
// influence heuristic ("Reaching"), and a Monte Carlo tree searcher
// ("Pondering") -- see BOT_TIERS at the bottom of this
// file for the one honest, shared description table, and the app README
// for why none of these carry a kyu/dan claim. All five draw their
// candidates from candidateMoveCoords, which carries the one piece of
// endgame sense every tier shares: never fill your own eyes, contest
// score-improving unclaimed points after an early pass, and stop once
// the engine finds no useful continuation.
//
// Kernel-agnostic by design: this module never imports the kernel itself.
// Every function takes the kernel's module namespace as an explicit `kernel`
// argument instead, so the exact same code runs against the kernel's real
// .mjs sources (Node, via the upstream package) and
// against generated browser .mjs modules (public/js/kernel/*.mjs,
// see public/js/play-app.mjs), without duplicating a single line of rules
// logic. All legality is delegated to `game.isLegal` / `game.play`; this
// module only *chooses* among moves the kernel has already certified legal.
//

/**
 * Every empty point's Go-notation coordinate on `game`'s board, in
 * row-major order.
 */
function emptyPointCoords(game, kernel) {
  const { board, width } = game.current;
  const coords = [];
  for (let point = 0; point < board.length; point++) {
    if (board[point] === kernel.EMPTY) coords.push(kernel.pointToCoord(width, point));
  }
  return coords;
}

/**
 * How many stones a legal move at `coord` would capture, without mutating
 * `game` -- a non-mutating preview built from the kernel's own pure
 * `applyStonePlacement` (public API), exactly as a UI's hover-ghost-stone
 * legality/capture preview would.
 */
function previewCaptureCount(game, kernel, coord) {
  const point = kernel.coordToPoint(game.size, game.size, coord);
  const placement = kernel.applyStonePlacement(game.current, point, game.ruleset);
  if (!placement.ok) return 0;
  return placement.captured.reduce((n, g) => n + g.stones.length, 0);
}

/**
 * Would a kernel-legal placement at `coord` only hurt the mover? True when
 * the move captures nothing and either self-captures (a suicide:legal
 * ruleset), fills a point that is already a simple eye of the mover's own
 * color (every orthogonal neighbor the mover's stone -- the same "simple
 * eye" the kernel's eye-formed event recognizes), or leaves the placed
 * stone's group at a single liberty (self-atari for no gain). Read entirely
 * off the kernel's own placement preview, group reading, and adjacency; no
 * second copy of legality or capture logic.
 */
export function isSelfHarmingMove(game, kernel, coord) {
  const width = game.size;
  const point = kernel.coordToPoint(width, width, coord);
  const { board, toMove: color } = game.current;
  const placement = kernel.applyStonePlacement(game.current, point, game.ruleset);
  if (!placement.ok) return true;
  if (placement.captured.some((group) => group.stones.length > 0)) return false;
  if (placement.selfCaptured) return true;
  if (kernel.neighbors(width, width, point).every((n) => board[n] === color)) return true;
  return kernel.findGroup(placement.position.board, width, width, point).liberties.size <= 1;
}

/**
 * The moves a tier may choose from this turn: every kernel-legal placement
 * that is not self-harming (isSelfHarmingMove). Two endgame rules apply
 * uniformly to every tier, so that a game against any of them can actually
 * reach two passes and a count:
 *   - a bot never fills its own eyes or self-ataris for nothing, and passes
 *     once those are the only legal placements left;
 *   - an opponent's early pass is not automatically a concession of every
 *     unclaimed point. After a pass, a bot keeps a capture available and can
 *     contest neutral points when the engine's own score actually improves.
 *     Territory rules allow non-self-harming development in unowned points
 *     even before it changes the immediate territory count. Already-owned
 *     empty territory stays untouched. When no useful contest remains,
 *     the bot passes and accepts a count.
 * Returns [] exactly when the tier should pass; "pass" itself is always
 * legal but is never listed here. A provisional score is NOT a terminal
 * adjudication: after a pass the player can still fight for an unowned point.
 */
export function candidateMoveCoords(game, kernel) {
  const useful = emptyPointCoords(game, kernel).filter(
    (coord) => game.isLegal(coord) && !isSelfHarmingMove(game, kernel, coord),
  );
  if (game.passStreak === 0) return useful;

  // Passing is a scoring decision, not a signal to give up all unclaimed
  // intersections. Read the ONE Go engine's provisional count and legal
  // continuations; do not invent another territory or capture calculator.
  const before = kernel.countPosition(game);
  const mover = game.current.toMove;
  const advantage = (score) => mover === kernel.BLACK
    ? score.blackScore - score.whiteScore
    : score.whiteScore - score.blackScore;
  const initialAdvantage = advantage(before.score);
  return useful.filter((coord) => {
    if (previewCaptureCount(game, kernel, coord) > 0) return true;
    const point = kernel.coordToPoint(game.size, game.size, coord);
    if (before.ownership[point] === mover) return false; // own territory: don't waste a move
    // A territory-scored group may require several moves to secure a region
    // and need not gain an immediate point from its first legal extension.
    if (before.mode === "territory") return true;
    // The candidate was already verified legal (including ko/superko).
    // Score its pure kernel position rather than forking/replaying an entire
    // game for each empty point; 19x19 can offer hundreds of candidates.
    const placement = kernel.applyStonePlacement(game.current, point, game.ruleset);
    return placement.ok && advantage(kernel.scoreArea(placement.position, game.ruleset)) > initialAdvantage;
  });
}

/**
 * Greedy-capture policy: among this turn's candidate moves, prefer one that
 * captures the most stones; break ties (including the all-zero-captures
 * case, i.e. no capture available) uniformly at random. Returns "pass" when
 * candidateMoveCoords is empty (no useful placement, or the opponent has
 * passed and nothing can be captured).
 */
export function chooseGreedyCaptureMove(game, kernel, rng = Math.random) {
  const legal = candidateMoveCoords(game, kernel);
  if (legal.length === 0) return "pass";
  const scored = legal.map((coord) => ({ coord, captured: previewCaptureCount(game, kernel, coord) }));
  const maxCaptured = Math.max(...scored.map((s) => s.captured));
  const best = maxCaptured > 0 ? scored.filter((s) => s.captured === maxCaptured) : scored;
  return best[Math.floor(rng() * best.length)].coord;
}

/** Uniformly-random legal-move policy -- the plan's "random-legal" bot, and
 * a convenient opponent for exercising the kernel under the smoke test. */
export function chooseRandomLegalMove(game, kernel, rng = Math.random) {
  const legal = candidateMoveCoords(game, kernel);
  if (legal.length === 0) return "pass";
  return legal[Math.floor(rng() * legal.length)];
}

// -------------------------------------------------------------------------
// Bot ladder, rungs 3-4 (Experience Brief item 7 / task item 3): a
// liberty-counting "Defender" and a simple influence heuristic above
// random-legal/greedy-capture. Both remain kernel-agnostic and
// kernel-API-only, exactly like the two bots above: every decision reads
// off values the kernel itself computed (applyStonePlacement's preview,
// findGroup's liberties, neighbors' adjacency) -- neither function
// reimplements legality, capture resolution, or liberty counting; they only
// *choose* among kernel-certified-legal moves using the kernel's own
// numbers. Honest tier naming lives in BOT_TIERS below: "learns-with-you"
// labels, not kyu/dan claims -- see the app README for why, and for the
// plan's later server-side GnuGo/KataGo tier these are not a substitute
// for.
// -------------------------------------------------------------------------

/** Uniform tie-break among `candidates` (each `{ coord, ... }`), via `rng`. */
function pickBest(candidates, rng) {
  return candidates[Math.floor(rng() * candidates.length)].coord;
}

/**
 * Every stone belonging to a `color` group currently at exactly one
 * liberty (in atari), as a Set of point indices -- read straight off
 * `game.current.board` via the kernel's own `findGroup`.
 */
function colorAtariStones(game, kernel, color) {
  const { board, width } = game.current;
  const seen = new Set();
  const atariStones = new Set();
  for (let p = 0; p < board.length; p++) {
    if (board[p] === color && !seen.has(p)) {
      const g = kernel.findGroup(board, width, width, p);
      for (const s of g.stones) seen.add(s);
      if (g.liberties.size === 1) {
        for (const s of g.stones) atariStones.add(s);
      }
    }
  }
  return atariStones;
}

/**
 * The fewest liberties any single opponent group adjacent to `point` has,
 * in `position` (a post-placement preview) -- Infinity when no opponent
 * group is adjacent at all. This is the Defender's one "threat" signal.
 */
function minAdjacentEnemyLiberties(kernel, position, width, point, opp) {
  let min = Infinity;
  const seen = new Set();
  for (const n of kernel.neighbors(width, width, point)) {
    if (position.board[n] === opp && !seen.has(n)) {
      const g = kernel.findGroup(position.board, width, width, n);
      for (const s of g.stones) seen.add(s);
      min = Math.min(min, g.liberties.size);
    }
  }
  return min;
}

/**
 * "Watchful" -- the liberty-counting Defender. In priority order, entirely
 * over kernel-certified-legal moves:
 *   1. Take the biggest available capture (capture-go is decisive; every
 *      tier agrees a capture ends the game, so none of them ever pass one up).
 *   2. If one of the bot's own groups is currently in atari, play a legal
 *      move that actually rescues it (the played stone's resulting group
 *      includes one of those atari'd stones, and ends up with more than one
 *      liberty) -- preferring whichever rescue leaves the most liberties.
 *   3. Otherwise, prefer moves that do not leave the bot's own new stone in
 *      self-atari, when a non-self-atari legal move exists.
 *   4. Among the safe moves, prefer whichever leaves an adjacent enemy
 *      group with the fewest liberties (the most direct pressure this bot
 *      is capable of reading), tie-broken by the bot's own resulting
 *      liberties, then a uniform-random tie-break via `rng`.
 */
export function chooseLibertyCountingMove(game, kernel, rng = Math.random) {
  const legal = candidateMoveCoords(game, kernel);
  if (legal.length === 0) return "pass";

  const color = game.current.toMove;
  const opp = color === kernel.BLACK ? kernel.WHITE : kernel.BLACK;
  const width = game.size;

  const scored = [];
  for (const coord of legal) {
    const point = kernel.coordToPoint(width, width, coord);
    const placement = kernel.applyStonePlacement(game.current, point, game.ruleset);
    if (!placement.ok) continue; // defensive only -- legalMoveCoords already filtered via game.isLegal
    const captured = placement.captured.reduce((n, g) => n + g.stones.length, 0);
    const ownGroup = kernel.findGroup(placement.position.board, width, width, point);
    scored.push({
      coord,
      captured,
      ownLiberties: ownGroup.liberties.size,
      ownStones: new Set(ownGroup.stones),
      pressure: minAdjacentEnemyLiberties(kernel, placement.position, width, point, opp),
    });
  }

  const maxCaptured = Math.max(...scored.map((s) => s.captured));
  if (maxCaptured > 0) {
    return pickBest(scored.filter((s) => s.captured === maxCaptured), rng);
  }

  const atariStones = colorAtariStones(game, kernel, color);
  if (atariStones.size > 0) {
    const rescues = scored.filter(
      (s) => s.ownLiberties > 1 && [...s.ownStones].some((st) => atariStones.has(st)),
    );
    if (rescues.length > 0) {
      const maxLib = Math.max(...rescues.map((s) => s.ownLiberties));
      return pickBest(rescues.filter((s) => s.ownLiberties === maxLib), rng);
    }
  }

  const safe = scored.filter((s) => s.ownLiberties > 1);
  const pool = safe.length > 0 ? safe : scored;
  const minPressure = Math.min(...pool.map((s) => s.pressure));
  const pressured = pool.filter((s) => s.pressure === minPressure);
  const maxLib = Math.max(...pressured.map((s) => s.ownLiberties));
  return pickBest(pressured.filter((s) => s.ownLiberties === maxLib), rng);
}

/**
 * A simple, deliberately explainable influence heuristic: each candidate
 * point scores +2 per own stone / -2 per opponent stone at Chebyshev
 * distance 1, +1/-1 at distance 2, plus a small flat bonus for proximity to
 * the board's own center point -- "build toward open space and your own
 * stones" in its entirety. No group reading, no look-ahead; this is one
 * static rung above Watchful, not a second engine.
 */
function influenceScore(board, width, point, color, opp) {
  const col = point % width;
  const row = Math.floor(point / width);
  let score = 0;
  for (let p = 0; p < board.length; p++) {
    if (board[p] === 0) continue;
    const pc = p % width;
    const pr = Math.floor(p / width);
    const dist = Math.max(Math.abs(pc - col), Math.abs(pr - row));
    if (dist === 0 || dist > 2) continue;
    const weight = dist === 1 ? 2 : 1;
    score += board[p] === color ? weight : -weight;
  }
  const center = (width - 1) / 2;
  const centerDist = Math.abs(col - center) + Math.abs(row - center);
  score += (width - centerDist) * 0.05;
  return score;
}

/**
 * "Reaching" -- Watchful's safety sense (captures first, then avoid
 * self-atari when avoidable) plus `influenceScore` as the tiebreak instead
 * of Watchful's adjacent-pressure reading. The plan's next AI rung
 * ("simple-heuristic," weiqi-platform-plan.md's Engines and AI section)
 * made concrete as a second, differently-shaped heuristic rather than a
 * strictly stronger one -- see the README for why two roughly-equal-strength
 * heuristic bots is the honest description, not "Reaching beats Watchful."
 */
export function chooseInfluenceMove(game, kernel, rng = Math.random) {
  const legal = candidateMoveCoords(game, kernel);
  if (legal.length === 0) return "pass";

  const color = game.current.toMove;
  const opp = color === kernel.BLACK ? kernel.WHITE : kernel.BLACK;
  const width = game.size;
  const { board } = game.current;

  const scored = legal.map((coord) => {
    const point = kernel.coordToPoint(width, width, coord);
    const captured = previewCaptureCount(game, kernel, coord);
    const placement = kernel.applyStonePlacement(game.current, point, game.ruleset);
    const ownLiberties = placement.ok
      ? kernel.findGroup(placement.position.board, width, width, point).liberties.size
      : 0;
    return { coord, captured, ownLiberties, influence: influenceScore(board, width, point, color, opp) };
  });

  const maxCaptured = Math.max(...scored.map((s) => s.captured));
  if (maxCaptured > 0) {
    return pickBest(scored.filter((s) => s.captured === maxCaptured), rng);
  }

  const safe = scored.filter((s) => s.ownLiberties > 1);
  const pool = safe.length > 0 ? safe : scored;
  const maxInfluence = Math.max(...pool.map((s) => s.influence));
  return pickBest(pool.filter((s) => s.influence === maxInfluence), rng);
}

// -------------------------------------------------------------------------
// Rung 5: "Pondering" -- Monte Carlo tree search (UCT) over the candidate
// moves. The first tier that looks past one move, and still no second
// engine: every playout is the kernel's own Game playing random legal moves
// to the end, every playout uses the kernel's own ruleset-selected count, and
// every node of the tree is a kernel-admitted move.
//
// Measured 2026-09-16 on 9x9 against Watchful, ten games each, 400
// playouts: flat Monte Carlo (no tree) won 5; adding the classic playout
// reflexes (capture the stone just played if it is in atari, rescue an own
// group it put in atari) dropped that to 2 -- without ladder reading the
// rescue reflex runs ladders and drowns the signal -- so playouts stay
// uniformly random here. The tree is what turns the same budget into
// strength; see the README for the tree's own measurement.
// -------------------------------------------------------------------------

/** Every empty point on `board` that is not a simple eye of `color` (all
 * orthogonal neighbors `color`) -- the classic playout policy's one rule,
 * so random play never destroys its own groups. */
function playoutCandidates(kernel, board, width, color) {
  const points = [];
  for (let p = 0; p < board.length; p++) {
    if (board[p] !== kernel.EMPTY) continue;
    let ownEye = true;
    for (const n of kernel.neighbors(width, width, p)) {
      if (board[n] !== color) { ownEye = false; break; }
    }
    if (!ownEye) points.push(p);
  }
  return points;
}

/**
 * Play `game` (mutated) out with uniformly random non-eye-filling legal
 * moves until two consecutive passes or `maxMoves`, and return the winner
 * of the engine's actual scoring mode (Chinese area, Japanese territory):
 * BLACK, WHITE, or EMPTY for a draw. A capped playout is a provisional
 * position evaluation, not a claim that the game ended naturally.
 * A move the kernel refuses (ko, superko, suicide) is simply skipped for
 * the next candidate; a side with no legal candidate passes.
 */
export function randomPlayout(game, kernel, rng = Math.random, maxMoves = game.size * game.size * 2) {
  const width = game.size;
  for (let moves = 0; moves < maxMoves && !game.mainPhaseEnded; moves++) {
    const { board, toMove } = game.current;
    const candidates = playoutCandidates(kernel, board, width, toMove);
    let played = false;
    const start = Math.floor(rng() * candidates.length);
    for (let i = 0; i < candidates.length && !played; i++) {
      if (game.play(kernel.pointToCoord(width, candidates[(start + i) % candidates.length])).ok) played = true;
    }
    if (!played) game.play("pass");
  }
  const { score } = kernel.countPosition(game);
  if (score.blackScore > score.whiteScore) return kernel.BLACK;
  if (score.whiteScore > score.blackScore) return kernel.WHITE;
  return kernel.EMPTY;
}

/** Playouts per move by board size: about a second of thinking in the
 * background worker on an ordinary laptop (measured 2026-09-16 in Node 24:
 * a 9x9 playout is about 6ms, a 13x13 one about 5ms, a 19x19 one about
 * 20ms, plus the tree's own expansions: 0.7s, 0.9s, and 1.3s per move). */
export function monteCarloBudget(size) {
  return size <= 9 ? 400 : size <= 13 ? 160 : 40;
}

const UCB_EXPLORATION = 0.7;

/** The point the last stone was placed on, read by diffing the game's last
 * two positions (captures only ever empty points; a pass changes none), or
 * null at the start or after a pass. */
function lastPlacedPoint(game) {
  if (game.history.length < 2) return null;
  const before = game.history[game.history.length - 2].board;
  const after = game.current.board;
  for (let p = 0; p < after.length; p++) {
    if (before[p] === 0 && after[p] !== 0) return p;
  }
  return null;
}

/**
 * The order the root tries its candidates in before any has a result:
 * Watchful's own tactical signals, read off the kernel's placement
 * preview -- stones captured, an own group rescued from atari, an enemy
 * group put in atari, contact with the stone the opponent just played --
 * with Reaching's influence score as a small tie-break toward open space.
 * Only the order of first visits depends on it; results decide the rest.
 */
function rootPrior(game, kernel, point, atariStones, lastPoint) {
  const width = game.size;
  const { board, toMove: color } = game.current;
  const opp = color === kernel.BLACK ? kernel.WHITE : kernel.BLACK;
  const placement = kernel.applyStonePlacement(game.current, point, game.ruleset);
  if (!placement.ok) return -Infinity;
  let prior = influenceScore(board, width, point, color, opp) * 0.1;
  prior += placement.captured.reduce((n, g) => n + g.stones.length, 0) * 4;
  const own = kernel.findGroup(placement.position.board, width, width, point);
  if (own.liberties.size > 1 && own.stones.some((s) => atariStones.has(s))) prior += 3;
  if (minAdjacentEnemyLiberties(kernel, placement.position, width, point, opp) === 1) prior += 2;
  if (lastPoint !== null && kernel.neighbors(width, width, lastPoint).includes(point)) prior += 1;
  // With no local fight, Go openings compete for corners rather than
  // repeating the old static center bonus on every large empty board.
  // These are the upstream ruleset's own star points, not an invented board.
  if (width >= 13 && game.history.length <= Math.floor(width / 2)) {
    const stars = kernel.handicapPoints(width, 4);
    if (stars.includes(kernel.pointToCoord(width, point))) prior += 2.5;
  }
  return prior;
}

function treeNode(coord, mover) {
  return { coord, mover, wins: 0, visits: 0, children: null };
}

/** UCB1 over `children`: any untried child first (in order), else the
 * highest win rate plus exploration bonus. */
function selectChild(children, parentVisits) {
  let best = null;
  let bestValue = -Infinity;
  for (const child of children) {
    if (child.visits === 0) return child;
    const value = child.wins / child.visits + UCB_EXPLORATION * Math.sqrt(Math.log(parentVisits) / child.visits);
    if (value > bestValue) { best = child; bestValue = value; }
  }
  return best;
}

/**
 * Progressive candidate width: searching 40 times across 361 empty points
 * leaves each root child unvisited or visited once. Keep enough width for
 * real alternatives, but reserve repeated visits and opponent responses.
 * The same cap applies to internal nodes, not just the root.
 */
export function searchCandidateWidth(available, playouts) {
  if (!Number.isSafeInteger(available) || available < 0 ||
      !Number.isSafeInteger(playouts) || playouts < 1) {
    throw new TypeError("Search requires a nonnegative legal count and positive integer playout budget");
  }
  return Math.min(available, Math.max(1, Math.floor(Math.sqrt(playouts))), Math.max(1, Math.floor(playouts / 2)));
}

/** Sort actual kernel-legal tactical alternatives, shuffling equal priorities
 * with injected randomness so an empty-board game isn't always the same side.
 * No second rules or scoring engine is involved. */
function rankedMoves(game, kernel, coordinates, rng) {
  const color = game.current.toMove;
  const endangered = colorAtariStones(game, kernel, color);
  const last = lastPlacedPoint(game);
  const choices = coordinates.map((coord) => ({
    coord,
    score: rootPrior(game, kernel, kernel.coordToPoint(game.size, game.size, coord), endangered, last),
  }));
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices.sort((a, b) => b.score - a.score).map((choice) => choice.coord);
}

/** Internal UCT positions need actionable candidate breadth too: otherwise
 * the next turn is as diluted as the 19x19 root used to be. */
function expandChildren(trial, kernel, rng, playouts) {
  const { board, toMove } = trial.current;
  const points = playoutCandidates(kernel, board, trial.size, toMove);
  const width = searchCandidateWidth(points.length, playouts);
  const moves = points.map((point) => kernel.pointToCoord(trial.size, point));
  return rankedMoves(trial, kernel, moves, rng)
    .slice(0, width).map((coord) => treeNode(coord, toMove));
}

/**
 * "Pondering" -- Monte Carlo tree search (UCT) from this turn's candidate
 * moves (candidateMoveCoords, so the endgame rules still apply). Each
 * iteration forks the kernel's full Game (including ko history), walks
 * the tree by UCB1 (root candidates are first tried in rootPrior order),
 * expands a leaf on its second visit, plays the rest out at random
 * (randomPlayout), and credits every node on the path with the result for
 * the side that moved into it. The root child with the most visits is
 * chosen, ties broken by win rate, then `rng`. `options.playouts`
 * overrides the board-size budget (tests use a handful).
 */
export function chooseMonteCarloMove(game, kernel, rng = Math.random, options = {}) {
  const candidates = candidateMoveCoords(game, kernel);
  if (candidates.length === 0) return "pass";
  if (candidates.length === 1) return candidates[0];
  const playouts = options.playouts ?? monteCarloBudget(game.size);
  const limit = searchCandidateWidth(candidates.length, playouts);
  const maxMoves = options.maxPlayoutMoves ?? game.size * game.size * 2;
  const color = game.current.toMove;
  const root = treeNode(null, null);
  root.children = rankedMoves(game, kernel, candidates, rng)
    .slice(0, limit).map((coord) => treeNode(coord, color));

  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const reportEvery = Math.max(1, Math.ceil(playouts / 8));
  for (let iteration = 0; iteration < playouts; iteration++) {
    const trial = game.fork();
    const path = [];
    let node = root;
    while (node.children !== null && node.children.length > 0) {
      const next = selectChild(node.children, node.visits + 1);
      if (!trial.play(next.coord).ok) {
        node.children = node.children.filter((child) => child !== next);
        continue;
      }
      path.push(next);
      node = next;
    }
    if (node.children === null && node.visits > 0 && !trial.mainPhaseEnded) {
      node.children = expandChildren(trial, kernel, rng, playouts);
      while (node.children.length > 0) {
        const next = node.children[0];
        if (trial.play(next.coord).ok) { path.push(next); node = next; break; }
        node.children.shift();
      }
    }
    const winner = randomPlayout(trial, kernel, rng, maxMoves);
    root.visits += 1;
    for (const visited of path) {
      visited.visits += 1;
      if (winner === visited.mover) visited.wins += 1;
      else if (winner === kernel.EMPTY) visited.wins += 0.5;
    }
    if (onProgress && ((iteration + 1) % reportEvery === 0 || iteration + 1 === playouts)) {
      const visited = root.children.filter((child) => child.visits > 0)
        .sort((a, b) => b.visits - a.visits || a.coord.localeCompare(b.coord));
      // Visits are measured evidence of search work, not a claim of a
      // calibrated winning chance or professional playing strength.
      onProgress(Object.freeze({
        completed: iteration + 1, total: playouts,
        explored: visited.length,
        leadingMove: visited[0]?.coord ?? null,
        leadingVisits: visited[0]?.visits ?? 0,
      }));
    }
  }

  const mostVisits = Math.max(...root.children.map((child) => child.visits));
  const finalists = root.children.filter((child) => child.visits === mostVisits);
  const bestRate = Math.max(...finalists.map((child) => child.wins / child.visits));
  return pickBest(finalists.filter((child) => child.wins / child.visits === bestRate), rng);
}

/**
 * The bot ladder, in ascending order, as one honest table -- the single
 * source both the ladder UI and the README's bot-ladder table read from,
 * so the two can never drift apart. `label` is deliberately NOT a kyu/dan
 * rank: none of these bots have been rated against anything, and claiming
 * a rank for a scripted heuristic would be exactly the kind of dishonest
 * strength claim the task's mandate rules out. `chooser` has the same
 * `(game, kernel, rng) => coord | "pass"` signature as every function
 * above.
 */
export const BOT_TIERS = Object.freeze([
  Object.freeze({
    id: "random",
    label: "Wandering",
    tagline: "Plays a uniformly random legal move.",
    description:
      "No plan and no memory of what just happened -- the baseline every other tier is measured against, not a beginner opponent to actually learn from.",
    chooser: chooseRandomLegalMove,
  }),
  Object.freeze({
    id: "greedy",
    label: "Grabby",
    tagline: "Always takes an available capture; otherwise wanders.",
    description:
      "Reactive, not anticipatory: it will take any capture in front of it but never sets one up, and never protects a group before it's already in atari.",
    chooser: chooseGreedyCaptureMove,
  }),
  Object.freeze({
    id: "liberty",
    label: "Watchful",
    tagline: "Counts liberties: rescues its own groups, avoids self-atari, leans on your weakest group.",
    description:
      "The first tier that defends itself on purpose -- it reads its own atari and the liberties of groups next to its candidate moves, using only the kernel's own liberty counts. Still no look-ahead beyond one move.",
    chooser: chooseLibertyCountingMove,
  }),
  Object.freeze({
    id: "influence",
    label: "Reaching",
    tagline: "Watchful's safety sense, aimed by a simple influence heuristic instead of direct pressure.",
    description:
      "Prefers points that build toward open space and its own stones over isolated jabs at yours. A different shape of one-move heuristic, not a deeper one -- see the README before assuming it's simply 'stronger than Watchful.'",
    chooser: chooseInfluenceMove,
  }),
  Object.freeze({
    id: "montecarlo",
    label: "Pondering",
    tagline: "Searches a tree of random playouts, each scored by the engine's own count, and plays the most-explored move.",
    description:
      "The search-tier opponent: bounded progressive-width UCT focuses visits on tactical candidates and explores replies rather than spending its full budget trying each empty point once. The rules engine still judges every move and score. It is not a neural Go engine and can misread ladders; thinking runs off the page thread.",
    chooser: (game, kernel, rng = Math.random, options = {}) => chooseMonteCarloMove(game, kernel, rng, options),
  }),
]);
