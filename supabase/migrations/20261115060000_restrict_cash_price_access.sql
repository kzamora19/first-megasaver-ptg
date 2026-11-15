-- Browser roles use the PTG endpoint for cash prices after a server-side role check.
revoke select on table public.memo_products from public, anon, authenticated;
revoke select (cash_payment) on table public.memo_products from public, anon, authenticated;

grant select (
  id, memo_id, period, source_file, brand, category, barcode, model, srp, tag_this,
  months_6, months_9, months_12, months_18, months_24, remarks,
  eligible_for_price_tag, price_tag_status, imported_at
) on public.memo_products to authenticated;

notify pgrst, 'reload schema';
