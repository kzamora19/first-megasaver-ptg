"use client";

import { useState } from "react";
import { parsePriceMemo, type ParsedMemo } from "@/lib/price-memos/parse-price-memo";

type BranchOption={id:string;label:string};
type Props={branchOptions:BranchOption[];fixedBranchId:string|null};
type Summary={skipped:boolean;duplicate:boolean;totalProducts:number};
type MemoEntry={id:number;fileName:string;parsed?:ParsedMemo;error?:string;summary?:Summary;status:"READY"|"ERROR"|"IMPORTED"|"SKIPPED"|"FAILED"};

export default function PriceMemoImporter({branchOptions,fixedBranchId}:Props) {
  const [branchId,setBranchId]=useState(fixedBranchId??"");
  const [entries,setEntries]=useState<MemoEntry[]>([]);
  const [duplicateAction,setDuplicateAction]=useState<"SKIP"|"REPLACE">("SKIP");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [isError,setIsError]=useState(false);

  async function chooseFiles(fileList?:FileList|null) {
    const files=Array.from(fileList??[]);
    setEntries([]);setMessage("");setIsError(false);
    if(!files.length)return;
    setBusy(true);
    const parsedEntries:MemoEntry[]=[];
    for(let i=0;i<files.length;i++) {
      const file=files[i];
      try {
        const parsed=await parsePriceMemo(file);
        parsedEntries.push({id:i,fileName:file.name,parsed,status:"READY"});
      } catch(e) {
        parsedEntries.push({id:i,fileName:file.name,error:e instanceof Error?e.message:"Unable to read the memo.",status:"ERROR"});
      }
    }
    setEntries(parsedEntries);
    const ready=parsedEntries.filter(e=>e.parsed).length;
    const failed=parsedEntries.length-ready;
    setMessage(`${ready} of ${files.length} file(s) ready for review${failed?`; ${failed} could not be read`:"."}`);
    setIsError(failed>0);
    setBusy(false);
  }

  async function importMemos() {
    const ready=entries.filter(e=>e.parsed&&(e.status==="READY"||e.status==="FAILED"));
    if(!ready.length||!branchId||busy)return;
    setBusy(true);setMessage("");setIsError(false);
    let imported=0,skipped=0,failed=0;
    for(const entry of ready) {
      try {
        const parsed=entry.parsed!;
        const response=await fetch("/api/price-memos/import",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({branchId,memoId:parsed.memoId,period:parsed.period,memoType:parsed.memoType,sourceFile:entry.fileName,duplicateAction,products:parsed.products})
        });
        const result=await response.json();
        if(!response.ok||!result.ok)throw new Error(result.message||"Import failed.");
        const summary=result.summary as Summary;
        setEntries(current=>current.map(item=>item.id===entry.id?{...item,summary,status:summary.skipped?"SKIPPED":"IMPORTED"}:item));
        if(summary.skipped)skipped++;else imported++;
      } catch(e) {
        failed++;
        setEntries(current=>current.map(item=>item.id===entry.id?{...item,error:e instanceof Error?e.message:"Import failed.",status:"FAILED"}:item));
      }
    }
    setMessage(`Batch finished: ${imported} imported, ${skipped} skipped, ${failed} failed.`);
    setIsError(failed>0);
    setBusy(false);
  }

  const readyCount=entries.filter(e=>e.parsed&&(e.status==="READY"||e.status==="FAILED")).length;
  const totalProducts=entries.reduce((n,e)=>n+(e.parsed?.products.length??0),0);
  return <section className="admin-layout"><div className="admin-card">
    <h3>Head Office memo files</h3>
    <p className="admin-muted">Select one or more Excel (.xlsx, .xls) or CSV files. The first worksheet of each workbook is read. Required columns: BRAND, CATEGORY, BARCODE, MODEL, SRP and REMARKS. Installment headings may be on the row above the product headers. Each file may contain up to 10,000 valid product rows and must be 20 MB or smaller.</p>
    {fixedBranchId? <p className="admin-muted">Destination branch is locked to your assigned branch.</p>:
      <label className="admin-field"><span>Destination branch</span><select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Select branch</option>{branchOptions.map(b=><option key={b.id} value={b.id}>{b.label}</option>)}</select></label>}
    <label className="upload-drop"><input type="file" accept=".xlsx,.xls,.csv" multiple disabled={busy} onChange={e=>void chooseFiles(e.target.files)}/><strong>Choose multiple Head Office price memos</strong><span>Multiple files supported · Maximum 20 MB per file · Up to 10,000 valid product rows per file</span></label>
    {!!entries.length&&<>
      <div className="import-summary"><strong>Batch overview</strong><div className="import-summary-grid"><span>Files selected <b>{entries.length}</b></span><span>Ready to import <b>{readyCount}</b></span><span>Total product rows <b>{totalProducts.toLocaleString()}</b></span></div></div>
      {entries.map(entry=><div className="import-summary" key={entry.id}>
        <strong>{entry.fileName}</strong>
        {entry.error&&<p className="admin-alert error">{entry.error}</p>}
        {entry.parsed&&<>
          <div className="import-summary-grid">
            <span>Memo Type <b>{entry.parsed.memoType==="MEMO_LIST"?"MEMO LIST":"KIOSK MEMO LIST"}</b></span>
            <span>Memo No. <b>{entry.parsed.memoId}</b></span>
            <span>Period <b>{entry.parsed.period||"—"}</b></span>
            <span>Total products <b>{entry.parsed.products.length.toLocaleString()}</b></span>
            <span>Eligible <b>{entry.parsed.eligible.toLocaleString()}</b></span>
            <span>Unit only <b>{entry.parsed.unitOnly.toLocaleString()}</b></span>
            <span>Other promo <b>{entry.parsed.otherPromo.toLocaleString()}</b></span>
            <span>No remarks <b>{entry.parsed.noRemarks.toLocaleString()}</b></span>
            <span>Import status <b>{entry.status==="READY"?"Ready":entry.status==="IMPORTED"?"Imported":entry.status==="SKIPPED"?"Skipped":entry.status==="FAILED"?"Failed":"—"}</b></span>
          </div>
          {entry.summary&&<p className="admin-muted">{entry.summary.totalProducts.toLocaleString()} product row(s) {entry.summary.skipped?"skipped because this memo already exists.":"processed successfully."}</p>}
          {entry.status==="READY"&&<><h4>Product preview (first 5 rows)</h4><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Brand</th><th>Barcode</th><th>Model</th><th>SRP</th><th>Cash Price</th><th>Tag This</th><th>Remarks / Eligibility</th></tr></thead><tbody>
            {entry.parsed.products.slice(0,5).map((p,i)=><tr key={i}><td>{p.brand}</td><td>{p.barcode}</td><td>{p.model}</td><td>{p.srp.toLocaleString("en-PH",{minimumFractionDigits:2})}</td><td>{entry.parsed!.memoType==="KIOSK_MEMO_LIST"?"—":p.cash_payment.toLocaleString("en-PH",{minimumFractionDigits:2})}</td><td>{p.tag_this.toLocaleString("en-PH",{minimumFractionDigits:2})}</td><td>{p.remarks||"—"} · {p.price_tag_status}</td></tr>)}
          </tbody></table></div></>}
          <p className="admin-footnote">{entry.parsed.memoType==="KIOSK_MEMO_LIST"?"Kiosk Memo List detected: Cash Price is intentionally absent. ":"Memo List detected: Cash Price column is present. "}Only rows marked ELIGIBLE by the exact FREE FIRST 10FT INSTALLATION rule can be used for price tags. UNIT ONLY, other promotions and blank remarks remain stored but are not eligible.</p>
        </>}
      </div>)}
      <label className="admin-field"><span>If a memo number already exists in this branch</span><select value={duplicateAction} disabled={busy} onChange={e=>setDuplicateAction(e.target.value as "SKIP"|"REPLACE")}><option value="SKIP">Skip existing memo (recommended)</option><option value="REPLACE">Replace existing memo and its products</option></select></label>
      <button className="admin-button" disabled={busy||!branchId||readyCount===0} onClick={()=>void importMemos()}>{busy?"PROCESSING BATCH…":`IMPORT ${readyCount} READY MEMO(S)`}</button>
    </>}
    {message&&<p className={isError?"admin-alert error":"admin-alert success"} role="status">{message}</p>}
  </div></section>;
}
