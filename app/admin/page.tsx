import { cookies, headers } from "next/headers";
import { verifyAdminToken } from "../../lib/adminAuth";
import { isAdmin } from "../../lib/requireAdmin";
import { db, getAllScores } from "../../lib/firestore";
import { getPanelistCreditInfo } from "../../lib/freeCredits";
import { ApproveRejectButtons, RevokePanelistButton, PromoteAdminButton, AwardCreditsButton } from "./actions";
import PanelistManager from "../components/PanelistManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Badge({ status }: { status: "active" | "pending" | "approved" | "rejected" | "inactive" }) {
  const styles: Record<string, { bg: string; color: string }> = {
    active:   { bg: "#3ecf8e22", color: "#3ecf8e" },
    approved: { bg: "#3ecf8e22", color: "#3ecf8e" },
    pending:  { bg: "#f59e0b22", color: "#f59e0b" },
    rejected: { bg: "#ef444422", color: "#ef4444" },
    inactive: { bg: "#ef444422", color: "#ef4444" },
  };
  const s = styles[status] ?? styles.inactive;
  return (
    <span style={{
      display: "inline-block", padding: ".15rem .5rem", borderRadius: 4,
      fontSize: ".68rem", fontWeight: 700, background: s.bg, color: s.color,
    }}>{status}</span>
  );
}

