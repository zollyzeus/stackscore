import { NextResponse } from "next/server";
import { getCandidateSession } from "../../../../lib/candidateAuth";

export async function GET() {
  const session = await getCandidateSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, email: session.email, name: session.name });
}
