// Test-only helper: parse the ASCII board diagrams used verbatim in
// regression-positions.md into a Position, so regression tests can be
// transcribed directly from that document's own diagram format rather than
// hand-built cell arrays. Boards are width x height, not size x size — the
// corpus includes several genuinely non-square fragments (e.g. R9's 7x5,
// R7's 4x3), which this kernel's board model supports directly (see the
// note atop src/board.mts).
//
// Diagram format (per regression-positions.md "Diagram format"): a labeled
// grid with a column-letter header row, then one row per board row,
// prefixed with its row number. Cells are separated by single spaces.
// X = Black, O = White, . = empty, * = an empty point of interest (treated
// as empty here — its significance is test-specific, e.g. "the point about
// to be played").

import { BLACK, EMPTY, WHITE } from "../../src/board.mjs";
import { createPositionFromCells } from "../../src/position.mjs";

/**
 * `rows` is the diagram's board-row lines only (no header, no leading row
 * label), one string per row, cells space-separated. `width` is the number
 * of columns; the number of rows (height) is inferred from `rows.length`.
 */
export function parseDiagram(rows, width, toMove = BLACK) {
  const height = rows.length;
  const cells = new Array(width * height).fill(EMPTY);
  const markedPoints = [];
  for (let row = 0; row < height; row++) {
    const symbols = rows[row].trim().split(/\s+/);
    if (symbols.length !== width) {
      throw new Error(`Row ${row + 1}: expected ${width} symbols, got ${symbols.length} ("${rows[row]}")`);
    }
    for (let col = 0; col < width; col++) {
      const sym = symbols[col];
      const point = row * width + col;
      if (sym === "X") cells[point] = BLACK;
      else if (sym === "O") cells[point] = WHITE;
      else if (sym === ".") cells[point] = EMPTY;
      else if (sym === "*") {
        cells[point] = EMPTY;
        markedPoints.push(point);
      } else {
        throw new Error(`Unknown diagram symbol "${sym}" at row ${row + 1}, col ${col + 1}`);
      }
    }
  }
  return { width, height, position: createPositionFromCells(width, height, cells, toMove), markedPoints };
}
