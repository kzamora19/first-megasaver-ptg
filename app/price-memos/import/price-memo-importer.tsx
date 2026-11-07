"use client";

import { useMemo,useState } from "react";
import { parsePriceMemo, type ParsedMemo } from "@/lib/price-memos/parse-price-memo";

type BranchOption={id:string;label:string};
type Props={branchOptions:BranchOption[];fixedBranchId:string|null};
type Summary={skipped:boolean;duplicate:boolean;totalProducts:number};

export default function PriceMemoImporter({branchOptions,fixedBranchId}:Props) {
  const [branchId,setBranchId]=useState(fixedBranchId??"");
  const [parsed,setParsed]=useState<ParsedMemo|null>(null);
  const [fileName,setFileName]=useState("");
  const [duplicateAction,setDuplicateAction]=useState<"SKIP"|"REPLACE">("SKIP");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [isError,setIsError]=useState(false);
  const [summary,setSummary]=useState<Summary|null>(null);
  const sample=useMemo(()=>parsed?.products.slice(0,10)??[],[parsed]);

  async function chooseFile(file?:File) {
    setParsed(null);setSummary(null);setMessage("");setIsError(false);setFileName("");
    if(!file)return;
    try {
      const result=await parsePriceMemo(file);
      setParsed(result);setFileName(file.name);
      setMessage("Memo read successfully. Review the details and sample rows before importing.");
    } catch(e) {
      setIsError(true);setMessage(e instanceof Error?e.message:"Unable to read the memo.");
    }
  }
  async function importMemo() {
    if(!parsed||!fileName||!branchId||busy)return;
    setBusy(true);setMessage("");setIsError(false);setSummary(null);
    try {
      const response=await fetch("/api/price-memos/import",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({branchId,memoId:parsed.memoId,period:parsed.period,memoType:parsed.memoType,sourceFile:fileName,duplicateAction,products:parsed.products})
      });
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.message||"Import failed.");
      setSummary(result.summary as Summary);
      setMessage(result.summary.skipped?"This memo already exists. No records were changed.":"Price memo import completed successfully.");
      if(!result.summary.skipped)setParsed(null);
    } catch(e) {setIsError(true);setMessage(e instanceof Error?e.message:"Import failed.");}
    finally {setBusy(false);}
  }
  return <section className="admin-layout"><div className="admin-card">
    <h3>Head Office memo file</h3>
    <p className="admin-muted">Supported: Excel (.xlsx, .xls) and CSV. The first worksheet is read. Required columns: BRAND, CATEGORY, BARCODE, MODEL, SRP and REMARKS. Installment headings may be on the row above the product headers.</p>
    {fixedBranchId? <p className="admin-muted">Destination branch is locked to your assigned branch.</p>:
      <label className="admin-field"><span>Destination branch</span><select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Select branch</option>{branchOptions.map(b=><option key={b.id} value={b.id}>{b.label}</option>)}</select></label>}
    <label className="upload-drop"><input type="file" accept=".xlsx,.xls,.csv" onChange={e=>void chooseFile(e.target.files?.[0])}/><strong>Choose Head Office price memo</strong><span>Maximum 20 MB · Up to 10,000 valid product rows</span></label>
    {fileName&&parsed&&<><p className="admin-muted">Selected: <strong>{fileName}</strong></p>
      <div className="import-summary"><strong>Memo details</strong><div className="import-summary-grid">
        <span>Memo Type <b>{parsed.memoType==="MEMO_LIST"?"MEMO LIST":"KIOSK MEMO LIST"}</b></span><span>Memo No. <b>{parsed.memoId}</b></span><span>Period <b>{parsed.period||"—"}</b></span><span>Total products <b>{parsed.products.length.toLocaleString()}</b></span>
        <span>Eligible <b>{parsed.eligible.toLocaleString()}</b></span><span>Unit only <b>{parsed.unitOnly.toLocaleString()}</b></span><span>Other promo <b>{parsed.otherPromo.toLocaleString()}</b></span><span>No remarks <b>{parsed.noRemarks.toLocaleString()}</b></span>
      </div></div>
      <div className="admin-list-heading"><div><h3>Product preview</h3><p className="admin-muted">Showing {sample.length} of {parsed.products.length.toLocaleString()} rows.</p></div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Brand</th><th>Barcode</th><th>Model</th><th>SRP</th><th>Cash Price</th><th>Tag This</th><th>Remarks / Eligibility</th></tr></thead><tbody>
        {sample.map((p,i)=><tr key={i}><td>{p.brand}</td><td>{p.barcode}</td><td>{p.model}</td><td>{p.srp.toLocaleString("en-PH",{minimumFractionDigits:2})}</td><td>{parsed.memoType==="KIOSK_MEMO_LIST"?"—":p.cash_payment.toLocaleString("en-PH",{minimumFractionDigits:2})}</td><td>{p.tag_this.toLocaleString("en-PH",{minimumFractionDigits:2})}</td><td>{p.remarks||"—"} · {p.price_tag_status}</td></tr>)}
      </tbody></table></div>
      <label className="admin-field"><span>If this memo number already exists in this branch</span><select value={duplicateAction} onChange={e=>setDuplicateAction(e.target.value as "SKIP"|"REPLACE")}><option value="SKIP">Skip existing memo (recommended)</option><option value="REPLACE">Replace existing memo and its products</option></select></label>
      <p className="admin-footnote">{parsed.memoType==="KIOSK_MEMO_LIST"?"Kiosk Memo List detected: Cash Price is intentionally absent. The system will not calculate or substitute a Cash Price. ":"Memo List detected: Cash Price column is present. "}Only rows marked ELIGIBLE by the exact FREE FIRST 10FT INSTALLATION rule can be used for price tags. UNIT ONLY, other promotions and blank remarks remain stored but are not eligible.</p>
      <button className="admin-button" disabled={busy||!branchId} onClick={()=>void importMemo()}>{busy?"IMPORTING…":"IMPORT PRICE MEMO"}</button>
    </>}
    {message&&<p className={isError?"admin-alert error":"admin-alert success"} role="status">{message}</p>}
    {summary&&<div className="import-summary"><strong>Import result</strong><div className="import-summary-grid"><span>Duplicate <b>{summary.duplicate?"Yes":"No"}</b></span><span>Skipped <b>{summary.skipped?"Yes":"No"}</b></span><span>Imported products <b>{summary.totalProducts.toLocaleString()}</b></span></div></div>}
  </div></section>;
}
