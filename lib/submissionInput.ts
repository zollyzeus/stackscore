/**
 * The single definition of "what the candidate submitted".
 *
 * This exists because it was got wrong. The re-judge worker, the pending-scoring drain and
 * the reviewer's submission endpoint were each written with their own copy of the stage/field
 * mapping, and all three used stage `implement` for code where the application actually
 * writes it under `build`. The consequences were not cosmetic:
 *
 *   - a re-judged `partial` score would be computed with NO CODE, so every K axis would read
 *     as unassessable and the candidate's "fixed" score would be worse than the provisional
 *     one it replaced;
 *   - a submission queued during a scoring hold would be scored the same way;
 *   - a human reviewer would be shown an empty code stage and would correctly conclude the
 *     candidate submitted nothing.
 *
 * Three copies of a mapping is three chances to be wrong, and nothing would have failed
 * loudly -- the judge scores an empty submission perfectly happily. So there is now one
 * copy, and `STAGE_FIELDS` is the thing to change if the transcript schema ever moves.
 */
import { extractFromTranscript } from "./transcriptExtract";

/**
 * Stage and field names exactly as the stage APIs write them. `build` is the one that bites:
 * the UI step is called "implement" but the transcript stage is `build`.
 */
export const STAGE_FIELDS = {
  clarify: { stage: "clarify", field: "text" },
  design: { stage: "propose", field: "text" },
  code: { stage: "build", field: "code" },
  twistText: { stage: "adapt", field: "text" },
  twistCode: { stage: "adapt", field: "code" },
  debug: { stage: "debug", field: "code" },
} as const;

export const NO_CODE_PLACEHOLDER =
  "(no build code submitted — candidate may have used pseudo-code or skipped for time)";

export interface SubmissionStages {
  clarifying: string;
  design: string;
  code: string;
  twist: string;
  debug: string;
}

/** Raw stage contents, for showing a human. No placeholders: an empty stage reads as empty. */
export function extractStages(transcript: Record<string, unknown>): SubmissionStages {
  const get = (k: keyof typeof STAGE_FIELDS) =>
    extractFromTranscript(transcript, STAGE_FIELDS[k].stage, STAGE_FIELDS[k].field);

  const twistText = get("twistText");
  const twistCode = get("twistCode");

  return {
    clarifying: get("clarify"),
    design: get("design"),
    code: get("code"),
    // The revised code matters as much as the prose: a candidate who re-implements after the
    // twist has demonstrated adaptability the text alone does not show.
    twist: twistCode.trim() ? `${twistText}\n\n[Revised code after twist]\n${twistCode}` : twistText,
    debug: get("debug"),
  };
}

export interface JudgeInput {
  brief: string;
  clarifyingTranscript: string;
  designProposal: string;
  code: string;
  twistResponse: string;
  debugResponse: string;
}

/**
 * Exactly what /api/evaluate feeds the judge. Every path that scores a submission -- the
 * initial evaluation, a re-judge, a drained hold -- must build its input here, or the same
 * work scores differently depending on which code path happened to reach it.
 */
export function buildJudgeInput(brief: string, transcript: Record<string, unknown>): JudgeInput {
  const s = extractStages(transcript);
  return {
    brief,
    clarifyingTranscript: s.clarifying,
    designProposal: s.design,
    // The placeholder is deliberate and is NOT the same as an empty string: the judge's
    // prompt tells it that code is optional and to score the K axes on evident intent, so it
    // needs to be told the code is absent rather than handed nothing.
    code: s.code || NO_CODE_PLACEHOLDER,
    twistResponse: s.twist,
    debugResponse: s.debug,
  };
}
