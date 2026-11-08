import { createClient } from "npm:@supabase/supabase-js@2";

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const allowedOrigins = new Set(
  (Deno.env.get("PTG_ALLOWED_ORIGINS") ?? "https://kzamora19.github.io,http://localhost:3000,http://127.0.0.1:3000")
    .split(",").map(value => value.trim()).filter(Boolean),
);
const admin = createClient(projectUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const bucketName = "ptg-branding";
const maxFileBytes = 5 * 1024 * 1024;
const allowedTypes: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const logoSlots = new Set(["header", "promo", "social", "appHeader"]);
const respond = (origin: string, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Vary": "Origin",
  },
});
const cleanName = (value: string) => value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "logo";

type ActiveSession = { id: string; userId: string; role: string; branchId: string | null; mustChangePassword: boolean };

async function activeSession(request: Request): Promise<ActiveSession | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(projectUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return null;
  const id = request.headers.get("x-ptg-session-id");
  if (!id || id.length > 100) return null;
  const { data: row, error } = await admin.from("app_sessions").select("id,user_id,branch_id,session_version,last_activity_at,expires_at,revoked_at")
    .eq("id", id).eq("user_id", authData.user.id).is("revoked_at", null).maybeSingle();
  if (error || !row) return null;
  const expired = Date.now() - new Date(row.last_activity_at).getTime() > 30 * 60 * 1000 || new Date(row.expires_at).getTime() <= Date.now();
  const { data: profile, error: profileError } = await admin.from("user_profiles").select("role_key,is_active,session_version,must_change_password")
    .eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active || Number(profile.session_version) !== Number(row.session_version) || expired) {
    await admin.from("app_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: "EXPIRED_OR_INVALID" }).eq("id", id).is("revoked_at", null);
    return null;
  }
  if (row.branch_id) {
    const { data: branch } = await admin.from("branches").select("status,operational_status").eq("id", row.branch_id).maybeSingle();
    if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") {
      await admin.from("app_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: "BRANCH_UNAVAILABLE" }).eq("id", id).is("revoked_at", null);
      return null;
    }
  }
  await admin.from("app_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  return { id: row.id, userId: authData.user.id, role: profile.role_key, branchId: row.branch_id, mustChangePassword: profile.must_change_password === true };
}

function signatureMatches(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

async function ensureBucket() {
  const current = await admin.storage.getBucket(bucketName);
  if (!current.error) {
    if (!current.data?.public) throw new Error("The PTG logo bucket must be public so the login screen and print preview can display branding.");
    return;
  }
  const created = await admin.storage.createBucket(bucketName, {
    public: true,
    allowedMimeTypes: Object.keys(allowedTypes),
    fileSizeLimit: "5MB",
  });
  if (created.error) {
    const verify = await admin.storage.getBucket(bucketName);
    if (verify.error || !verify.data?.public) throw new Error(created.error.message || "Could not prepare logo storage.");
  }
}

async function audit(actorUserId: string, action: string, key: string, message: string) {
  await admin.from("security_audit_logs").insert({
    actor_user_id: actorUserId,
    event_category: "ASSET_MANAGEMENT",
    action,
    target_identifier: key,
    outcome: "SUCCESS",
    message,
    metadata: { logoKey: key },
  });
}

async function getLogos(origin: string) {
  const { data, error } = await admin.from("logo_assets").select("logo_key,storage_path,mime_type,original_file_name,updated_at").in("logo_key", [...logoSlots]);
  if (error) return respond(origin, { ok: false, message: "Could not load saved logos." }, 500);
  const logos: Record<string, { url: string; originalFileName: string; updatedAt: string }> = {};
  if (data?.length) {
    const { data: bucket } = await admin.storage.getBucket(bucketName);
    if (!bucket?.public) return respond(origin, { ok: false, message: "Logo storage is not configured." }, 503);
    for (const asset of data) {
      const { data: publicAsset } = admin.storage.from(bucketName).getPublicUrl(asset.storage_path);
      const separator = publicAsset.publicUrl.includes("?") ? "&" : "?";
      logos[asset.logo_key] = {
        url: publicAsset.publicUrl + separator + "v=" + encodeURIComponent(asset.updated_at),
        originalFileName: asset.original_file_name,
        updatedAt: asset.updated_at,
      };
    }
  }
  return respond(origin, { ok: true, logos });
}

async function requireSystemAdmin(request: Request, origin: string) {
  const session = await activeSession(request);
  if (!session) return { response: respond(origin, { ok: false, message: "Sign in to continue." }, 401) };
  if (session.mustChangePassword) return { response: respond(origin, { ok: false, message: "Change your password before continuing." }, 403) };
  if (session.role !== "SYSTEM_ADMIN") return { response: respond(origin, { ok: false, message: "Only a System Admin can manage logos." }, 403) };
  return { session };
}

async function uploadLogo(request: Request, origin: string) {
  const auth = await requireSystemAdmin(request, origin);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const key = String(form.get("key") || "");
  const file = form.get("file");
  if (!logoSlots.has(key)) return respond(origin, { ok: false, message: "Select a valid logo slot." }, 400);
  if (!(file instanceof File)) return respond(origin, { ok: false, message: "Choose an image to upload." }, 400);
  if (!(file.type in allowedTypes)) return respond(origin, { ok: false, message: "Upload a PNG, JPG/JPEG, or WEBP image." }, 400);
  if (!file.size || file.size > maxFileBytes) return respond(origin, { ok: false, message: "Images must be 5 MB or smaller." }, 400);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!signatureMatches(bytes, file.type)) return respond(origin, { ok: false, message: "The selected file does not match its image type." }, 400);

  const actor = auth.session!;
  try { await ensureBucket(); }
  catch (error) { return respond(origin, { ok: false, message: error instanceof Error ? error.message : "Could not prepare logo storage." }, 500); }
  const { data: previous, error: previousError } = await admin.from("logo_assets").select("storage_path").eq("logo_key", key).maybeSingle();
  if (previousError) return respond(origin, { ok: false, message: "Could not read the current logo." }, 500);
  const path = key + "/" + crypto.randomUUID() + "." + allowedTypes[file.type];
  const upload = await admin.storage.from(bucketName).upload(path, buffer, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (upload.error) return respond(origin, { ok: false, message: "Logo upload failed." }, 500);
  const { error: saveError } = await admin.from("logo_assets").upsert({
    logo_key: key,
    storage_path: path,
    mime_type: file.type,
    original_file_name: cleanName(file.name),
    updated_by: actor.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "logo_key" });
  if (saveError) {
    await admin.storage.from(bucketName).remove([path]);
    return respond(origin, { ok: false, message: "Could not save the logo settings." }, 500);
  }
  if (previous?.storage_path && previous.storage_path !== path) await admin.storage.from(bucketName).remove([previous.storage_path]);
  await audit(actor.userId, "LOGO_UPLOAD", key, "Logo replacement uploaded.");
  return respond(origin, { ok: true, message: "Logo uploaded. Refresh the PTG preview to use it." });
}

async function removeLogo(request: Request, origin: string) {
  const auth = await requireSystemAdmin(request, origin);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const key = String(body.key || "");
  if (!logoSlots.has(key)) return respond(origin, { ok: false, message: "Select a valid logo slot." }, 400);
  const { data: current, error: readError } = await admin.from("logo_assets").select("storage_path").eq("logo_key", key).maybeSingle();
  if (readError) return respond(origin, { ok: false, message: "Could not read the current logo." }, 500);
  const { error: deleteError } = await admin.from("logo_assets").delete().eq("logo_key", key);
  if (deleteError) return respond(origin, { ok: false, message: "Could not remove the logo setting." }, 500);
  if (current?.storage_path) await admin.storage.from(bucketName).remove([current.storage_path]);
  await audit(auth.session!.userId, "LOGO_REMOVE", key, "Logo replacement removed; built-in artwork will be used.");
  return respond(origin, { ok: true, message: "Replacement removed. Built-in artwork will be used." });
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins.has(origin)) return new Response(JSON.stringify({ ok: false, message: "Request origin is not allowed." }), {
    status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Vary": "Origin",
  } });
  try {
    if (request.method === "GET") return await getLogos(origin);
    if (request.method === "POST") return await uploadLogo(request, origin);
    if (request.method === "DELETE") return await removeLogo(request, origin);
    return respond(origin, { ok: false, message: "Method not allowed." }, 405);
  } catch {
    return respond(origin, { ok: false, message: "Logo service is temporarily unavailable." }, 503);
  }
});
