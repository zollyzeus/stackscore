/**
 * POST /api/tasks/reclaim-bank-packs
 *
 * Returns orphaned scenario bank packs to the available pool.
 * A pack becomes orphaned when generate-problem allocates it with
 * allocatedToSession="__pending__" but the caller never creates a session.
 * Packs older than ORPHAN_TTL_MS are reclaimed.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

export const dynamic = "force-dynamic";

const ORPHAN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-task-runner-secret");
  if (!secret || secret !== process.env.TASK_RUNNER_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const cutoff = new Date(Date.now() - ORPHAN_TTL_MS);
    const snap = await db()
      .collection("scenarioBank")
      .where("status", "==", "allocated")
      .where("allocatedToSession", "==", "__pending__")
      .where("allocatedAt", "<", cutoff)
      .get();

    if (snap.empty) {
      return NextResponse.json({ message: "no_orphans", reclaimed: 0 });
    }

    const batch = db().batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: "available",
        allocatedToSession: null,
        allocatedAt: null,
      });
    });
    await batch.commit();

    return NextResponse.json({ message: "reclaimed", reclaimed: snap.size });
  } catch (err) {
    logError("[reclaim-bank-packs]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
