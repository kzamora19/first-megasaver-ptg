import assert from "node:assert/strict";

const STAGING_REF = "rlfdvmiqkbitetatxkju";
const base = `https://${STAGING_REF}.supabase.co/functions/v1`;
const cases = [
  { name: "PTG refuses browser GET", path: "ptg-studio-access", method: "GET", status: 405 },
  { name: "MegaFrame refuses missing origin", path: "megaframe-editor-delivery", method: "GET", status: 403 },
  { name: "MegaFlyer refuses missing origin", path: "flyer-editor-delivery", method: "GET", status: 403 },
  { name: "MegaFrame refuses untrusted origin POST", path: "megaframe-editor-delivery", method: "POST", origin: "https://invalid.example", status: 403 },
  { name: "MegaFlyer refuses untrusted origin POST", path: "flyer-editor-delivery", method: "POST", origin: "https://invalid.example", status: 403 },
  // Read-only/negative-only checks that distinguish configured staging functions
  // from functions returning HTTP 503 before request validation.
  { name: "PTG issuer responds to approved-origin preflight", path: "ptg-studio-access", method: "OPTIONS", origin: "https://kzamora19.github.io", status: 204 },
  { name: "PTG refuses missing bearer for permitted-origin issue", path: "ptg-studio-access", method: "POST", origin: "https://kzamora19.github.io", payload: {action:"issue",studio:"megaframe"}, status: 401 },
  { name: "MegaFrame configured guard refuses malformed launch", path: "megaframe-editor-delivery", method: "POST", origin: "https://kzamora19.github.io", payload: {action:"load",ticket:"forged"}, status: 400 },
  { name: "MegaFlyer configured guard refuses malformed launch", path: "flyer-editor-delivery", method: "POST", origin: "https://kzamora19.github.io", payload: {action:"load",ticket:"forged"}, status: 400 }
];

const failures = [];
for (const scenario of cases) {
  try {
    const response = await fetch(`${base}/${scenario.path}`, {
      method: scenario.method,
      headers: {
        ...(scenario.origin ? { Origin: scenario.origin } : {}),
        ...(scenario.method === "POST" ? { "Content-Type": "application/json" } : {})
      },
      ...(scenario.method === "POST" ? { body: JSON.stringify(scenario.payload ?? { action: "load", ticket: "forged" }) } : {}),
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.text();
    assert.equal(response.status, scenario.status, `${scenario.name}: ${response.status} ${body.slice(0, 240)}`);
    assert.ok(!/<html[\\s>]/i.test(body), `${scenario.name}: response must never expose a private editor`);
    console.log("PASS", scenario.name, response.status);
  } catch (error) {
    console.error("FAIL", scenario.name, error instanceof Error ? error.message : "unknown");
    failures.push(scenario.name);
  }
}
if (failures.length) {
  console.error(`${failures.length} staging preflight failures: ${failures.join(", ")}`);
  process.exitCode = 1;
}

console.log("Public denial and staging configuration preflight passed. This does NOT verify secret equality, successful authorized launch, private release bundles, or production readiness.");
