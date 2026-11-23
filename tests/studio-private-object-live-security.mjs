// Direct-path security test for two byte-pinned private Studio releases.
// Uses only public browser-equivalent keys and never stores or reads a real user token.
// Expected: no untrusted network request can download the editor HTML.
const fixtures=[
 {studio:"megaframe",url:"https://vmyoxoiygfcecgkbavgg.supabase.co",
   bucket:"megaframe-editor-release",
   path:"releases/d427621376f4db4c/studio.html",
   key:"sb_publishable_jyCflrfvPnPb6O3ncmlG2w_w4FeKz40"},
 {studio:"flyer",url:"https://tzklsscoiwnmeantcefw.supabase.co",
   bucket:"flyer-editor-release",
   path:"releases/1c82384c40685ea2/studio.html",
   key:"sb_publishable_djhRIa3KhHbG0tOzQnXrIA_Ou-fJnmK"},
];
for(const t of fixtures){
  const route=t.url+"/storage/v1/object/"+t.bucket+"/"+t.path;
  const probes=[
    ["without-key",route,{}],
    ["publishable-key",route,{apikey:t.key}],
    ["browser-bearer",route,{apikey:t.key,Authorization:"Bearer "+t.key}],
    ["public-object-path",t.url+"/storage/v1/object/public/"+t.bucket+"/"+t.path,
      {apikey:t.key}],
  ];
  for(const [name,url,headers] of probes){
    const response=await fetch(url,{method:"GET",headers,redirect:"error",
      cache:"no-store",signal:AbortSignal.timeout(12000)});
    // Response must not serve the protected HTML. A 404 / 400 / 401 / 403 are
    // acceptable non-existence/authorization denials.
    if(response.ok){
      await response.body?.cancel();
      throw Error(t.studio+" private release was downloadable by "+name);
    }
    if(![400,401,403,404,406].includes(response.status))
      throw Error(t.studio+" private storage emitted unexpected HTTP "+response.status);
    console.log(t.studio+" "+name+" HTTP "+response.status+" (private)");
  }
}
console.log("PASS: neither Studio's SHA-pinned private HTML release is exposed on any direct public object route.");
