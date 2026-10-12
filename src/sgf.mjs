// SGF (Smart Game Format) parse/serialize.
//
// The low-level layer (parseSgfCollection/serializeSgfCollection) is a
// generic, spec-shaped recursive-descent parser for the SGF grammar
// (Collection = GameTree+; GameTree = "(" Node+ GameTree* ")"), so it can
// read real-world SGF files including variations, not just what this
// kernel itself writes.
//
// The higher-level layer (gameRecordToSgf/sgfToGameRecord) is the
// convenience API game records actually use: a linear sequence of moves
// plus root game-info properties (size, ruleset, komi, handicap). On import
// it follows the first child at each variation fork (SGF's main line);
// alternative branches remain available through parseSgfCollection.
// Export serializes one linear main line; variation authoring is out of scope.

import { BLACK, WHITE, coordToPoint, pointToCoord } from "./board.mjs";

// --- Low-level tree parse/serialize ------------------------------------

export function parseSgfCollection(text) {
  const s = text;
  let i = 0;

  function skipWs() {
    while (i < s.length && /\s/.test(s[i])) i++;
  }

  function parsePropValue() {
    if (s[i] !== "[") throw new Error(`Expected '[' at offset ${i}`);
    i++;
    let out = "";
    while (i < s.length && s[i] !== "]") {
      if (s[i] === "\\" && i + 1 < s.length) {
        // FF[4]: backslash escapes any ordinary next character, but
        // backslash + physical line break is a continuation: remove both.
        // A line break may be CR, LF, CRLF or LFCR.
        const escaped = s[i + 1];
        i += 2;
        if (escaped === "\r" || escaped === "\n") {
          if ((escaped === "\r" && s[i] === "\n") || (escaped === "\n" && s[i] === "\r")) i++;
        } else {
          out += escaped;
        }
      } else {
        out += s[i];
        i++;
      }
    }
    if (s[i] !== "]") throw new Error(`Unterminated property value at offset ${i}`);
    i++;
    return out;
  }

  function parseNode() {
    if (s[i] !== ";") throw new Error(`Expected ';' at offset ${i}`);
    i++;
    const properties = {};
    skipWs();
    while (i < s.length && /[A-Za-z]/.test(s[i])) {
      let ident = "";
      while (i < s.length && /[A-Za-z]/.test(s[i])) {
        ident += s[i];
        i++;
      }
      ident = ident.toUpperCase();
      const values = [];
      skipWs();
      while (s[i] === "[") {
        values.push(parsePropValue());
        skipWs();
      }
      // Property identifiers are unique within an SGF node. Overwriting
      // an earlier SZ, AB or move property would silently change the game.
      if (Object.hasOwn(properties, ident)) {
        throw new Error(`Duplicate SGF property ${ident} at offset ${i}`);
      }
      properties[ident] = values;
      skipWs();
    }
    return { properties };
  }

  function parseGameTree() {
    skipWs();
    if (s[i] !== "(") throw new Error(`Expected '(' at offset ${i}`);
    i++;
    const nodes = [];
    skipWs();
    while (s[i] === ";") {
      nodes.push(parseNode());
      skipWs();
    }
    const children = [];
    skipWs();
    while (s[i] === "(") {
      children.push(parseGameTree());
      skipWs();
    }
    if (s[i] !== ")") throw new Error(`Expected ')' at offset ${i}, found ${JSON.stringify(s[i])}`);
    i++;
    return { nodes, children };
  }

  const trees = [];
  skipWs();
  while (i < s.length) {
    trees.push(parseGameTree());
    skipWs();
  }
  return trees;
}

