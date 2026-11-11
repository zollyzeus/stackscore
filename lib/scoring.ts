import rubric from "../data/rubric.json";

export type AxisId = "D1" | "D2" | "D3" | "D4" | "D5" | "K1" | "K2" | "K3" | "K4" | "K5" | "K6";

export type AxisScores = Record<AxisId, number>; // each 0-100

export interface AxisFeedback {
  axisId: AxisId;
  score: number;
  feedback: string;
}

export interface ScoreCard {
  axisScores: AxisScores;
  stackScore: number; // 0-100 weighted consolidated score
  levelScores: { design: number; code: number };
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

/**
 * Computes the weighted consolidated StackScore from raw per-axis scores.
 * Uses the static MVP weights in data/rubric.json. Dynamic constraint-based
 * reweighting (rubric.dynamicReweighting) is Phase 2 and intentionally not
 * applied here yet.
 */
export function computeScoreCard(axisScores: AxisScores): ScoreCard {
  let stackScore = 0;
  const levelScores: { design: number; code: number } = { design: 0, code: 0 };

  for (const level of rubric.levels) {
    let levelTotal = 0;
    for (const axis of level.axes) {
      const raw = clamp(axisScores[axis.id as AxisId] ?? 0);
      stackScore += raw * axis.weight;
      levelTotal += raw * (axis.weight / level.weight);
    }
    if (level.id === "design") levelScores.design = Math.round(levelTotal);
    if (level.id === "code") levelScores.code = Math.round(levelTotal);
  }

  return {
    axisScores,
    stackScore: Math.round(stackScore),
    levelScores,
  };
}

export const rubricDefinition = rubric;
