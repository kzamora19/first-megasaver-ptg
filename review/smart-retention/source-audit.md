# Pre-release read-only source inventory — 2026-11-26
The connected production Storage bucket metadata was inspected without mutation. No existing bucket named branchline-retained-imports was found.
| Project | Buckets | Objects | Decision |
|---|---|---:|---|
| PTG / Data Desk | ptg-branding | 51 | Excluded branding assets |
| Sales Tracker | none | 0 | No retained source archive |
| MegaFrame | megaframe-editor-release | 4 | Excluded release artifacts |
| MegaFlyer | flyer-editor-release, flyer-product-photos, flyer-shared-assets, flyer-studio-private | 4 | Excluded system and product assets |
No redundant uploads or enrollment of existing objects. This audit covers Supabase Storage only; browser storage, Drive backups and local projects remain outside the cleanup policy.
## Legacy catalog provenance
| Dataset | Source | Current rows | Latest recorded import/update | Effective date verified? |
|---|---|---:|---|---|
| Master | Branchline_Extraction_2026-11-15.xlsx | 5620 | 2026-11-15 | No |
| Master | MemoList - 2026-11-15T094114.357.xlsx | 20 | 2026-11-15 | No |
| Master | PRODUCT MASTER.xlsx | 6700 | 2026-11-15 | No |
| SRP | Branchline_Extraction_2026-11-08 (3).xlsx | 2352 | 2026-11-08 | No |
| SRP | Branchline_Extraction_2026-11-15.xlsx | 5150 | 2026-11-15 | No |
| SRP | Manual entry | 13 | 2026-11-23 | No |
Import logs do not establish true report effective dates. Do not silently approve dates from filenames. An exact original workbook was not located in the accessible Library search. The System Admin must confirm a conservative upper bound using actual source provenance; otherwise populated legacy records are protected and updates fail closed.
## Relay validation
The remote receiver snapshot under remote-gateway-fixture is copied from Branchline review commit ba57b9a5e27a664677755330106998a6c8d5a506. Identical receiver code is committed in the MegaFrame and MegaFlyer review branches. The relay integration test uses real loopback HTTP to three separate receiver instances with isolated simulated RPC state; independent PostgreSQL suites test the real registry functions. It does not configure or call production endpoints. Production secrets and deployed connections require separately approved release.
