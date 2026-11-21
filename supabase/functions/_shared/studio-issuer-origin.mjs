// Browser origin used for PTG Studio ticket issuance. Mandatory: fail closed.
export function studioIssuerOrigin(value) {
  if(typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value);
    if(u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
       u.pathname !== "/" || !/^[a-z0-9.-]+$/i.test(u.hostname) || u.hostname.includes("..") || (value.trim() !== u.origin && value.trim() !== u.origin + "/"))
      return "";
    return u.origin;
  } catch {
    return "";
  }
}
