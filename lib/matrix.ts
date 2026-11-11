import matrix from "../data/matrix.json";

export type MatrixRow = (typeof matrix.rows)[number];
export type MatrixColumn = (typeof matrix.columns)[number];

export interface MatrixCell {
  rowId: string;
  columnId: string;
  rowLabel: string;
  columnLabel: string;
  seed: string;
  pressure: string;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function buildCell(row: MatrixRow, column: MatrixColumn): MatrixCell {
  return {
    rowId: row.id,
    columnId: column.id,
    rowLabel: row.label,
    columnLabel: column.label,
    seed: pickRandom(row.seeds),
    pressure: pickRandom(column.pressures),
  };
}

/** B2C: fully random cell selection. */
export function randomCell(): MatrixCell {
  const row = pickRandom(matrix.rows);
  const column = pickRandom(matrix.columns);
  return buildCell(row, column);
}

/** B2B: panelist picks the row/column explicitly. */
export function manualCell(rowId: string, columnId: string): MatrixCell {
  const row = matrix.rows.find((r) => r.id === rowId);
  const column = matrix.columns.find((c) => c.id === columnId);
  if (!row || !column) {
    throw new Error(`Unknown matrix cell: ${rowId}x${columnId}`);
  }
  return buildCell(row, column);
}

/**
 * Stage-4 twist: a constraint drawn from a column different from the
 * session's original, so the design is tested against a second pressure
 * it wasn't built for.
 */
export function twistColumn(originalColumnId: string): MatrixColumn {
  const candidates = matrix.columns.filter((c) => c.id !== originalColumnId);
  return pickRandom(candidates);
}

export function flagshipCell(): MatrixCell {
  const { row, column } = matrix.flagshipCell;
  return manualCell(row, column);
}

export const allRows = matrix.rows;
export const allColumns = matrix.columns;
