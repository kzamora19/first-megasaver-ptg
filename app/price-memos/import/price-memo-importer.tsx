"use client";

import { useState } from "react";
import { parsePriceMemo, type ParsedMemo } from "@/lib/price-memos/parse-price-memo";
import { invokePtgData, usesEdgeData } from "@/lib/ptg/edge-api";

type Summary={skipped:boolean;duplicate:boolean;totalProducts:number};
type MemoEntry={id:number;fileName:string;parsed?:ParsedMemo;error?:string;summary?:Summary;status:"READY"|"ERROR"|"IMPORTED"|"SKIPPED"|"FAILED"};

export default function PriceMemoImporter() {
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
    if(!ready.length||busy)return;
    setBusy(true);setMessage("");setIsError(false);
    let imported=0,skipped=0,failed=0;
    for(const entry of ready) {
      try {
        const parsed=entry.parsed!;
        let result: {ok:boolean;summary?:Summary;message?:string};
        if(usesEdgeData){
          result=await invokePtgData("ptg-memos",{
            action:"import",memoId:parsed.memoId,period:parsed.period,memoType:parsed.memoType,
            sourceFile:entry.fileName,duplicateAction,products:parsed.products
          }) as typeof result;
        }else{
          const response=await fetch("/api/price-memos/import",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({memoId:parsed.memoId,period:parsed.period,memoType:parsed.memoType,sourceFile:entry.fileName,duplicateAction,products:parsed.products})
          });
          result=await response.json();
          if(!response.ok||!result.ok)throw new Error(result.message||"Import failed.");
        }
        if(!result.ok)throw new Error(result.message||"Import failed.");
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
  const importedCount=entries.filter(e=>e.status==="IMPORTED").length;
  const skippedCount=entries.filter(e=>e.status==="SKIPPED").length;
  const failedCount=entries.filter(e=>e.status==="FAILED"||e.status==="ERROR").length;
  const isFinished=entries.length>0&&entries.every(e=>["IMPORTED","SKIPPED","FAILED","ERROR"].includes(e.status));

  return <section className="admin-layout"><div className="admin-card">
    <h3>Head Office memo files</h3>
    <p className="admin-muted">Select one or more Excel (.xlsx, .xls) or CSV files. The first worksheet of each workbook is read. Required columns: BRAND, CATEGORY, BARCODE, MODEL, SRP and REMARKS. Installment headings may be on the row above the product headers. Each file may contain up to 10,000 valid product rows and must be 20 MB or smaller.</p>
    <p className="admin-muted">Imported memos and products are shared across Cauayan (CAU), Ilagan (ILA), Santiago (STG), and Tuguegarao (TUG).</p>
    <label className="upload-drop"><input type="file" accept=".xlsx,.xls,.csv" multiple disabled={busy} onChange={e=>void chooseFiles(e.target.files)}/><strong>Choose multiple Head Office price memos</strong><span>Multiple files supported · Maximum 20 MB per file · Up to 10,000 valid product rows per file</span></label>
    {!!entries.length&&<>
      <div className="import-summary"><strong>{isFinished?"Batch import summary":"Selected memo summary"}</strong><div className="import-summary-grid">
        <span>Files selected <b>{entries.length}</b></span>
        <span>{isFinished?"Imported":"Ready to import"} <b>{isFinished?importedCount:readyCount}</b></span>
        <span>Skipped <b>{skippedCount}</b></span>
        <span>Failed <b>{failedCount}</b></span>
        <span>Total product rows <b>{totalProducts.toLocaleString()}</b></span>
      </div></div>
      <h3>Memo summary</h3>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Memo No.</th><th>Period</th><th>Source file</th><th>Memo type</th><th>Products</th><th>Status</th></tr></thead><tbody>
        {entries.map(entry=><tr key={entry.id}>
          <td>{entry.parsed?.memoId??"—"}</td>
          <td>{entry.parsed?.period||"—"}</td>
          <td title={entry.fileName}>{entry.fileName}</td>
          <td>{entry.parsed?.memoType==="MEMO_LIST"?"MEMO LIST":entry.parsed?.memoType==="KIOSK_MEMO_LIST"?"KIOSK MEMO LIST":"—"}</td>
          <td>{entry.parsed?.products.length.toLocaleString()??"—"}</td>
          <td>{entry.status==="READY"?"Ready":entry.status==="IMPORTED"?"Imported":entry.status==="SKIPPED"?"Skipped":entry.status==="FAILED"||entry.status==="ERROR"?"Failed":"—"}{entry.error&&<span title={entry.error}> · Error</span>}</td>
        </tr>)}
      </tbody></table></div>
      <label className="admin-field"><span>If a memo number already exists in shared PTG data</span><select value={duplicateAction} disabled={busy} onChange={e=>setDuplicateAction(e.target.value as "SKIP"|"REPLACE")}><option value="SKIP">Skip existing memo (recommended)</option><option value="REPLACE">Replace existing memo and its products</option></select></label>
      <button className="admin-button" disabled={busy||readyCount===0} onClick={()=>void importMemos()}>{busy?"PROCESSING BATCH…":`IMPORT ${readyCount} READY MEMO(S)`}</button>
    </>}
    {message&&<p className={isError?"admin-alert error":"admin-alert success"} role="status">{message}</p>}
  </div></section>;
}
