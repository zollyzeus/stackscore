import { NextResponse } from "next/server";
import { getReviewerSession } from "../../../../lib/reviewerAuth";

export async function GET() {
  const session = await getReviewerSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, email: session.email, name: session.name });
}
