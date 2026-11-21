// STAGING ONLY. Never expose the server's recovery-secret root in browser code.
// Stable account-scoped draft keys are returned ONLY by a one-time ticket
// EXCHANGE after the PTG role/session check and ticket consumption.
export async function studioDraftMaterial(secret, studio, userId) {
  if (typeof secret !== "string" || secret.length < 32 ||
      !["megaframe","flyer"].includes(studio) ||
      typeof userId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
    throw Error("Secure studio recovery material is not configured.");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw",encoder.encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const derive = async label => {
    const data = encoder.encode("ptg-studio-draft-v1|" + studio + "|" + label + "|" + userId.toLowerCase());
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC",key,data));
    return btoa(String.fromCharCode(...sig)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  };
  return {draftScope:await derive("scope"),draftKey:await derive("key")};
}
