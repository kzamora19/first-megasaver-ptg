import test from "node:test";
import assert from "node:assert/strict";
import {studioSupabaseKey} from "../supabase/functions/_shared/studio-supabase-keys.mjs";

const env = values => name => values[name];
test("new Supabase default secret key dictionary", () => {
  assert.equal(studioSupabaseKey(env({SUPABASE_SECRET_KEYS:JSON.stringify({default:"sb_secret_nonreal_test"})}),"secret"),"sb_secret_nonreal_test");
});
test("new publishable dictionary", () => {
  assert.equal(studioSupabaseKey(env({SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:"sb_publishable_nonreal_test"})}),"publishable"),"sb_publishable_nonreal_test");
});
test("explicit, legacy and malformed JSON fallback", () => {
  assert.equal(studioSupabaseKey(env({SUPABASE_SECRET_KEY:"manual_dummy",SUPABASE_SECRET_KEYS:"{}"}),"secret"),"manual_dummy");
  assert.equal(studioSupabaseKey(env({SUPABASE_SECRET_KEYS:"broken",SUPABASE_SERVICE_ROLE_KEY:"legacy_dummy"}),"secret"),"legacy_dummy");
  assert.equal(studioSupabaseKey(env({SUPABASE_PUBLISHABLE_KEYS:"{}",SUPABASE_ANON_KEY:"legacy_anon_dummy"}),"publishable"),"legacy_anon_dummy");
});
test("missing keys fail closed", () => {
  assert.equal(studioSupabaseKey(env({}),"secret"),"");
  assert.equal(studioSupabaseKey(env({SUPABASE_SECRET_KEYS:'{"default":123}'}),"secret"),"");
});
