// Pure allowlisted projection; used by the Edge Function and regression tests.
export function safeMemoNotices(memos,campaigns,products){
 const blocked=new Set(campaigns.filter(c=>String(c.campaign).trim().toUpperCase()==="SUBDEALER").map(c=>String(c.memo_number)));
 const byMemo=new Map();
 for(const p of products){const brand=String(p.brand||"").trim();if(!brand)continue;if(!byMemo.has(p.memo_id))byMemo.set(p.memo_id,new Set());byMemo.get(p.memo_id).add(brand);}
 return memos.filter(m=>m.branch_id===null&&["MEMO_LIST","KIOSK_MEMO_LIST"].includes(m.memo_type)&&!blocked.has(String(m.memo_id))&&!/^SUB(?:CON-|D?20\d{2}-)/i.test(String(m.memo_id))&&m.memo_id&&m.period&&m.imported_at&&byMemo.has(m.id))
  .slice(0,15).map(m=>({id:"memo:"+String(m.memo_id)+":"+String(m.imported_at),title:"New price memo · "+String(m.memo_id),body:"Memo number: "+String(m.memo_id)+"\nBrand: "+[...byMemo.get(m.id)].sort().join(", ")+"\nPeriod: "+String(m.period)}));
}
