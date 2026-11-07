import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

function matchesSecret(candidate: string, expected: string) {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const expected = process.env.FIRST_ADMIN_SETUP_SECRET;
  if (!expected || expected.length < 32) {
    return NextResponse.json({ ok: false, message: "First-admin setup is not configured on the server." }, { status: 503 });
  }

  let body: { setupSecret?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }
  const candidate = String(body.setupSecret ?? "");
  if (!candidate || candidate.length > 512 || !matchesSecret(candidate, expected)) {
    return NextResponse.json({ ok: false, message: "Setup authorization was not accepted." }, { status: 403 });
  }

  try {
    const bootstrapCode = randomBytes(32).toString("hex").toUpperCase();
    const codeHash = createHash("sha256").update(bootstrapCode).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("issue_ptg_first_admin_bootstrap", {
      p_code_hash: codeHash,
      p_expires_at: expiresAt,
    });
    if (error) throw error;
    if (data !== true) {
      return NextResponse.json({ ok: false, message: "A System Admin account already exists. Bootstrap is permanently closed." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, bootstrapCode, expiresAt }, {
      headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
    });
  } catch {
    return NextResponse.json({ ok: false, message: "Unable to open the one-time setup window." }, { status: 503 });
  }
}
