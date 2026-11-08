import { NextResponse } from "next/server";

import { getActiveAppSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getActiveAppSession();
  if (!session) {
    return NextResponse.json(
      { ok: false },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      account: {
        username: session.username,
        displayName: session.displayName,
        role: session.role,
        branchCode: session.branchCode,
        branchName: session.branchName,
        legacyRole: session.legacyRole,
        mustChangePassword: session.mustChangePassword,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
