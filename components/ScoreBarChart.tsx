import rubric from "../data/rubric.json";
import type { AxisScores } from "../lib/scoring";

export function ScoreBarChart({ axisScores, stackScore }: { axisScores: AxisScores; stackScore: number }) {
  return (
    <div className="score-card">
      <div className="stack-score">
        <span className="stack-score-value">{stackScore}</span>
        <span className="stack-score-label">StackScore</span>
      </div>

      {rubric.levels.map((level) => (
        <div key={level.id} className="score-level">
          <h3>{level.label}</h3>
          {level.axes.map((axis) => {
            const value = axisScores[axis.id as keyof AxisScores] ?? 0;
            return (
              <div key={axis.id} className="score-bar-row">
                <span className="score-bar-label">{axis.label}</span>
                <div className="score-bar-track">
                  <div className="score-bar-fill" style={{ width: `${value}%` }} />
                </div>
                <span className="score-bar-value">{value}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
