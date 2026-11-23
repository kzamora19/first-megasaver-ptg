// Explicit PTG role mapping for the gated studios. A generic BRANCH_USER is not a TL.
export const STUDIO_IDS = Object.freeze(["megaframe", "flyer"]);
export const STUDIO_GRANT_LIFETIME_SECONDS = 600;

export function allowedPtgStudioRole(profile) {
  if (!profile || profile.is_active !== true || profile.must_change_password === true) return false;
  if (profile.role_key === "SYSTEM_ADMIN" || profile.role_key === "BRANCH_ADMIN") return true;
  return profile.role_key === "BRANCH_USER"
    && String(profile.legacy_role ?? "").trim().toUpperCase() === "TEAM LEADER";
}
export function validStudioId(value) {
  return typeof value === "string" && STUDIO_IDS.includes(value);
}
export function sessionIsLive(session, profile, time = Date.now()) {
  if (!session || !allowedPtgStudioRole(profile) ||
      session.revoked_at || session.user_id == null ||
      Number(session.session_version) !== Number(profile.session_version)) return false;
  const expires = Date.parse(session.expires_at);
  const lastActivity = Date.parse(session.last_activity_at);
  if (!Number.isFinite(expires) || !Number.isFinite(lastActivity) || expires <= time) return false;
  // Matches PTG session policy: regular idle 30 min; remembered devices 7 days.
  const idleLimit = session.remember_device === true ? 7 * 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
  return lastActivity <= time && time - lastActivity <= idleLimit;
}
