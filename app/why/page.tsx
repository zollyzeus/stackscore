export default function WhyStackScore() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "3rem 1.25rem 5rem" }}>
      <style>{`
        .why { line-height: 1.7; }
        .why-logo { font-size: .7rem; font-weight: 800; letter-spacing: .18em; text-transform: uppercase;
          color: var(--accent); margin-bottom: 1.75rem; }
        .why h1 { font-size: clamp(1.6rem, 4vw, 2.4rem); font-weight: 800; letter-spacing: -.02em;
          margin: 0 0 .75rem; text-wrap: balance; line-height: 1.15; }
        .why .subtitle { font-size: 1.05rem; color: var(--text-muted); margin: 0 0 2.5rem;
          max-width: 55ch; line-height: 1.65; }
        .why h2 { font-size: 1.1rem; font-weight: 700; margin: 2.5rem 0 .75rem;
          padding-bottom: .5rem; border-bottom: 1px solid var(--border); }
        .why p { margin: 0 0 1rem; }
        .why strong { color: var(--fg); }

        /* Correlation table */
        .corr-table { width: 100%; border-collapse: collapse; font-size: .85rem;
          border-radius: 10px; overflow: hidden; border: 1px solid var(--border); margin-bottom: 1.5rem; }
        .corr-table th { text-align: left; font-size: .68rem; font-weight: 700; letter-spacing: .07em;
          text-transform: uppercase; color: var(--text-muted); padding: .6rem .9rem;
          background: var(--surface); border-bottom: 1px solid var(--border); }
        .corr-table td { padding: .6rem .9rem; border-bottom: 1px solid var(--border);
          vertical-align: top; font-size: .84rem; }
        .corr-table tr:last-child td { border-bottom: none; }
        .corr-table tr:nth-child(even) td { background: color-mix(in srgb, var(--surface) 60%, var(--bg, #fff)); }
        .axis-id { font-weight: 800; min-width: 2.2rem; display: inline-block; }
        .axis-id.d { color: var(--design-color); }
        .axis-id.k { color: var(--code-color); }

        /* Callout */
        .callout { background: var(--surface); border: 1px solid var(--border);
          border-left: 3px solid var(--accent); border-radius: 0 10px 10px 0;
          padding: 1rem 1.25rem; margin: 1.5rem 0; font-size: .9rem; }
        .callout strong { color: var(--accent); }

        /* Fairness box */
        .fairness { background: color-mix(in srgb, #3ecf8e 8%, var(--surface));
          border: 1px solid #3ecf8e44; border-radius: 10px; padding: 1.25rem 1.4rem; margin: 1.5rem 0; }
        .fairness h3 { font-size: .95rem; font-weight: 700; color: #3ecf8e; margin: 0 0 .5rem; }
        .fairness p { margin: 0; font-size: .88rem; }
        .fairness ul { margin: .5rem 0 0; padding-left: 1.25rem; font-size: .88rem; }
        .fairness li { margin-bottom: .3rem; }

        .back-link { font-size: .82rem; color: var(--text-muted); text-decoration: none; display: inline-block; margin-bottom: 1.5rem; }
        .back-link:hover { color: var(--accent); }
        .cta-row { display: flex; gap: .75rem; flex-wrap: wrap; margin-top: 2rem; }
        .btn-primary { background: var(--accent); color: #fff; padding: .7rem 1.75rem;
          border-radius: 10px; font-weight: 700; font-size: .95rem; text-decoration: none; }
        .btn-ghost { border: 1.5px solid var(--border); color: var(--text-muted);
          padding: .68rem 1.5rem; border-radius: 10px; font-weight: 600; font-size: .95rem; text-decoration: none; }

        /* Competitor comparison */
        .comp-table { width: 100%; border-collapse: collapse; font-size: .82rem;
          border-radius: 10px; overflow: hidden; border: 1px solid var(--border); margin-bottom: 1.5rem; }
        .comp-table th { text-align: left; font-size: .66rem; font-weight: 700; letter-spacing: .07em;
          text-transform: uppercase; color: var(--text-muted); padding: .6rem .9rem;
          background: var(--surface); border-bottom: 1px solid var(--border); }
        .comp-table th:first-child { min-width: 130px; }
        .comp-table td { padding: .55rem .9rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
        .comp-table tr:last-child td { border-bottom: none; }
        .comp-table tr:nth-child(even) td { background: color-mix(in srgb, var(--surface) 60%, var(--bg, #fff)); }
        .check { color: #3ecf8e; font-weight: 700; }
        .cross { color: #f56b6b; }
        .partial { color: #f5a623; }

        /* Feature pills */
        .feature-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: .75rem; margin: 1rem 0 1.5rem; }
        .feature-pill { background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; padding: .75rem 1rem; font-size: .83rem; }
        .feature-pill strong { display: block; font-size: .8rem; margin-bottom: .2rem; color: var(--accent); }
        @media(max-width:500px){.comp-table{font-size:.75rem}}
      `}</style>

      <div className="why">
        <a href="/" className="back-link">← StackScore</a>
        <div className="why-logo">StackScore · Research brief</div>
        <h1>Why StackScore predicts job performance - not just interview performance</h1>
        <p className="subtitle">
          Coding challenges tell you if someone can pass a coding challenge. StackScore tests the behaviours
          that actually determine engineering output quality: how engineers scope problems, design systems under constraint,
          adapt when requirements change, and collaborate with AI tools.
        </p>

        <h2>The problem with existing technical screens</h2>
        <p>
          Most technical assessments are proxy measures. A LeetCode Medium evaluates pattern recognition and
          memorisation under time pressure - skills that correlate weakly with day-to-day engineering output once someone
          is hired. Research from Google&apos;s Project Oxygen (2008–2023) consistently showed that general cognitive ability
          and learning agility outperformed algorithmic puzzle performance as predictors of engineering effectiveness.
        </p>
        <p>
          Hiring teams optimising for coding-screen pass rates are selecting for &ldquo;good at coding screens,&rdquo; not
          necessarily good at shipping reliable software in complex systems.
        </p>

        <h2>What StackScore axes measure - and why they matter</h2>
        <p>
          The 11 axes are designed to measure behaviours with known correlations to engineering effectiveness.
          The table below maps each axis to a real-world engineering outcome or metric.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="corr-table">
            <thead>
              <tr>
                <th>Axis</th>
                <th>What it measures</th>
                <th>Engineering outcome it predicts</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="axis-id d">D1</span> Requirement Framing</td>
                <td>Quality of clarifying questions; scope definition</td>
                <td>Reduction in mid-sprint scope changes; fewer &ldquo;we built the wrong thing&rdquo; incidents</td>
              </tr>
              <tr>
                <td><span className="axis-id d">D2</span> Architecture &amp; Components</td>
                <td>Soundness of proposed system structure</td>
                <td>Lower DORA change failure rate; faster onboarding of new team members</td>
              </tr>
              <tr>
                <td><span className="axis-id d">D3</span> Tradeoff Reasoning</td>
                <td>Explicit justification of design choices against constraints</td>
                <td>DORA lead time for changes; quality of design docs and ADRs</td>
              </tr>
              <tr>
                <td><span className="axis-id d">D4</span> Constraint Satisfaction</td>
                <td>Does the design hold up against the stated constraint - not just mention it</td>
                <td>Fewer post-deploy incidents from architectural mismatches with NFRs</td>
              </tr>
              <tr>
                <td><span className="axis-id d">D5</span> Adaptability</td>
                <td>Response to mid-task requirement change (the &ldquo;twist&rdquo;)</td>
                <td>MTTR when incidents require live re-architecting; sprint velocity after a pivot</td>
              </tr>
              <tr>
                <td><span className="axis-id k">K1</span> Design-Code Alignment</td>
                <td>Implementation faithfulness to the proposed design</td>
                <td>Fewer &ldquo;code doesn&apos;t match spec&rdquo; PR review cycles; lower defect escape rate</td>
              </tr>
              <tr>
                <td><span className="axis-id k">K2</span> Correctness &amp; Edge Cases</td>
                <td>Does it work, including boundary and failure conditions</td>
                <td>Bug density in production; on-call incident frequency attributable to the engineer</td>
              </tr>
              <tr>
                <td><span className="axis-id k">K3</span> Code Quality</td>
                <td>Naming, modularity, separation of concerns</td>
                <td>PR cycle time; ease of onboarding new contributors to their code</td>
              </tr>
              <tr>
                <td><span className="axis-id k">K4</span> Security &amp; Defensive Coding</td>
                <td>Input validation, secrets handling, authz checks</td>
                <td>OWASP-class defect rate; security audit findings attributable to the engineer</td>
              </tr>
              <tr>
                <td><span className="axis-id k">K5</span> Testing &amp; Observability</td>
                <td>Tests written, error handling, instrumentation</td>
                <td>MTTR; alert-to-resolution time; test coverage trends on their PRs</td>
              </tr>
              <tr>
                <td><span className="axis-id k">K6</span> AI Collaboration Quality</td>
                <td>Quality of AI tool usage: prompting, verification, overriding</td>
                <td>Velocity on AI-assisted tasks; defect rate from unreviewed AI-generated code</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="callout">
          <strong>On K6 - AI Collaboration Quality:</strong> As of 2025, over 70% of enterprise engineering teams
          report using AI coding assistants. The differentiating skill is no longer &ldquo;can they use Copilot&rdquo; - it&apos;s
          &ldquo;do they verify, challenge, and critically integrate AI output, or do they blindly accept it.&rdquo;
          K6 is the only standardised axis in the industry designed to measure this.
        </div>

        <h2>The 5-stage format and predictive validity</h2>
        <p>
          Staged assessments that mirror real work outperform decontextualised problem-solving as predictors of
          job performance. StackScore&apos;s five stages replicate the actual arc of an engineering task:
        </p>
        <ul style={{ paddingLeft: "1.4rem", fontSize: ".9rem", display: "flex", flexDirection: "column", gap: ".35rem", marginBottom: "1rem" }}>
          <li><strong>Clarify</strong> - mirrors requirements gathering and stakeholder interviews</li>
          <li><strong>Propose</strong> - mirrors RFC / design doc authoring</li>
          <li><strong>Build</strong> - mirrors implementation sprint</li>
          <li><strong>Adapt</strong> - mirrors responding to production incidents or late-stage requirements changes</li>
          <li><strong>Debug</strong> - mirrors on-call debugging and root cause analysis</li>
        </ul>
        <p>
          Candidates who score strongly on D5 (Adaptability) and K2 (Correctness) have demonstrated
          the behaviours most correlated with strong DORA metrics - specifically, mean time to restore
          and change failure rate - the two metrics most predictive of engineering team health.
        </p>

        <h2>Scoring: behaviour, not background</h2>
        <div className="fairness">
          <h3>We score behaviour, not background</h3>
          <p>StackScore is designed to be education- and credential-neutral. We explicitly do not:</p>
          <ul>
            <li>Ask about CS degrees, alma mater, or prior companies</li>
            <li>Test language-specific trivia or platform-specific API recall</li>
            <li>Use coding interview patterns (tree traversals, sorting algorithms) as proxies</li>
            <li>Penalise for using AI tools - K6 rewards <em>effective</em> AI use</li>
          </ul>
          <p style={{ marginTop: ".5rem" }}>
            The rubric scores how the candidate thinks through a novel problem - framing,
            structuring, adapting, and reasoning about tradeoffs. These capabilities are
            demonstrably more equitable signals than pedigree or pattern memorisation.
          </p>
        </div>

        <h2>How StackScore compares to existing platforms</h2>
        <p>
          Every major technical hiring platform tests a subset of what engineering work actually requires.
          StackScore is the only platform that evaluates the full arc.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="comp-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>HackerRank</th>
                <th>LeetCode / Codility</th>
                <th>CoderPad</th>
                <th>StackScore</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Algorithm / data-structure tests</td>
                <td className="check">✓</td><td className="check">✓</td><td className="check">✓</td><td className="partial">Optional</td>
              </tr>
              <tr>
                <td>System design evaluation</td>
                <td className="cross">✗</td><td className="cross">✗</td><td className="partial">Manual only</td><td className="check">✓ AI-scored</td>
              </tr>
              <tr>
                <td>Requirement clarification stage</td>
                <td className="cross">✗</td><td className="cross">✗</td><td className="cross">✗</td><td className="check">✓</td>
              </tr>
              <tr>
                <td>Adaptability - constraint twist</td>
                <td className="cross">✗</td><td className="cross">✗</td><td className="cross">✗</td><td className="check">✓</td>
              </tr>
              <tr>
                <td>AI collaboration scored</td>
                <td className="cross">✗</td><td className="cross">✗</td><td className="cross">✗</td><td className="check">✓ K6 axis</td>
              </tr>
              <tr>
                <td>Judge reasoning trace (explainability)</td>
                <td className="cross">✗</td><td className="cross">✗</td><td className="cross">✗</td><td className="check">✓ Full audit log</td>
              </tr>
              <tr>
                <td>Employer-verifiable score credential</td>
                <td className="cross">✗</td><td className="cross">✗</td><td className="cross">✗</td><td className="check">✓ /api/verify/slug</td>
              </tr>
              <tr>
                <td>Role-calibrated benchmarks (Jr/Mid/Sr)</td>
                <td className="partial">Basic</td><td className="partial">Basic</td><td className="cross">✗</td><td className="check">✓ Peer percentile</td>
              </tr>
              <tr>
                <td>Multi-attempt improvement tracking</td>
                <td className="cross">✗</td><td className="partial">Partial</td><td className="cross">✗</td><td className="check">✓ Score trajectory</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Built for the full hiring workflow</h2>
        <div className="feature-grid">
          <div className="feature-pill"><strong>Custom assessments</strong>Panelists write their own problem brief, set an expiry, and assign to specific candidates by email.</div>
          <div className="feature-pill"><strong>Live dashboard</strong>Shortlist, hold, or reject candidates. Add notes. Export to CSV. Switch to Kanban view.</div>
          <div className="feature-pill"><strong>Webhook notifications</strong>POST to your ATS or Slack the moment a submission is evaluated.</div>
          <div className="feature-pill"><strong>Side-by-side comparison</strong>Overlay two radar charts to compare candidates on the same axes.</div>
          <div className="feature-pill"><strong>Session integrity</strong>Tab-switch proctoring, 60-minute overall timer, and inactivity monitoring.</div>
          <div className="feature-pill"><strong>Candidate experience</strong>Auto-saves every 30 seconds. Resumable within the time window. Split-pane brief panel always visible.</div>
        </div>

        <h2>AI judging transparency</h2>
        <p>
          Every score card includes the judge&apos;s assessment per axis, the verbatim evidence from the
          transcript that most influenced each score, and - for auditing purposes - the full
          reasoning trace from Claude Opus&apos;s adaptive thinking pass. Hiring managers can read exactly
          why a candidate scored 62 on D3, not just that they did.
        </p>
        <p>
          This transparency is a direct response to the EU AI Act (2025) and EEOC guidance on
          automated employment decision tools: explainability is not optional.
        </p>

        <div className="cta-row">
          <a href="/demo" className="btn-primary">Try a live assessment →</a>
          <a href="/panel" className="btn-ghost">Set up a panel session</a>
        </div>
      </div>
    </main>
  );
}
