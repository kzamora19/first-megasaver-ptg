// Resolve Supabase API credentials in Edge Functions without exposing them.
// New projects provide named-key JSON dictionaries; older projects may
// still provide the legacy individual key variables.
export function studioSupabaseKey(getEnv, kind) {
  if (typeof getEnv !== "function" || !["secret", "publishable"].includes(kind)) return "";
  const directName = kind === "secret" ? "SUPABASE_SECRET_KEY" : "SUPABASE_PUBLISHABLE_KEY";
  const dictionaryName = kind === "secret" ? "SUPABASE_SECRET_KEYS" : "SUPABASE_PUBLISHABLE_KEYS";
  const legacyName = kind === "secret" ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY";
  const direct = getEnv(directName);
  if (typeof direct === "string" && direct.length) return direct;
  try {
    const all = JSON.parse(getEnv(dictionaryName) ?? "{}");
    if (all && typeof all === "object" && !Array.isArray(all) &&
      typeof all.default === "string" && all.default.length) return all.default;
  } catch { /* Continue to legacy compatibility. */ }
  const legacy = getEnv(legacyName);
  return typeof legacy === "string" ? legacy : "";
}
