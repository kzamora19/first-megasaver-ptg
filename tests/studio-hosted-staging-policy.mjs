// No production fallbacks. Shared by manual hosted acceptance and unit tests.
export const PRODUCTION_REFS=["agknxlowackphvwyvxge","psoopubvdpwztzkdyifa",
  "vmyoxoiygfcecgkbavgg","tzklsscoiwnmeantcefw"];
export function stagingProjectOrigin(raw){
 if(typeof raw!=="string")return "";
 try{
  const u=new URL(raw),m=/^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  if(!m||PRODUCTION_REFS.includes(m[1])||u.protocol!=="https:"||u.username||u.password||
     u.port||u.search||u.hash||u.pathname!=="/"||raw!==u.origin)return "";
  return u.origin;
 }catch{return "";}
}
export function exactIssuerOrigin(raw){
 if(typeof raw!=="string")return "";
 try{
  const u=new URL(raw);
  return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&
    u.pathname==="/"&&raw===u.origin?u.origin:"";
 }catch{return "";}
}
export function requireStageConfig(env){
 if(env.STUDIO_HOSTED_STAGING_APPROVED!=="1")throw Error("Explicit hosted staging approval required");
 const url=stagingProjectOrigin(env.STUDIO_STAGING_SUPABASE_URL);
 if(!url)throw Error("Refused: production or invalid Supabase host");
 const issuer=exactIssuerOrigin(env.STUDIO_STAGING_ISSUER_ORIGIN);
 if(!issuer)throw Error("Refused: exact staging HTTPS issuer required");
 const key=env.STUDIO_STAGING_PUBLISHABLE_KEY;
 if(typeof key!=="string"||key.length<32)throw Error("Refused: staging publishable key missing");
 const mode=env.STUDIO_HOSTED_TEST_MODE;
 if(!["preflight","full"].includes(mode))throw Error("Refused: unknown hosted test mode");
 const config={url,issuer,key,mode};
 if(mode==="full"){
  for(const role of ["ALLOWED","DENIED"]){
   const email=env["STUDIO_STAGING_"+role+"_EMAIL"]||"";
   const password=env["STUDIO_STAGING_"+role+"_PASSWORD"]||"";
   const sessionId=env["STUDIO_STAGING_"+role+"_APP_SESSION_ID"]||"";
   if(!/^studio-ci-[a-z0-9-]+@example\.invalid$/i.test(email)||
      typeof password!=="string"||password.length<16||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId))
    throw Error("Refused: synthetic staging "+role+" account required");
   config[role.toLowerCase()]={email,password,sessionId};
  }
 }
 return config;
}
