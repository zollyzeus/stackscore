import { NextRequest, NextResponse } from "next/server";
import { getScoreBySlug } from "../../../../lib/firestore";
import { signCredential, credentialKeyId } from "../../../../lib/credential";
import { logError } from "../../../../lib/logger";

/**
 * GET /api/verify/:slug — public, CORS-open credential verification.
 *
 * Returns a signed attestation so a third party can check a StackScore without having to
 * trust this endpoint's transport: the `signature` covers the `claims` object verbatim and
 * can be checked against the public key at /api/verify/jwks.
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const doc = await getScoreBySlug(params.slug);
    if (!doc) return NextResponse.json({ verified: false, reason: "not_found" }, { status: 404 });

    const createdAt = doc.createdAt as { toDate?: () => Date } | undefined;
    const evaluatedAt = typeof createdAt?.toDate === "function"
      ? createdAt.toDate().toISOString()
      : null;

    // The signed claim set. Keep this stable and minimal — adding fields changes what
    // existing verifiers can check.
    const claims = {
      slug: params.slug,
      stackScore: doc.stackScore as number,
      levelScores: doc.levelScores as { design: number; code: number },
      role: (doc.role as string) ?? "Mid",
      evaluatedAt,
      issuer: "StackScore · AI-judged Engineering Assessment",
    };

    const signature = await signCredential(claims);

    return NextResponse.json({
      verified: true,
      claims,
      signature,
      keyId: credentialKeyId(),
      alg: "HS256-detached",
      // Unsigned, informational extras.
      axes: doc.axisScores,
      scoreCardUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://stackscore.anandrajendran.dev"}/score/${params.slug}`,
    });
  } catch (err) {
    logError("[verify]", err);
    return NextResponse.json({ verified: false, reason: "error" }, { status: 500 });
  }
}
