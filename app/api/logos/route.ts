import { NextResponse } from "next/server";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "ptg-branding";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
const VISIBLE_SLOTS = new Set(["header", "promo", "social", "appHeader"]);

async function requireSystemAdmin() {
  const session = await getActiveAppSession();
  if (!session) return { response: NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 }) };
  if (session.mustChangePassword) return { response: NextResponse.json({ ok: false, message: "Change your password before continuing." }, { status: 403 }) };
  if (session.role !== "SYSTEM_ADMIN") return { response: NextResponse.json({ ok: false, message: "Only a System Admin can manage logos." }, { status: 403 }) };
  return { session };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "logo";
}

function signatureMatches(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  const current = await admin.storage.getBucket(BUCKET);
  if (!current.error) {
    if (!current.data?.public) throw new Error("The PTG logo bucket must be public so the sign-in screen and print preview can display branding.");
    return;
  }

  const created = await admin.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: Object.keys(ALLOWED),
    fileSizeLimit: "5MB",
  });
  if (created.error) {
    const verify = await admin.storage.getBucket(BUCKET);
    if (verify.error || !verify.data?.public) throw new Error(created.error.message || "Could not prepare logo storage.");
  }
}

async function writeAudit(admin: ReturnType<typeof createAdminClient>, actorUserId: string, action: string, key: string, outcome: "SUCCESS" | "WARNING", message: string) {
  await admin.from("security_audit_logs").insert({
    actor_user_id: actorUserId,
    event_category: "ASSET_MANAGEMENT",
    action,
    target_identifier: key,
    outcome,
    message,
    metadata: { logoKey: key },
  });
}

export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("logo_assets")
    .select("logo_key,storage_path,mime_type,original_file_name,updated_at")
    .in("logo_key", [...VISIBLE_SLOTS]);
  if (error) return NextResponse.json({ ok: false, message: "Could not load saved logos." }, { status: 500 });

  const logos: Record<string, { url: string; originalFileName: string; updatedAt: string }> = {};
  for (const asset of data ?? []) {
    const { data: bucket } = await admin.storage.getBucket(BUCKET);
    if (!bucket?.public) return NextResponse.json({ ok: false, message: "Logo storage is not configured." }, { status: 503 });
    const { data: publicAsset } = admin.storage.from(BUCKET).getPublicUrl(asset.storage_path);
    const separator = publicAsset.publicUrl.includes("?") ? "&" : "?";
    logos[asset.logo_key] = {
      url: publicAsset.publicUrl + separator + "v=" + encodeURIComponent(asset.updated_at),
      originalFileName: asset.original_file_name,
      updatedAt: asset.updated_at,
    };
  }
  return NextResponse.json({ ok: true, logos }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, message: "Request origin is not allowed." }, { status: 403 });
  const auth = await requireSystemAdmin();
  if (auth.response) return auth.response;

  const form = await request.formData();
  const key = String(form.get("key") || "");
  const file = form.get("file");
  if (!VISIBLE_SLOTS.has(key)) return NextResponse.json({ ok: false, message: "Select a valid logo slot." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, message: "Choose an image to upload." }, { status: 400 });
  if (!(file.type in ALLOWED)) return NextResponse.json({ ok: false, message: "Upload a PNG, JPG/JPEG, or WEBP image." }, { status: 400 });
  if (!file.size || file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, message: "Images must be 5 MB or smaller." }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (!signatureMatches(bytes, file.type)) return NextResponse.json({ ok: false, message: "The selected file does not match its image type." }, { status: 400 });

  const admin = createAdminClient();
  try {
    await ensureBucket(admin);
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Could not prepare logo storage." }, { status: 500 });
  }

  const { data: previous, error: previousError } = await admin.from("logo_assets")
    .select("storage_path")
    .eq("logo_key", key)
    .maybeSingle();
  if (previousError) return NextResponse.json({ ok: false, message: "Could not read the current logo." }, { status: 500 });

  const extension = ALLOWED[file.type as keyof typeof ALLOWED];
  const path = key + "/" + crypto.randomUUID() + "." + extension;
  const upload = await admin.storage.from(BUCKET).upload(path, arrayBuffer, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) return NextResponse.json({ ok: false, message: "Logo upload failed." }, { status: 500 });

  const { error: saveError } = await admin.from("logo_assets").upsert({
    logo_key: key,
    storage_path: path,
    mime_type: file.type,
    original_file_name: safeFileName(file.name),
    updated_by: auth.session.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "logo_key" });

  if (saveError) {
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ ok: false, message: "Could not save the logo settings." }, { status: 500 });
  }
  if (previous?.storage_path && previous.storage_path !== path) await admin.storage.from(BUCKET).remove([previous.storage_path]);
  await writeAudit(admin, auth.session.userId, "LOGO_UPLOAD", key, "SUCCESS", "Logo replacement uploaded.");
  return NextResponse.json({ ok: true, message: "Logo uploaded. Refresh the PTG preview to use it." }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, message: "Request origin is not allowed." }, { status: 403 });
  const auth = await requireSystemAdmin();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const key = String(body?.key || "");
  if (!VISIBLE_SLOTS.has(key)) return NextResponse.json({ ok: false, message: "Select a valid logo slot." }, { status: 400 });

  const admin = createAdminClient();
  const { data: current, error: readError } = await admin.from("logo_assets")
    .select("storage_path")
    .eq("logo_key", key)
    .maybeSingle();
  if (readError) return NextResponse.json({ ok: false, message: "Could not read the current logo." }, { status: 500 });

  const { error: deleteError } = await admin.from("logo_assets").delete().eq("logo_key", key);
  if (deleteError) return NextResponse.json({ ok: false, message: "Could not remove the logo setting." }, { status: 500 });
  if (current?.storage_path) await admin.storage.from(BUCKET).remove([current.storage_path]);
  await writeAudit(admin, auth.session.userId, "LOGO_REMOVE", key, "SUCCESS", "Logo replacement removed; built-in artwork will be used.");
  return NextResponse.json({ ok: true, message: "Replacement removed. Built-in artwork will be used." }, { headers: { "Cache-Control": "no-store" } });
}
