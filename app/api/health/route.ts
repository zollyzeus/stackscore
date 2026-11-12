import { NextResponse } from "next/server";
import { db } from "../../../lib/firestore";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — readiness probe for post-deploy smoke tests.
 *
 * Reports whether each required capability is wired up. Deliberately reports only
 * presence/absence of configuration, never any value.
 */
export async function GET() {
  const required = [
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "PANELIST_SECRET",
  ];
  const optional = ["CANDIDATE_SECRET", "ADMIN_SECRET", "CREDENTIAL_SECRET", "ADMIN_EMAILS", "ADMIN_IP_ALLOWLIST", "RESEND_API_KEY", "GOOGLE_CLIENT_ID"];

  const missing = required.filter((k) => !process.env[k]);
  const configured = Object.fromEntries(
    [...required, ...optional].map((k) => [k, Boolean(process.env[k])])
  );

  let firestore: "ok" | "error" = "ok";
  try {
    // Cheapest possible round-trip that proves credentials work.
    await db().collection("_health").doc("probe").get();
  } catch {
    firestore = "error";
  }

  const healthy = missing.length === 0 && firestore === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: process.env.BUILD_VERSION ?? "dev",
      firestore,
      missingRequiredEnv: missing,
      configured,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