function escapeValue(v) {
  return v.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function serializeNode(n) {
  let out = ";";
  for (const [key, values] of Object.entries(n.properties)) {
    out += key;
    for (const v of values) out += `[${escapeValue(v)}]`;
  }
  return out;
}

function serializeGameTree(t) {
  let out = "(";
  for (const node of t.nodes) out += serializeNode(node);
  for (const child of t.children) out += serializeGameTree(child);
  out += ")";
  return out;
}

export function serializeSgfCollection(trees) {
  return trees.map(serializeGameTree).join("\n");
}

// --- Coordinates ---------------------------------------------------------
//
// SGF point encoding is its own, unrelated convention: two lowercase
// letters, column then row, both 0-indexed with NO letter skipped (unlike
// Go notation's skip-I board coordinates used elsewhere in this kernel).
// An empty value means pass.

const SGF_LETTERS = "abcdefghijklmnopqrs"; // 19 letters, 0-indexed, a-s (no skip)

export function pointToSgfCoord(size, point) {
  const col = point % size;
  const row = Math.floor(point / size);
  return `${SGF_LETTERS[col]}${SGF_LETTERS[row]}`;
}

export function sgfCoordToPoint(size, v) {
  if (v.length !== 2) throw new Error(`Invalid SGF coordinate: "${v}"`);
  const col = SGF_LETTERS.indexOf(v[0]);
  const row = SGF_LETTERS.indexOf(v[1]);
  if (col < 0 || row < 0 || col >= size || row >= size) {
    throw new Error(`SGF coordinate out of range for size ${size}: "${v}"`);
  }
  return row * size + col;
}

/**
 * A move property's value denotes a pass either as the empty value (the
 * form this kernel writes) or, per the SGF spec, as the legacy "tt" token
 * — valid only for boards <=19x19, where "t" falls outside SGF_LETTERS so
 * "tt" can never be a real coordinate and is unambiguous as a pass sentinel.
 */
function isSgfPass(size, v) {
  return v === "" || (size <= 19 && v === "tt");
}

// --- Game-record convenience layer --------------------------------------

export function gameRecordToSgf(record) {
  const rootProps = {
    GM: ["1"],
    FF: ["4"],
    SZ: [String(record.size)],
  };
  if (record.ruleset !== undefined) rootProps.RU = [record.ruleset];
  if (record.komi !== undefined) rootProps.KM = [String(record.komi)];
  if (record.result !== undefined) rootProps.RE = [record.result];
  if (record.handicap && record.handicap.length > 0) {
    rootProps.HA = [String(record.handicap.length)];
    rootProps.AB = record.handicap.map((c) => pointToSgfCoord(record.size, coordToPoint(record.size, record.size, c)));
  }

  const nodes = [{ properties: rootProps }];
  for (const mv of record.moves) {
    const key = mv.color === BLACK ? "B" : "W";
    const value = mv.point === "pass" ? "" : pointToSgfCoord(record.size, mv.point);
    nodes.push({ properties: { [key]: [value] } });
  }

  return serializeSgfCollection([{ nodes, children: [] }]);
}

/** Follow the SGF main line across tree boundaries; every first child is
 * the continuation, while later children are alternative variations. */
function* mainLineNodes(tree) {
  for (let line = tree; line !== undefined; line = line.children[0]) {
    yield* line.nodes;
  }
}

export function sgfToGameRecord(text) {
  const trees = parseSgfCollection(text);
  if (trees.length === 0) throw new Error("Empty SGF collection");
  const tree = trees[0];
  if (tree.nodes.length === 0) throw new Error("SGF game tree has no nodes");

  const root = tree.nodes[0];
  const szValue = root.properties.SZ?.[0];
  const size = szValue === undefined ? 19 : Number(szValue);
  if (!Number.isInteger(size) || size <= 0) {
    // Most commonly a legal-but-unsupported SZ[width:height] non-square
    // board (this convenience layer only reads/writes square-board game
    // records, per the module comment); reject clearly rather than
    // silently propagating NaN into every downstream point.
    throw new Error(`Unsupported SGF board size: "${szValue}" (only a single positive integer is supported)`);
  }
  const ruleset = root.properties.RU?.[0];
  const komi = root.properties.KM ? Number(root.properties.KM[0]) : undefined;
  const result = root.properties.RE?.[0];
  const handicap = root.properties.AB
    ? root.properties.AB.map((v) => pointToCoord(size, sgfCoordToPoint(size, v)))
    : undefined;
  // HA declares the intended handicap; AB gives its actual placement.
  // Keep that distinction: a root AB without HA could be arbitrary setup
  // stones, and a mismatched HA must not silently become a different game.
  const ha = root.properties.HA?.[0];
  if (ha !== undefined && !/^(?:0|[1-9][0-9]*)$/u.test(ha)) {
    throw new Error(`Invalid SGF handicap count HA[${ha}]`);
  }
  const handicapCount = ha === undefined ? undefined : Number(ha);
  if (handicapCount !== undefined && !Number.isSafeInteger(handicapCount)) {
    throw new Error(`Invalid SGF handicap count HA[${ha}]`);
  }

  const moves = [];
  let mainLineIndex = 0;
  for (const node of mainLineNodes(tree)) {
    // Linear game records cannot faithfully reproduce SGF setup edits.
    // Refuse rather than losing White setup stones, cleared points or
    // non-root additions while telling Study it imported the whole game.
    if (node.properties.AW || node.properties.AE || (mainLineIndex > 0 && node.properties.AB)) {
      throw new Error("SGF setup edits are not supported by linear game records");
    }
    mainLineIndex++;
    if (node.properties.B) {
      const v = node.properties.B[0];
      moves.push({ color: BLACK, point: isSgfPass(size, v) ? "pass" : sgfCoordToPoint(size, v) });
    }
    if (node.properties.W) {
      const v = node.properties.W[0];
      moves.push({ color: WHITE, point: isSgfPass(size, v) ? "pass" : sgfCoordToPoint(size, v) });
    }
  }

  const record = { size, ruleset, komi, handicap, moves };
  if (handicapCount !== undefined) record.handicapCount = handicapCount;
  if (result !== undefined) record.result = result;
  return record;
}
