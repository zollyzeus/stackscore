import { NextResponse } from "next/server";
import { clearReviewerCookieOptions } from "../../../../lib/reviewerAuth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const o = clearReviewerCookieOptions();
  res.cookies.set(o.name, o.value, o);
  return res;
}
