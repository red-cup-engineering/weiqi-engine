# weiqi-engine

`@red-cup-engineering/weiqi-engine` is the deterministic Weiqi specialization of the shared
game-engine contract. It owns Go positions, legality, rulesets, scoring, SGF, and semantic
move events. `./replay` adapts those rules to Cartridge's canonical intent-log, replay, and
state-hash contract; it does not replace SGF as Weiqi's external interchange record. There is
no server, account, key, clock, or AI-provider effect in this package.

The glossary and theory remain at Weiqi's science custodian. Event `termRef` values are stable
`science://lenticule-science/weiqi/terms/<term>` references rather than brittle paths into the
engineering package.

## Doctrine this code implements

- [Rulesets](../../../../../../../../../science-services-section/services/philosophy-services-section/services/relationality-services-section/services/agency-services-section/services/being-services-section/services/doing-services-section/services/playing-services-section/services/gaming-services-section/services/board-games-services-section/services/weiqi-services-section/content/text/documents/articles/teaching-articles/references/rulesets.md) — the five-ruleset
  comparison table (Chinese, Japanese, AGA, New Zealand, Ing) whose stable identifiers
  `rulesets.mjs`'s `RULESETS` object transcribes directly, one ruleset per `Ruleset` record.
- [Regression Positions](../../../../../../../../../science-services-section/services/philosophy-services-section/services/relationality-services-section/services/agency-services-section/services/being-services-section/services/doing-services-section/services/playing-services-section/services/gaming-services-section/services/board-games-services-section/services/weiqi-services-section/content/text/documents/articles/teaching-articles/references/regression-positions.md)
  — thirteen hand-verified board positions (ko, superko, suicide, seki, dead-stone settlement,
  both scoring modes, handicap) that `test/*.test.mjs` assert against by `id` (`R1`, `R6`,
  `R9`, ...), so doctrine and code cite each other rather than drifting apart.

## Running tests

```sh
npm test                 # syntax-check src, scripts and tests; run all Node tests
npm run test:properties  # deterministic, seeded legal-play invariants
npm run test:browser     # upstream browser generator's single-build contract
```

The test layout follows **one owner per invariant**: `test/game.test.mjs`,
`session-commands.test.mjs`, `session-scoring.test.mjs`, `match*.test.mjs`,
`sgf.test.mjs` and `properties.test.mjs` own their respective upstream rules.
`test/helpers/session-fixtures.mjs` supplies one admitted 5×5 wall position
and a move-to-command adapter across scoring, commands and match tests.
Fixture admission fails immediately with the command index and refusal;
a string `"pass"` is converted to a real `{kind:"pass"}` command, never
a fabricated `{kind:"play",move:"pass"}`.

The browser projection test now builds **once** into an isolated temporary
directory, then checks the exact generated module set, provenance, whitespace
and actual ESM imports. The downstream `weiqi-web` package separately owns
checking its *committed browser files* byte-for-byte against this builder.
Those are distinct contracts; neither needs a second implementation of the
browser generator. The property suite drives reproducible seeded game logs,
including full replay, hashes, SGF, liberties, and independently counted area.
Each temporary directory is cleaned in a `finally` block, even on failure.

The checks include board/position mechanics, all declared rulesets, the
reference regression positions, both scoring modes, seki, captures and dead
stones, session/match replay, SGF and semantic events. A full cross-package
release remains the application's `verify:release` responsibility.

## Public API at a glance

Everything re-exports from `src/index.mjs`:

- **`board.mjs`** — `Color`/`Cell` constants (`BLACK`, `WHITE`, `EMPTY`), coordinate
  conversion (`coordToPoint`, `pointToCoord`), `findGroup` (stones + liberties via flood fill).
- **`position.mjs`** — `Position` (immutable: board, `toMove`, prisoner counts, both Zobrist
  hashes), `createEmptyPosition`, `applyStonePlacement` (captures + suicide check),
  `applyPass`. Every mutator returns a new `Position`; none mutate in place.
