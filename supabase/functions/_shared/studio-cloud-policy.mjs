// Development-only PTG-authorized encrypted Studio backup contract.
// Cloud is an explicit opt-in; never silently upload customer images.
export const STUDIO_CLOUD_CIPHERTEXT_LIMIT = 1_200_000;
export const STUDIO_CLOUD_RECORD_LIMIT = 30;
export const cloudKeyAllowed = (studio, key) =>
  studio === "megaframe"
    ? typeof key === "string" && /^project_[A-Za-z0-9_-]{2,100}$/.test(key)
    : studio === "flyer" && key === "p:current";
const base64url = value => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
export function validateCloudMutation(studio, body) {
  if (!body || !cloudKeyAllowed(studio, body.recordKey) ||
      !base64url(body.iv) || body.iv.length !== 16 ||
      !base64url(body.encrypted) || body.encrypted.length < 24 ||
      body.encrypted.length > STUDIO_CLOUD_CIPHERTEXT_LIMIT ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 0 || body.expectedVersion > 2_000_000_000)
    return null;
  return {
    recordKey: body.recordKey,
    iv: body.iv,
    encrypted: body.encrypted,
    expectedVersion: body.expectedVersion,
  };
}
export function cloudActionValid(body) {
  return !!body && ["list", "read", "write"].includes(body.operation);
}
