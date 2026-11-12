/**
 * Generates blind scoring packs for the calibration panel re-label.
 *
 *   npx tsx scripts/make-panel-pack.ts --graders 3 --out ./panel-pack
 *
 * Produces one self-contained HTML file per grader plus a pack-key.json for the operator.
 *
 * WHY A GENERATOR RATHER THAN "SEND THEM THE FIXTURES FILE"
 * The dataset is only worth re-labelling if the labels are independent of the existing ones.
 * data/calibration/fixtures.ts carries, next to every submission, the band I authored, a
 * `label` ("Senior — strong design, blind to the assigned constraint") and a `rationale`
 * explaining exactly what the fixture is testing. Any of those hands the grader the answer.
 * So the pack contains the brief, the five stages and the rubric, and nothing else.
 *
 * Fixture order is shuffled per grader and the fixtures are relabelled A, B, C… because the
 * canonical order descends roughly by quality (F01 ceiling → F07 floor). A grader who
 * notices that ordering starts anchoring on it. The mapping from letter back to fixture id
 * lives ONLY in pack-key.json, which the operator keeps — a grader who opens devtools finds
 * opaque letters, not F01.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { FIXTURES } from "../data/calibration/fixtures";
import rubric from "../data/rubric.json";

const args = process.argv.slice(2);
const argOf = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const GRADERS = Number(argOf("graders", "3"));
const OUT = argOf("out", "./panel-pack");

const AXES = rubric.levels.flatMap((l) =>
  l.axes.map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    level: l.label,
    anchors: (a as { anchors?: Record<string, string> }).anchors ?? {},
    note: (a as { note?: string }).note ?? "",
  }))
);
const BANDS = rubric.scale.bands;

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Deterministic shuffle so a given grader number always produces the same pack. */
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function stageBlock(title: string, body: string): string {
  const content = body?.trim()
    ? `<pre>${esc(body)}</pre>`
    : `<p class="empty">Nothing submitted for this stage.</p>`;
  return `<section class="stage"><h4>${esc(title)}</h4>${content}</section>`;
}

function axisRow(ax: typeof AXES[number], key: string): string {
  const anchors = BANDS.map(
    (b) => `<li><span class="band">${esc(b)}</span><span>${esc(ax.anchors[b] ?? "")}</span></li>`
  ).join("");
  const elsewhere = ax.anchors.scoredElsewhere
    ? `<li class="elsewhere"><span class="band">not this axis</span><span>${esc(ax.anchors.scoredElsewhere)}</span></li>`
    : "";
  const note = ax.note ? `<p class="rule">RULE: ${esc(ax.note)}</p>` : "";
  return `
  <div class="axis" data-axis="${ax.id}" data-key="${key}">
    <div class="axis-head">
      <div>
        <strong>${ax.id} — ${esc(ax.label)}</strong>
        <div class="muted">${esc(ax.description)}</div>
      </div>
      <div class="score-input">
        <input type="number" min="0" max="100" inputmode="numeric"
               aria-label="${ax.id} score" data-role="score">
        <label class="cannot"><input type="checkbox" data-role="na"> cannot assess</label>
      </div>
    </div>
    ${note}
    <details><summary>anchors</summary><ul class="anchors">${anchors}${elsewhere}</ul></details>
    <textarea rows="2" placeholder="Why this score? (optional, but valuable where you are unsure)"
              aria-label="${ax.id} note" data-role="note"></textarea>
  </div>`;
}

