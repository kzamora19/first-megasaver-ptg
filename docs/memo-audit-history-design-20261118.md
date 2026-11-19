# PTG memo audit and historical-price design — staged only

**Status:** design and current-source assessment. No production schema, Edge Function, or Supabase environment has been changed.

## Existing mechanisms found in source

- `public.price_memos` stores memo number, period, type, source filename, imported-by, product count and imported-at.
- `public.memo_products` stores individual product offer rows. `public.import_price_memo` supports `SKIP` and `REPLACE`; replacement can delete the old product rows and insert new rows under the same memo record.
- The smart memo lifecycle SQL prefers latest applicable offers by period/upload timing while retaining prior **separate** memo rows for fallback. This is not equivalent to keeping snapshots of repeated replacements of the **same** memo.
- The `ptg-memos` Edge Function writes `PRICE_MEMO` / `IMPORT` or `REPLACE` records to `security_audit_logs` after successful import, with importer ID, memo ID, period, source filename, count and replaced-row summary (where supplied).
- Current product searches return metadata for selected memo offers but do not provide an authoritative, complete per-product revision history.

## Proposed read-only audit UI

In Branch Admin and System Admin, add a paginated **Memo Import History** view with memo number, upload date, import actor, period, source file, operation and product counts. Provide search by memo ID/brand/date when supported by server-side queries. Flag the audit as **import events only** until historical pricing snapshots are available. Do not show sensitive subdealer imports in unrestricted views.

## Historical price reconstruction requires extra append-only data

A future migration should transactionally capture, **before a replacement deletes existing product rows**, the prior rows' barcode/model/SRP/Tag This/installment/remarks, source memo and replacement metadata in an append-only price-revision table (partitioning and retention subject to DBA review).

- Never infer a historical price from the current search response.
- Never automatically purge historical audit records or source memos without a verified retention policy.
- Protect by branch and role, and ensure all exposed tables have RLS. A service-role secret belongs only in the Edge Function, not the client.
- Use authenticated, server-side pagination; do not expose unrestricted `security_audit_logs` to a browser.
- Confirm whether Branch Admin may see shared-price events; restrict subdealer/system-admin-only content.
- Add tests for `SKIP`, `REPLACE`, failures, partial product updates, old/new prices and permission bypass attempts.
- Validate historical snapshots in a non-production database before any real migration.

## Staged feature available now

PR #28 compares **currently loaded** regular/promotional offers and memo references in the product modal. Its wording explicitly says that visible offers and returned memo metadata are **not** complete historical audit data.

## Release gate

Hold all database/auth/Edge Function changes until the coordinated release. Confirm available schema, RLS, data retention, migration rollback and UI visibility with authorization tests. Never change the Apps Script production implementation during this work.
