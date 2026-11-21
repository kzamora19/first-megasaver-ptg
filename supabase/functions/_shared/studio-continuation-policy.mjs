// STAGED ONLY: short-lived, proof-of-possession Studio continuation.
export const STUDIO_PROOF_LIFETIME_SECONDS=7200;
export const STUDIO_CHALLENGE_LIFETIME_SECONDS=120;
export function validPublicKey(jwk){
 return !!jwk && typeof jwk==="object" && !Array.isArray(jwk) &&
   jwk.kty==="EC" && jwk.crv==="P-256" &&
   typeof jwk.x==="string" && /^[A-Za-z0-9_-]{43}$/.test(jwk.x) &&
   typeof jwk.y==="string" && /^[A-Za-z0-9_-]{43}$/.test(jwk.y) &&
   jwk.d===undefined && jwk.alg!=="none";
}
export function validProofRequest(value){
 return !!value && typeof value==="object" && typeof value.sessionId==="string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.sessionId) &&
  typeof value.challenge==="string" && /^[A-Za-z0-9_-]{43}$/.test(value.challenge) &&
  typeof value.signature==="string" && /^[A-Za-z0-9_-]{80,96}$/.test(value.signature);
}
export function proofMessage(studio,sessionId,challenge){
 return "ptg-studio-v1|"+studio+"|"+sessionId+"|"+challenge;
}
