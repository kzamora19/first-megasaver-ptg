import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {studioIssuerOrigin} from "../supabase/functions/_shared/studio-issuer-origin.mjs";

test("PTG Studio issuer accepts one explicit HTTPS origin only",()=>{
  assert.equal(studioIssuerOrigin("https://kzamora19.github.io"),"https://kzamora19.github.io");
  assert.equal(studioIssuerOrigin("https://kzamora19.github.io/"),"https://kzamora19.github.io");
  for(const input of [""," ",undefined,"http://kzamora19.github.io",
    "https://kzamora19.github.io/first-megasaver-ptg",
    "https://kzamora19.github.io/?tenant=other",
    "https://kzamora19.github.io/#token",
    "https://a:b@kzamora19.github.io",
    "*.github.io","https://*.github.io","javascript:alert(1)"]){
    assert.equal(studioIssuerOrigin(input),"",String(input));
  }
});

const edge=readFileSync(new URL("../supabase/functions/ptg-studio-access/index.ts",import.meta.url),"utf8");
const portal=readFileSync(new URL("../app/studios/page.tsx",import.meta.url),"utf8");
test("PTG Studio edge gate fails closed when issuer origin is unset",()=>{
  assert.match(edge,/studioIssuerOrigin\(Deno\.env\.get\("PTG_STUDIO_ISSUER_ORIGIN"\)\)/);
  assert.match(edge,/if\(!issuerOrigin\)return json\(\{ok:false/);
  assert.doesNotMatch(edge,/first-megasaver-ptg\.vercel\.app/);
  assert.match(edge,/validSourceSession/);
});
test("launcher does not silently fall back to public editor or old Vercel URLs",()=>{
  assert.match(portal,/NEXT_PUBLIC_STUDIO_MEGAFRAME_LAUNCH_URL/);
  assert.match(portal,/NEXT_PUBLIC_STUDIO_FLYER_LAUNCH_URL/);
  assert.match(portal,/Secure Studio destination has not been configured/);
  assert.match(portal,/disabled=\{busy!==null\|\|!destinations\[studio\]\.url\}/);
  assert.doesNotMatch(portal,/vercel\.app/);
  assert.doesNotMatch(portal,/https:\/\/kzamora19\.github\.io\/flyer-studio\//);
});

test("protected launch URLs must be exact Studio-specific Pages paths, never legacy editor roots",()=>{
  assert.match(portal,/target\.origin!=="https:\/\/kzamora19\.github\.io"/);
  assert.match(portal,/\/megaframe-studio\/studio\//);
  assert.match(portal,/\/flyer-studio\/studio\//);
  assert.match(portal,/target\.pathname!==path/);
  assert.match(portal,/target\.hash\|\|target\.search/);
  assert.doesNotMatch(portal,/studioLaunchUrl\(process\.env\.NEXT_PUBLIC_STUDIO_MEGAFRAME_LAUNCH_URL\)/);
  assert.doesNotMatch(portal,/studioLaunchUrl\(process\.env\.NEXT_PUBLIC_STUDIO_FLYER_LAUNCH_URL\)/);
});

const pagesWorkflow=readFileSync(new URL("../.github/workflows/deploy-pages.yml",import.meta.url),"utf8");
test("PTG Pages Creative Studios cutover is manual-only and fail-closed until explicitly approved",()=>{
  assert.match(pagesWorkflow,/branches:\\s*\\n\\s*- migration\\/github-pages/);
  assert.match(pagesWorkflow,/workflow_dispatch:/);
  assert.match(pagesWorkflow,/deploy:\\s*\\n\\s*#.*(?:\\n\\s*#.*)*\\n\\s*if: github\\.event_name == 'workflow_dispatch' && github\\.ref == 'refs\\/heads\\/migration\\/github-pages' && vars\\.PTG_STUDIOS_CUTOVER_APPROVED == 'true'/);
  assert.match(pagesWorkflow,/NEXT_PUBLIC_STUDIO_MEGAFRAME_LAUNCH_URL:[^\\n]*PTG_STUDIOS_CUTOVER_APPROVED[^\\n]*megaframe-studio\\/studio\\//);
  assert.match(pagesWorkflow,/NEXT_PUBLIC_STUDIO_FLYER_LAUNCH_URL:[^\\n]*PTG_STUDIOS_CUTOVER_APPROVED[^\\n]*flyer-studio\\/studio\\//);
  assert.doesNotMatch(pagesWorkflow,/NEXT_PUBLIC_STUDIO_(?:MEGAFRAME|FLYER)_LAUNCH_URL: https:\\/\\//);
});
