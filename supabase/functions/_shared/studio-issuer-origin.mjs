// Browser origin used for PTG Studio ticket issuance. Mandatory: fail closed.
export function studioIssuerOrigin(value) {
  if(typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value);
    if(u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
       u.pathname !== "/" || !u.hostname || value.trim() !== u.origin && value.trim() !== u.origin + "/")
      return "";
    return u.origin;
  } catch {
    return "";
  }
}
