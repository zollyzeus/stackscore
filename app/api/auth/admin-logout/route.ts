import { NextResponse } from "next/server";
import { clearAdminCookieOptions } from "../../../../lib/adminAuth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const opts = clearAdminCookieOptions();
  res.cookies.set(opts.name, opts.value, opts);
  return res;
}
