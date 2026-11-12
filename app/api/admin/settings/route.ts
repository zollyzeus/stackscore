import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getAdminEmail } from "../../../../lib/requireAdmin";
import { getSettings, setSetting } from "../../../../lib/settings";
import { getScoringHoldState, setScoringHold } from "../../../../lib/scoringHold";
import { getCalibrationState } from "../../../../lib/calibrationMonitor";
import { logError } from "../../../../lib/logger";

export const dynamic = "force-dynamic";

/** Admin-controlled runtime settings (B5), plus the current calibration/hold state. */

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const [settings, hold, calibration] = await Promise.all([
      getSettings(),
      getScoringHoldState(),
      getCalibrationState(),
    ]);
    return NextResponse.json({
      settings,
      hold,
      calibration: calibration
        ? {
            fingerprint: calibration.fingerprint ?? null,
            lastOkAt: calibration.lastOkAt ?? null,
            lastResult: calibration.lastResult
              ? {
                  ok: calibration.lastResult.ok,
                  checkedAt: calibration.lastResult.checkedAt,
                  fingerprintChanged: calibration.lastResult.fingerprintChanged,
                  failures: calibration.lastResult.assertions.filter((a) => !a.pass),
                  notes: calibration.lastResult.notes,
                }
              : null,
          }
        : null,
    });
  } catch (err) {
    logError("[admin/settings GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const who = (await getAdminEmail(req)) ?? "admin";
    const body = await req.json() as {
      scoringHoldEnabled?: boolean;
      holdActive?: boolean;
      reason?: string;
    };

    if (typeof body.scoringHoldEnabled === "boolean") {
      await setSetting("scoringHoldEnabled", body.scoringHoldEnabled, who);
      console.warn("[admin/settings] scoringHoldEnabled ->", body.scoringHoldEnabled, "by", who);
    }

    // A manual hold is recorded as non-automatic, so the monitor will not release it on
    // the next passing probe. An operator who paused scoring gets to decide when it resumes.
    if (typeof body.holdActive === "boolean") {
      await setScoringHold(
        body.holdActive,
        body.reason?.slice(0, 300) ?? `set manually by ${who}`,
        { by: who },
      );
      console.warn("[admin/settings] scoring hold ->", body.holdActive, "by", who);
    }

    return NextResponse.json({ ok: true, settings: await getSettings(), hold: await getScoringHoldState() });
  } catch (err) {
    logError("[admin/settings POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
