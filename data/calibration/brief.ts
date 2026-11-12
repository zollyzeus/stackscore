/**
 * The single shared problem brief used by every calibration fixture.
 *
 * Why one brief for all fixtures: calibration measures how the judge maps *submission
 * quality* onto the 0-100 scale. If each fixture used a different brief, a score gap
 * between two fixtures would be confounded by brief difficulty, and a per-axis offset
 * derived from it would be meaningless. Holding the brief constant makes submission
 * quality the only variable, so differences in score are attributable to the thing we
 * are trying to measure.
 *
 * The brief deliberately carries an explicit constraint column (C2: cost ceiling) because
 * axes D3 and D4 score reasoning *against the assigned constraint*. A brief with no hard
 * constraint leaves those two axes with nothing to grade and they drift toward the mean.
 */
export const CALIBRATION_BRIEF = `
PROBLEM: Design and partially implement a rate limiter for a public JSON API.

Context: A B2B analytics API serves ~40 customers. Each customer has an API key. Traffic is
bursty: a customer's nightly batch job can issue 10,000 requests in two minutes, then
nothing for hours. The API runs as 6 stateless containers behind a load balancer.

Current pain: one customer's batch job saturates the shared database connection pool and
degrades latency for everyone else.

ASSIGNED CONSTRAINT COLUMN — C2: COST CEILING.
Your design must stay inside an infrastructure budget of USD 50/month for the rate
limiting layer specifically. You may assume the existing containers and database are
already paid for; anything you add is on the budget. Justify your choices against this
ceiling explicitly.

Requirements:
- Per-customer limits, configurable per customer without a redeploy.
- Must behave correctly with 6 containers serving concurrently.
- A rejected request must return 429 with a Retry-After header.
- Legitimate bursts should not be punished as harshly as sustained abuse.

Stages: (1) ask clarifying questions, (2) propose a design, (3) implement the core limiter
decision function, (4) respond to a twist, (5) debug a provided failing scenario.
`.trim();
