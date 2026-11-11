import { NextResponse } from "next/server";
import { clearCandidateCookieOptions } from "../../../../lib/candidateAuth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const opts = clearCandidateCookieOptions();
  res.cookies.set(opts.name, opts.value, opts);
  return res;
}