export default async function AdminPage() {
  // IP allowlist check
  const allowlist = process.env.ADMIN_IP_ALLOWLIST;
  const hdrs = headers();
  const forwarded = hdrs.get("x-forwarded-for");
  const clientIp = forwarded ? forwarded.split(",")[0].trim() : null;
  const ipAllowed = allowlist
    ? (clientIp ? allowlist.split(",").map(ip => ip.trim()).includes(clientIp) : false)
    : false;

  if (!ipAllowed) {
    return (
      <main style={{ maxWidth: 480, margin: "6rem auto", padding: "0 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: ".5rem" }}>Access Restricted</h1>
        <p style={{ color: "var(--text-muted)", fontSize: ".9rem" }}>
          This page is only accessible from authorised IP addresses.
        </p>
      </main>
    );
  }

  // Admin auth check — separate from panelist session
  const cookieStore = cookies();
  const token = cookieStore.get("ss_admin")?.value;
  const session = token ? await verifyAdminToken(token).catch(() => null) : null;
  const adminOk = session?.email ? await isAdmin(session.email).catch(() => false) : false;

  if (!adminOk) {
    return (
      <main style={{ maxWidth: 480, margin: "6rem auto", padding: "0 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: ".5rem" }}>Access Denied</h1>
        <p style={{ color: "var(--text-muted)", fontSize: ".9rem" }}>
          You do not have admin access. <a href="/" style={{ color: "var(--accent)" }}>Go home</a>
        </p>
      </main>
    );
  }

  // Fetch all data in parallel
  const [scores, sessionSnap, panelistSnap, pendingRequestsSnap, creditsSnap] = await Promise.all([
    getAllScores(500).catch(() => [] as Record<string, unknown>[]),
    db().collection("sessions").orderBy("createdAt", "desc").limit(500).get().catch(() => null),
    db().collection("panelists").get().catch(() => null),
    db().collection("panelistRequests").where("status", "==", "pending").orderBy("requestedAt", "desc").get().catch(() => null),
    db().collection("credits").get().catch(() => null),
  ]);

  // Overview stats
  const totalSessions = sessionSnap?.size ?? 0;
  const b2bSessions = sessionSnap?.docs.filter(d => d.data().mode === "b2b").length ?? 0;
  const b2cSessions = sessionSnap?.docs.filter(d => d.data().mode === "b2c").length ?? 0;
  const totalScores = scores.length;
  const avgScore = totalScores
    ? Math.round(scores.reduce((s, r) => s + ((r.stackScore as number) ?? 0), 0) / totalScores)
    : 0;
  const flaggedCount = scores.filter(r => r.fastSubmit === true || ((r.tabSwitchCount as number) ?? 0) > 3).length;
  const activePanelists = panelistSnap?.docs.filter(d => d.data().active !== false).length ?? 0;
  const pendingRequests = pendingRequestsSnap?.size ?? 0;

  // Score distribution
  const buckets = { "0-19": 0, "20-39": 0, "40-59": 0, "60-79": 0, "80-100": 0 };
  scores.forEach(r => {
    const s = (r.stackScore as number) ?? 0;
    if (s < 20) buckets["0-19"]++;
    else if (s < 40) buckets["20-39"]++;
    else if (s < 60) buckets["40-59"]++;
    else if (s < 80) buckets["60-79"]++;
    else buckets["80-100"]++;
  });
  const maxBucket = Math.max(...Object.values(buckets), 1);

  // Decision breakdown
  const decisions = { shortlist: 0, hold: 0, reject: 0, undecided: 0 };
  scores.forEach(r => {
    const d = r.decision as string | undefined;
    if (d === "shortlist") decisions.shortlist++;
    else if (d === "hold") decisions.hold++;
    else if (d === "reject") decisions.reject++;
    else decisions.undecided++;
  });
  const totalDecisions = Object.values(decisions).reduce((a, b) => a + b, 0) || 1;

  // Panelist roster with credit info
  const panelistRows = await Promise.all(
    (panelistSnap?.docs ?? []).map(async d => {
      const data = d.data();
      const creditInfo = await getPanelistCreditInfo(d.id).catch(() => ({ freeUsed: 0, freeLimit: 20, purchased: 0, remaining: 20 }));
      return { email: d.id, active: data.active !== false, invitedBy: data.invitedBy as string | undefined, addedAt: data.addedAt as string | undefined, ...creditInfo };
    })
  );

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentActivity = sessionSnap?.docs.filter(d => {
    const ca = d.data().createdAt;
    if (!ca) return false;
    const ts = typeof ca.toDate === "function" ? ca.toDate().getTime() : 0;
    return ts >= sevenDaysAgo;
  }).length ?? 0;

  const pendingItems = pendingRequestsSnap?.docs.map(d => ({ email: d.id, ...d.data() as { requestedAt?: string } })) ?? [];

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "2rem 1.25rem 5rem" }}>
      <style>{`
        .adm-section-title {
          font-size: .72rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
          color: var(--text-muted); margin: 2.5rem 0 1.1rem;
          display: flex; align-items: center; gap: .5rem;
        }
        .adm-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .adm-stats { display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: 1rem; }
        .adm-stat { flex: 1; min-width: 130px; background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 1rem 1.25rem; }
        .adm-stat-val { font-size: 2rem; font-weight: 800; line-height: 1; }
        .adm-stat-lbl { font-size: .68rem; text-transform: uppercase; letter-spacing: .07em;
          color: var(--text-muted); margin-top: .3rem; }
        .adm-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
        .adm-table th { font-size: .68rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
          color: var(--text-muted); padding: .5rem .75rem; text-align: left;
          border-bottom: 1px solid var(--border); }
        .adm-table td { padding: .55rem .75rem;
          border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
        .adm-bar-row { display: flex; align-items: center; gap: .75rem; margin-bottom: .5rem; }
        .adm-bar-label { font-size: .72rem; color: var(--text-muted); min-width: 48px; }
        .adm-bar-track { flex: 1; height: 20px; background: var(--border); border-radius: 4px; overflow: hidden; position: relative; }
        .adm-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; display: flex; align-items: center; padding-left: .4rem; }
        .adm-bar-count { font-size: .7rem; font-weight: 700; color: #fff; }
        .adm-funnel { display: flex; gap: 0; margin-bottom: .5rem; border-radius: 8px; overflow: hidden; height: 32px; }
        .adm-funnel-seg { display: flex; align-items: center; justify-content: center;
          font-size: .72rem; font-weight: 700; color: #fff; min-width: 24px; }
        .adm-empty { font-size: .85rem; color: var(--text-muted); padding: 1.5rem 0; }
        @media(max-width:600px) { .adm-stat-val { font-size: 1.5rem; } }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, margin: "0 0 .2rem" }}>Admin Console</h1>
          <p style={{ fontSize: ".82rem", color: "var(--text-muted)", margin: 0 }}>Signed in as {session?.email}</p>
        </div>
        <a href="/" style={{ fontSize: ".82rem", color: "var(--text-muted)", textDecoration: "none" }}>← Home</a>
      </div>

      {/* Section 1: Overview */}
      <div className="adm-section-title">Overview</div>
      <div className="adm-stats">
        <div className="adm-stat">
          <div className="adm-stat-val">{totalSessions}</div>
          <div className="adm-stat-lbl">Total sessions</div>
        </div>
        <div className="adm-stat">
          <div className="adm-stat-val" style={{ color: "var(--accent)" }}>{totalScores}</div>
          <div className="adm-stat-lbl">Completed assessments</div>
        </div>
        <div className="adm-stat">
          <div className="adm-stat-val" style={{ color: "var(--score-gold, #f59e0b)" }}>{avgScore || "—"}</div>
          <div className="adm-stat-lbl">Avg StackScore</div>
        </div>
        <div className="adm-stat">
          <div className="adm-stat-val">{b2bSessions}<span style={{ fontSize: "1rem", color: "var(--text-muted)" }}> / {b2cSessions}</span></div>
          <div className="adm-stat-lbl">B2B / B2C sessions</div>
        </div>
        <div className="adm-stat">
          <div className="adm-stat-val" style={{ color: activePanelists > 0 ? "#3ecf8e" : "var(--text-muted)" }}>{activePanelists}</div>
          <div className="adm-stat-lbl">Active panelists</div>
        </div>
        <div className="adm-stat">
          <div className="adm-stat-val" style={{ color: flaggedCount > 0 ? "#ef4444" : "inherit" }}>{flaggedCount}</div>
          <div className="adm-stat-lbl">Flagged assessments</div>
        </div>
        <div className="adm-stat">
          <div className="adm-stat-val" style={{ color: pendingRequests > 0 ? "#f59e0b" : "inherit" }}>{pendingRequests}</div>
          <div className="adm-stat-lbl">Pending requests</div>
        </div>
        <div className="adm-stat">
          <div className="adm-stat-val">{recentActivity}</div>
          <div className="adm-stat-lbl">Sessions (7 days)</div>
        </div>
      </div>

      {/* Section 2: Pending Panelist Requests */}
      <div className="adm-section-title">Pending Panelist Requests</div>
      {pendingItems.length === 0 ? (
        <p className="adm-empty">No pending requests.</p>
      ) : (
        <table className="adm-table">
          <thead><tr><th>Email</th><th>Requested</th><th>Actions</th></tr></thead>
          <tbody>
            {pendingItems.map(item => (
              <tr key={item.email}>
                <td style={{ fontWeight: 600 }}>{item.email}</td>
                <td style={{ color: "var(--text-muted)" }}>{fmt(item.requestedAt)}</td>
                <td><ApproveRejectButtons email={item.email} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Section 3: Score Distribution */}
      <div className="adm-section-title">Score Distribution</div>
      {totalScores === 0 ? (
        <p className="adm-empty">No assessments yet.</p>
      ) : (
        <div style={{ maxWidth: 480 }}>
          {Object.entries(buckets).map(([range, count]) => (
            <div key={range} className="adm-bar-row">
              <span className="adm-bar-label">{range}</span>
              <div className="adm-bar-track">
                <div className="adm-bar-fill" style={{ width: `${Math.max(4, (count / maxBucket) * 100)}%` }}>
                  {count > 0 && <span className="adm-bar-count">{count}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section 4: Decision Pipeline */}
      <div className="adm-section-title">Decision Pipeline</div>
      {totalScores === 0 ? (
        <p className="adm-empty">No assessments yet.</p>
      ) : (
        <>
          <div className="adm-funnel">
            {decisions.shortlist > 0 && (
              <div className="adm-funnel-seg" style={{ flex: decisions.shortlist, background: "#3ecf8e" }}>
                {decisions.shortlist}
              </div>
            )}
            {decisions.hold > 0 && (
              <div className="adm-funnel-seg" style={{ flex: decisions.hold, background: "#f59e0b" }}>
                {decisions.hold}
              </div>
            )}
            {decisions.reject > 0 && (
              <div className="adm-funnel-seg" style={{ flex: decisions.reject, background: "#ef4444" }}>
                {decisions.reject}
              </div>
            )}
            {decisions.undecided > 0 && (
              <div className="adm-funnel-seg" style={{ flex: decisions.undecided, background: "var(--border)", color: "var(--text-muted)" }}>
                {decisions.undecided}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "1.5rem", fontSize: ".75rem", color: "var(--text-muted)", marginTop: ".5rem" }}>
            <span><span style={{ color: "#3ecf8e", fontWeight: 700 }}>■</span> Shortlisted ({Math.round(decisions.shortlist / totalDecisions * 100)}%)</span>
            <span><span style={{ color: "#f59e0b", fontWeight: 700 }}>■</span> Hold ({Math.round(decisions.hold / totalDecisions * 100)}%)</span>
            <span><span style={{ color: "#ef4444", fontWeight: 700 }}>■</span> Rejected ({Math.round(decisions.reject / totalDecisions * 100)}%)</span>
            <span><span style={{ color: "var(--text-muted)", fontWeight: 700 }}>■</span> Undecided ({Math.round(decisions.undecided / totalDecisions * 100)}%)</span>
          </div>
        </>
      )}

      {/* Section 5: Panelist Roster — add/remove moved here from the panelist
          dashboard, since granting panelist access is an admin action. */}
      <div className="adm-section-title">Panelist Roster</div>
      <PanelistManager />
      {panelistRows.length === 0 ? (
        <p className="adm-empty">No panelists registered via Firestore (bootstrap admin may be env-var only).</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Free used</th>
                <th>Purchased</th>
                <th>Remaining</th>
                <th>Invited by</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {panelistRows.map(p => (
                <tr key={p.email}>
                  <td style={{ fontWeight: 600 }}>{p.email}</td>
                  <td><Badge status={p.active ? "active" : "inactive"} /></td>
                  <td>{p.freeUsed}/{p.freeLimit}</td>
                  <td>{p.purchased}</td>
                  <td style={{ fontWeight: 700, color: p.remaining <= 0 ? "#ef4444" : "inherit" }}>{p.remaining}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: ".78rem" }}>{p.invitedBy ?? "—"}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: ".78rem" }}>{fmt(p.addedAt)}</td>
                  <td>
                    <span style={{ display: "flex", gap: ".3rem", flexWrap: "wrap" }}>
                      {p.active && <RevokePanelistButton email={p.email} />}
                      <PromoteAdminButton email={p.email} />
                      <AwardCreditsButton email={p.email} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