function buildHtml(grader: number): { html: string; key: Record<string, string> } {
  const ordered = shuffle(FIXTURES, grader + 1);
  const key: Record<string, string> = {};

  const sections = ordered
    .map((f, i) => {
      const letter = LETTERS[i];
      key[letter] = f.id;
      const s = f.submission;
      return `
<article class="fixture" id="fix-${letter}" data-letter="${letter}">
  <h2>Submission ${letter}</h2>
  <p class="muted">Candidate level stated by the hiring team: <strong>${esc(String(f.role))}</strong></p>

  <details class="brief" open><summary>Problem brief</summary><pre>${esc(s.brief)}</pre></details>

  ${stageBlock("Stage 1 — Clarifying Q&A", s.clarifyingTranscript)}
  ${stageBlock("Stage 2 — Design proposal", s.designProposal)}
  ${stageBlock("Stage 3 — Code", s.code)}
  ${stageBlock("Stage 4 — Response to the twist", s.twistResponse)}
  ${stageBlock("Stage 5 — Debug response", s.debugResponse)}

  <h3>Your scores for Submission ${letter}</h3>
  ${AXES.map((a) => axisRow(a, letter)).join("")}
</article>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>StackScore calibration — grader ${grader}</title>
<style>
  :root { --fg:#1a1a2e; --muted:#667; --line:#dcdce8; --bg:#fff; --surface:#f7f7fb; --accent:#6c63ff; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8f0; --muted:#9a9ab0; --line:#2e2e40; --bg:#14141f; --surface:#1c1c2a; }
  }
  * { box-sizing: border-box; }
  body { font: 15px/1.6 system-ui, sans-serif; color: var(--fg); background: var(--bg);
         max-width: 920px; margin: 0 auto; padding: 2rem 1rem 6rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.25rem; margin-top: 0; }
  h3 { font-size: 1rem; margin: 2rem 0 .75rem; }
  h4 { font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 .4rem; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--surface);
        border: 1px solid var(--line); border-radius: 8px; padding: .9rem; font-size: .84rem;
        font-family: ui-monospace, monospace; margin: 0; }
  .muted { color: var(--muted); font-size: .85rem; }
  .empty { color: var(--muted); font-style: italic; font-size: .85rem; }
  .fixture { border: 1px solid var(--line); border-radius: 12px; padding: 1.4rem; margin: 2.5rem 0; }
  .stage { margin-bottom: 1.2rem; }
  .axis { border: 1px solid var(--line); border-radius: 10px; padding: .9rem; margin-bottom: .8rem; }
  .axis-head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
  .score-input { display: flex; flex-direction: column; gap: .3rem; align-items: flex-end; }
  .score-input input[type=number] { width: 82px; padding: .45rem; font-size: 1rem; font-weight: 700;
        text-align: center; border: 1px solid var(--line); border-radius: 7px;
        background: transparent; color: inherit; }
  .cannot { font-size: .72rem; color: var(--muted); white-space: nowrap; }
  .anchors { list-style: none; padding: 0; margin: .5rem 0 0; font-size: .8rem; }
  .anchors li { display: flex; gap: .6rem; margin-bottom: .25rem; color: var(--muted); }
  .band { font-weight: 800; min-width: 62px; }
  .elsewhere { font-style: italic; }
  .rule { font-size: .8rem; color: #b8860b; margin: .5rem 0 0; }
  textarea { width: 100%; margin-top: .6rem; padding: .5rem; border: 1px solid var(--line);
        border-radius: 7px; background: transparent; color: inherit; font: inherit; font-size: .85rem; }
  details > summary { cursor: pointer; font-size: .82rem; color: var(--muted); }
  .intro { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 1.2rem 1.4rem; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--bg);
         border-top: 1px solid var(--line); padding: .7rem 1rem; display: flex;
         gap: 1rem; align-items: center; justify-content: center; }
  button { background: var(--accent); color: #fff; border: 0; padding: .6rem 1.4rem;
           border-radius: 8px; font-weight: 700; font-size: .9rem; cursor: pointer; }
  #progress { font-size: .85rem; color: var(--muted); }
</style>
</head><body>

<h1>StackScore calibration — grader ${grader}</h1>

<div class="intro">
  <p><strong>What this is.</strong> Ten assessment submissions. Score each one against the
  eleven rubric axes, 0–100, as you would if the candidate were in front of you.</p>

  <p><strong>What we are measuring.</strong> Not you, and not the candidates — the AI judge.
  Its scores are currently checked against bands written by one person, which is not good
  enough to claim accuracy. Your numbers replace those bands.</p>

  <ul>
    <li><strong>Work alone.</strong> Do not discuss with the other graders until everyone has
      submitted. Agreement reached by conversation tells us nothing.</li>
    <li><strong>Use the anchors.</strong> Open the <em>anchors</em> toggle under each axis and
      pick the band first, then position within it. This is the same text the AI is given, and
      the comparison is only meaningful if we are both reading the same scale.</li>
    <li><strong>"Cannot assess" is a real answer.</strong> If a submission carries no signal
      for an axis, tick it rather than guessing a middle number. A guessed 50 is noise we
      will mistake for data.</li>
    <li><strong>Score each axis on its own.</strong> A submission can have excellent
      architecture and terrible cost reasoning. That is two different scores, and telling
      them apart is the entire point of the breakdown.</li>
    <li><strong>The level matters.</strong> Each submission states the level it was pitched
      at. Calibrate to that.</li>
  </ul>

  <p class="muted">About 2–3 hours. One sitting if you can, so your own calibration does not
  drift between the first submission and the last. Your progress is saved in this browser as
  you type; the button at the bottom downloads your results as a file.</p>
</div>

${sections}

<div class="bar">
  <span id="progress"></span>
  <button id="save">Download my results</button>
</div>

<script>
(function () {
  var GRADER = ${grader};
  var STORE = "stackscore-panel-g" + GRADER;

  function cells() { return Array.prototype.slice.call(document.querySelectorAll(".axis")); }

  function read() {
    var out = {};
    cells().forEach(function (c) {
      var letter = c.getAttribute("data-key"), axis = c.getAttribute("data-axis");
      var score = c.querySelector('[data-role=score]').value;
      var na = c.querySelector('[data-role=na]').checked;
      var note = c.querySelector('[data-role=note]').value;
      out[letter + "." + axis] = { score: na ? null : (score === "" ? undefined : Number(score)),
                                   cannotAssess: na, note: note || undefined };
    });
    return out;
  }

  function progress() {
    var all = cells().length, done = 0;
    cells().forEach(function (c) {
      if (c.querySelector('[data-role=na]').checked) { done++; return; }
      if (c.querySelector('[data-role=score]').value !== "") done++;
    });
    document.getElementById("progress").textContent = done + " of " + all + " scored";
    return done === all;
  }

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(read())); } catch (e) {}
    progress();
  }

  function restore() {
    var raw; try { raw = localStorage.getItem(STORE); } catch (e) { return; }
    if (!raw) return;
    var saved; try { saved = JSON.parse(raw); } catch (e) { return; }
    cells().forEach(function (c) {
      var k = c.getAttribute("data-key") + "." + c.getAttribute("data-axis");
      var v = saved[k]; if (!v) return;
      if (v.cannotAssess) c.querySelector('[data-role=na]').checked = true;
      else if (typeof v.score === "number") c.querySelector('[data-role=score]').value = v.score;
      if (v.note) c.querySelector('[data-role=note]').value = v.note;
    });
  }

  document.addEventListener("input", persist);
  document.addEventListener("change", persist);

  document.getElementById("save").addEventListener("click", function () {
    var complete = progress();
    if (!complete && !confirm("Some axes are still blank. Download anyway?")) return;
    var blob = new Blob([JSON.stringify({
      grader: GRADER, submittedAt: new Date().toISOString(), scores: read()
    }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "panel-grader-" + GRADER + ".json";
    a.click();
  });

  restore(); progress();
})();
</script>
</body></html>`;

  return { html, key };
}

mkdirSync(OUT, { recursive: true });
const keys: Record<string, Record<string, string>> = {};
for (let g = 1; g <= GRADERS; g++) {
  const { html, key } = buildHtml(g);
  const file = join(OUT, `grader-${g}.html`);
  writeFileSync(file, html);
  keys[`grader-${g}`] = key;
  console.log(`wrote ${file}  (${Object.keys(key).length} submissions, ${AXES.length} axes each)`);
}
writeFileSync(join(OUT, "pack-key.json"), JSON.stringify(keys, null, 2));
console.log(`wrote ${join(OUT, "pack-key.json")}  <-- OPERATOR ONLY, do not send to graders`);
console.log(`\nEach grader scores ${FIXTURES.length * AXES.length} cells. Send them only their own grader-N.html.`);
