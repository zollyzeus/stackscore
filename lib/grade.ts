export interface Grade { label: string; color: string; }

export function grade(score: number): Grade {
  if (score >= 85) return { label: "Exceptional", color: "#3ecf8e" };
  if (score >= 70) return { label: "Strong",      color: "#6c63ff" };
  if (score >= 55) return { label: "Proficient",  color: "#5b8aff" };
  if (score >= 40) return { label: "Developing",  color: "#f5a623" };
  return                   { label: "Needs Work",  color: "#f56b6b" };
}
