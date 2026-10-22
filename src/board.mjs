// Low-level board representation and geometry.
//
// Geometry is width x height throughout, not size x size: most of this
// kernel only ever plays on square 9/13/19 boards (per the plan), but the
// rules-completeness regression corpus (regression-positions.md) includes
// several genuinely non-square illustrative fragments — e.g. R9's 7x5
// finished-board diagram, R7's 4x3 fragment — and this kernel encodes
// every regression position, not adapted ones, so the board model has to
// support rectangles. Square boards are simply the width===height case;
// `Game` (game.mts) only ever constructs those.
//
// A board is a flat Uint8Array of width*height cells, row-major, with row
// 0 at the top — matching the regression-positions.md diagram convention
// ("rows are numbered top to bottom starting at 1"; row 1 there is array
// row 0 here). Columns use the traditional Go letters, which skip "I" to
// avoid confusion with "1".

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

/** Officially supported competitive play sizes (the platform plan's matchmaking pools by board size). */

// Zobrist keys (zobrist.mts) are precomputed only up to 19x19 = 361 points,
// so that is the hard upper bound on any square board this kernel can hash
// -- not just the three competitive sizes above. Game (game.mts) accepts
// any square size in that range, not only BoardSize, because the
// regression corpus's small fragments (R1's 5x5 ko shape, R4/R5's embedded
// suicide rings, ...) need to run through a real Game to exercise
// ko/suicide end-to-end, not only the pure Position functions.
export function isBoardSize(n) {
  return Number.isInteger(n) && n >= 1 && n <= 19;
}

export function opponent(color) {
  return color === BLACK ? WHITE : BLACK;
}

// Traditional Go column letters: A-H then J-... (I is skipped).
const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export function pointIndex(width, col, row) {
  return row * width + col;
}

/** Parse a Go-notation coordinate like "C3" (skip-I letters, 1-indexed row, row 1 = top) into a point index. */
export function coordToPoint(width, height, coord) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(coord.trim());
  if (!m) throw new Error(`Invalid coordinate: "${coord}"`);
  const letters = m[1].toUpperCase();
  const col = COLUMN_LETTERS.indexOf(letters);
  if (col < 0 || col >= width) {
    throw new Error(`Column out of range for width ${width}: "${coord}"`);
  }
  const row = Number(m[2]) - 1;
  if (row < 0 || row >= height) {
    throw new Error(`Row out of range for height ${height}: "${coord}"`);
  }
  return pointIndex(width, col, row);
}

/** Format a point index back to Go notation. */
export function pointToCoord(width, point) {
  const col = point % width;
  const row = Math.floor(point / width);
  return `${COLUMN_LETTERS[col]}${row + 1}`;
}

export function neighbors(width, height, point) {
  const col = point % width;
  const row = Math.floor(point / width);
  const out = [];
  if (col > 0) out.push(point - 1);
  if (col < width - 1) out.push(point + 1);
  if (row > 0) out.push(point - width);
  if (row < height - 1) out.push(point + width);
  return out;
}

/** Flood-fill the connected group of same-colored stones containing `start`, and its liberties. */
export function findGroup(board, width, height, start) {
  const color = board[start];
  if (color !== BLACK && color !== WHITE) {
    throw new Error(`findGroup called on empty point ${start}`);
  }
  const stones = [];
  const liberties = new Set();
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const p = stack.pop();
    stones.push(p);
    for (const n of neighbors(width, height, p)) {
      const c = board[n];
      if (c === EMPTY) {
        liberties.add(n);
      } else if (c === color && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return { color, stones, liberties };
}

/**
 * Read the source-qualified CONTACT incidence of one occupied connected group.
 *
 * This reuses findGroup (the engine's original occupied same-color reach) and
 * neighbors (its original board adjacency); it does not invent a second
 * connectivity model. Each (stone, endpoint) pair is retained. By contrast,
 * findGroup.liberties is the existential projection to DISTINCT empty endpoints.
 *
 * endpointInjective is true exactly when every liberty has at most one touching
 * stone; when false, the liberty set cannot reconstruct contact incidence.
 *
 * Fixed-position observation only: NOT ko-qualified legal moves, ownership,
 * entanglement entropy, a Crofton geodesic measure, or a strategy score.
 * Only contacts with EMPTY endpoints are liberties. The FULL unit-edge cut
 * delta(group) ALSO includes opponent-stone contacts; the static boundary
 * cut is not automatically a minimum s–t cut or a physical bit-thread flow.
 * Coordinates refer to this source board's row-major points.
 */
export function findGroupBoundaryIncidence(board, width, height, start) {
  const group = findGroup(board, width, height, start);
  const fibers = new Map();
  const contacts = [];
  const oppositionContacts = [];
  const edgeBoundaryContacts = [];
  const members = new Set(group.stones);
  for (const stone of group.stones) {
    for (const endpoint of neighbors(width, height, stone)) {
      if (members.has(endpoint)) continue;
      const exterior = board[endpoint];
      // Connected components are maximal for the original same-colour
      // adjacency. An external adjacent same-colour stone would be a defect.
      if (exterior === group.color)
        throw new Error("group reach missed a same-colour adjacent stone");
      if (exterior === EMPTY) {
        contacts.push(Object.freeze({ stone, endpoint }));
        fibers.set(endpoint, (fibers.get(endpoint) ?? 0) + 1);
      } else {
        oppositionContacts.push(Object.freeze({ stone, endpoint, color: exterior }));
      }
      // This is the FULL graph cut delta(A) between the occupied string A
      // and its complement. Only the EMPTY endpoints are Go liberties.
      edgeBoundaryContacts.push(Object.freeze({
        stone, endpoint, exteriorKind: exterior === EMPTY ? "liberty" : "opposition",
      }));
    }
  }
  const order = (a, b) => a.endpoint - b.endpoint || a.stone - b.stone;
  contacts.sort(order);
  oppositionContacts.sort(order);
  edgeBoundaryContacts.sort(order);
  const liberties = [...group.liberties].sort((a, b) => a - b);
  const sharedLiberties = liberties.filter(endpoint => fibers.get(endpoint) > 1);
  if (contacts.length + oppositionContacts.length !== edgeBoundaryContacts.length)
    throw new Error("source group cut partition is inconsistent");
  return Object.freeze({
    color: group.color,
    stones: Object.freeze([...group.stones].sort((a, b) => a - b)),
    liberties: Object.freeze(liberties),
    contacts: Object.freeze(contacts),
    oppositionContacts: Object.freeze(oppositionContacts),
    edgeBoundaryContacts: Object.freeze(edgeBoundaryContacts),
    unitCutCapacity: edgeBoundaryContacts.length,
    libertiesAreFullCutBoundary: oppositionContacts.length === 0,
    sharedLiberties: Object.freeze(sharedLiberties),
    endpointInjective: sharedLiberties.length === 0,
  });
}

export function createEmptyBoard(width, height) {
  return new Uint8Array(width * height);
}
