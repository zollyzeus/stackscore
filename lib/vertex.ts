import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

// Primary: Gemini 3.8 Flash via Google AI (Gemini API key from aistudio.google.com).
// Fallback: Claude Haiku if Gemini key is missing or call fails.
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GEMINI_MODEL = process.env.VERTEX_MODEL ?? "gemini-3.8-flash";

async function generateWithGemini(prompt: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const result = await genai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return result.text ?? "";
}

async function generateWithClaude(prompt: string): Promise<string> {
  const msg = await claudeClient.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : "";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generate(prompt: string, _temperature = 0.2): Promise<string> {
  try {
    const text = await generateWithGemini(prompt);
    if (text) return text;
  } catch (err) {
    console.warn("[vertex] Gemini unavailable, falling back to Claude Haiku:", err instanceof Error ? err.message : err);
  }
  return generateWithClaude(prompt);
}

export async function generateBrief(input: {
  rowLabel: string;
  columnLabel: string;
  seed: string;
  pressure: string;
}): Promise<string> {
  return generate(
    `You are writing a deliberately underspecified software problem brief for a solutioning assessment.
Design scope: ${input.rowLabel} (e.g. ${input.seed})
Constraint to weave in implicitly (do NOT name the category outright — the candidate must discover it through clarifying questions): ${input.columnLabel} — specifically: ${input.pressure}
Write 4-6 sentences, framed as a stakeholder request, with real ambiguity the candidate must clarify before designing. Do not reveal the evaluation rubric or constraint category name.`,
    0.8
  );
}

export async function stakeholderReply(input: {
  brief: string;
  history: Array<{ role: string; text: string }>;
  question: string;
}): Promise<string> {
  const historyText = input.history
    .map((t) => `${t.role === "candidate" ? "Candidate" : "You"}: ${t.text}`)
    .join("\n");

  return generate(
    `You are a non-technical product stakeholder presenting a problem brief to an engineering candidate.
You know the product context well but have not thought through the technical approach.
Answer questions helpfully but stay in character — do not reveal implementation details, design patterns, or the specific system constraint category being evaluated.
If asked something you wouldn't know as a stakeholder, say so naturally.

Brief:
${input.brief}

Conversation so far:
${historyText}

Candidate's question: ${input.question}

Your reply (2-4 sentences, stakeholder voice):`,
    0.6
  );
}

export async function generateTwist(input: {
  brief: string;
  rowLabel: string;
  twistColumnLabel: string;
  twistPressure: string;
}): Promise<string> {
  return generate(
    `You are injecting a mid-task constraint change into an ongoing engineering solutioning session.
The candidate has just finished proposing and partially implementing a solution for: ${input.rowLabel}.
Original brief: ${input.brief}
New constraint being injected (the candidate's design was NOT built for this): ${input.twistColumnLabel} — specifically: ${input.twistPressure}
Write 3-4 sentences as a stakeholder update that naturally introduces this new requirement without naming the constraint category. Make it feel like a real scope change from leadership, not a test.`,
    0.7
  );
}

export async function generateDefect(code: string): Promise<{ buggedCode: string; hint: string }> {
  const raw = await generate(
    `You are a senior engineer seeding a subtle bug into the following code for a debugging assessment.
Plant exactly ONE non-trivial defect: a logic error, off-by-one, missing edge case, or incorrect assumption — something that would cause a real but non-obvious failure in production. Do not add syntax errors.
Return strict JSON: { "buggedCode": "...", "hint": "one sentence describing the symptom (not the cause) so the candidate knows what to look for" }

Original code:
${code}`,
    0.3
  );

  try {
    return JSON.parse(raw);
  } catch {
    return { buggedCode: code, hint: "Review the code for an off-by-one or missing edge case." };
  }
}
