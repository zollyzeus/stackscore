"use client";

import { allRows, allColumns } from "../lib/matrix";

interface Props {
  selectedRow: string;
  selectedCol: string;
  onSelect: (rowId: string, colId: string) => void;
}

/**
 * B2B matrix picker — lets a panelist choose the design scope (row) and
 * system constraint (column) before the session starts. Displays the full
 * 5x5 grid with cell highlighting on hover/selection.
 */
export function MatrixPicker({ selectedRow, selectedCol, onSelect }: Props) {
  return (
    <div className="matrix-picker">
      <table>
        <thead>
          <tr>
            <th />
            {allColumns.map((col) => (
              <th key={col.id} className={selectedCol === col.id ? "selected-col" : ""}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allRows.map((row) => (
            <tr key={row.id}>
              <th className={selectedRow === row.id ? "selected-row" : ""}>{row.label}</th>
              {allColumns.map((col) => {
                const isSelected = selectedRow === row.id && selectedCol === col.id;
                return (
                  <td
                    key={col.id}
                    className={`matrix-cell ${isSelected ? "selected" : ""}`}
                    onClick={() => onSelect(row.id, col.id)}
                    title={`${row.label} × ${col.label}`}
                  >
                    {row.id}×{col.id}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {selectedRow && selectedCol && (
        <p className="matrix-selection-label">
          Selected: <strong>{allRows.find((r) => r.id === selectedRow)?.label}</strong> under{" "}
          <strong>{allColumns.find((c) => c.id === selectedCol)?.label}</strong> constraint
        </p>
      )}
    </div>
  );
}
