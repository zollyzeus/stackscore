"use client";

export default function PrintButton() {
  return (
    <button className="sc-print-btn" onClick={() => window.print()}>
      🖨 Save as PDF
    </button>
  );
}