- **`rulesets.mjs`** — `Ruleset`, the `RULESETS` table (`chinese`/`japanese`/`aga`/`new_zealand`/
  `ing`), `getRuleset(name)`, `handicapPoints(size, count)`.
- **`game.mjs`** — `Game`, the rules-owned history for ko/superko, pass
  streaks, semantic events and game completion. `play(move)` returns a
  `PlayOutcome` (`{ ok: true, events, passStreak }` or
  `{ ok: false, reason: IllegalReason }`); `isLegal(move)` is read-only.
  `fork()` copies the full game-state *history and bookkeeping* for an
  independent continuation, sharing immutable Position values rather than
  replaying moves or treating the current board as an entire game.
  Search engines shall branch through `fork()`: starting `new Game` from
  `current` alone can silently legalize forbidden ko/superko recaptures.
  The existing `countPosition(game, deadPoints)` is now exported through
  `src/index.mjs` for playouts on a mutable Game. It returns the engine's
  ruleset-selected score, mode, settled position and ownership together,
  rather than letting consumers guess whether area or territory applies.
- **`scoring.mjs`** — `computeTerritory` (seki-aware flood fill; returns the two counts plus a
  per-point `ownership` map in the board's own layout), `removeDeadStones`, `scoreArea`,
  `scoreTerritory`. `countPosition` computes territory once and reuses its
  existing result for scoring *and* ownership; standalone `scoreArea` and
  `scoreTerritory` callers may supply that already-computed result as
  an optional third argument, with the default behavior unchanged.
- **`session.mjs`** — the portable versioned-session layer every effect boundary and the browser
  share: `createWeiqiGameSession` (a config may name a fixed-star `handicap`; the stones are
  placed for Black and White moves first), `admitWeiqiGameCommand` (one command at the version
  the caller observed, refusing stale or illegal ones without advancing the record),
  `materializeWeiqiGame`, `scoreWeiqiSession` (counts the current position under the session's
  own ruleset — territory for territory rulesets, area otherwise — with optional agreed dead
  points removed as prisoners, returning the count and the ownership map), and
  `weiqiSessionToSgfRecord` (handicap, komi, and `RE[]` included). Four command kinds:
  `{ kind: "play", move }`, `{ kind: "pass" }`, `{ kind: "resign", color }` (ends the game for
  that color at any time), and `{ kind: "settle", dead }` (admitted only while
  the current pass streak contains at least two consecutive passes; the named
  stones are removed as prisoners and the game is counted and ended, per
  dead-stones.md's rule that settlement is an agreement, never a rules fact).
  The agreed `result.dead` is an immutable *set of actual stones*, listed
  once each in board order using the upstream point formatter. Inputs like
  `A3`, ` a03 `, and `a3` refer to the same point: they credit one
  prisoner, not three. The accepted `session.commands` retains the exact
  submitted command for durable replay. `scoreWeiqiSession` similarly
  deduplicates point aliases, and refuses unoccupied intersections instead
  of silently ignoring invalid dead-stone selections. Dead-stone agreements
  must cover **whole connected stone groups**, never only part of one group.
  `scoring.mjs` owns one `marksWholeDeadGroups` validator built on the
  board's existing `findGroup`, consumed by `Game.settle` and provisional
  session scoring. Partial finalizations return `incomplete-dead-group`;
  provisional score requests refuse the same incomplete group. The lower-level
  `removeDeadStones` stays a pure board operation.
  The engine deliberately keeps `mainPhaseEnded` true after resumed play as a
  historical observation, but a new stone resets `passStreak`: settlement must
  wait for two new passes, not rely on a previous counting phase. The state carries
  `commands`, `handicap`, and `result` (`null` while open; `{ by: "resignation", winner, loser }`
  or `{ by: "count", winner, mode, dead, score }`), and `Game.play` refuses with `game-ended`
  once a result exists. On admission, the engine replays the existing
  immutable command prefix once, applies the new command, and snapshots that
  already-validated Game directly. Creating or independently reconstructing a
  session from an arbitrary command list still replays and validates every
  command; `test/session.test.mjs` checks that both construction paths yield
  structurally identical sessions across sizes, rulesets, handicap, settlement
  and resignation. No mutable Game is retained inside the immutable record.
- **`sgf.mjs`** — a generic recursive-descent SGF parser/serializer
  (`parseSgfCollection`/`serializeSgfCollection`, retaining all variations) plus
  `gameRecordToSgf`/`sgfToGameRecord` for linear game records. On import the
  convenience layer follows the first child at each variation fork, the SGF
  main line, without mixing in alternative branches. Other variations stay
  available in the parsed collection; only variation *authoring* is out of scope.
  The imported record retains SGF `HA` as `handicapCount` (declared number)
  separately from `AB` as `handicap` (the actual Black setup coordinates).
  This prevents consumers from inferring handicaps from arbitrary setup
  stones. Setup edits with `AW`/`AE` or non-root `AB` are refused by the
  linear-record adapter rather than silently omitted; the full tree parser
  still preserves them as SGF properties. SGF FF[4] escaped physical line
  breaks are discarded in property values (including CRLF/LFCR forms), and
  duplicate property identifiers in a node are rejected rather than silently
  overwriting the earlier game-size, setup-stone, or move property.
- **`zobrist.mjs`** — `boardHash` and `situationalHash` are deterministic
  64-bit *fingerprints*, not injective board identifiers. `Game` uses a hash
  match as the fast filter for ko/superko and then checks every board cell
  (and the player to move for situational superko). The independent
  `test/ko-hash-collision.test.mjs` constructs a real XOR dependency among
  65 per-cell keys in GF(2)^64, produces two distinct boards with the
  identical hash, and plays the legal sequence that hash-only superko
  incorrectly refused. True board repetitions still remain illegal.
- **`events.mjs`** — the semantic event layer; see below.
- **`replay.mjs`** — the `@red-cup-engineering/gaming/running` specialization. It accepts only
  `{ kind: "play", move }` and `{ kind: "pass" }`, reconstructs rules-owned state from that
  record, and refuses illegal/tampered intents instead of skipping them.
- **`match.mjs`** — the Node-only durable-match semantic core. It attributes each accepted
  command to one of two principals, requires an injected timestamp and idempotency key, appends
  one Cartridge entry, and derives its session checkpoint and state hash from that log. A play or
  pass belongs to the side to move; a resignation belongs to its own color at any time; a
  settlement may come from either principal only during an **active** two-pass
  counting window, is recorded in the log as a proposal (`pendingSettlement`),
  and is admitted to the engine only when the other principal proposes the
  identical dead set. Any resumed play clears pending settlement; neither a
  historical `mainPhaseEnded` nor a single fresh pass authorizes a proposal. Sockets, account lookup, persistence, presence, and
  clocks remain effect adapters outside this package.

## Semantic event vocabulary

`annotateMove`/`annotatePass` (`events.mjs`) turn one move's before/after position diff into
`SemanticEvent[]`. Each event's `term` is a glossary term slug and its `termRef` is that
term's file path (via `TERM_PATH`), so a UI can hover-card or a post-game timeline can link
straight to this section's own corpus definition — the executable-glossary motto, literally:

| event type | term | termRef |
|---|---|---|
| `atari-given`, `atari-escaped` | `atari` | `atari.md` |
| `capture` | `capture` | `capture.md` |
| `ko-started`, `ko-resolved` | `ko` | `ko.md` |
| `connection` | `connection` | `connection.md` |
| `eye-formed` | `eye` | `eye.md` |
| `group-killed` | `life-and-death` | `life-and-death.md` |
| `pass`, `game-ended` | `pass` | `pass.md` |

`cut`, `false-eye`, `seki`, and `group-settled` are deliberately **not** detected here — each
needs a real life-and-death read (or, for `cut`, a `cut.md` that doesn't exist yet), not a
sound one-move board diff. `events.mjs`'s module doc explains each deferral; house doctrine is
that this code stays a sound model of the theory rather than merely something that runs.
`eye-formed` itself ships only the smallest sound approximation available to a move diff (a
"simple eye": every orthogonal neighbor the same color, no diagonal-control check).
