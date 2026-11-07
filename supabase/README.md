# Supabase project setup

Target project: **First Megasaver PTG**  
Project reference: `agknxlowackphvwyvxge`  
Project URL: `https://agknxlowackphvwyvxge.supabase.co`

This folder is reserved for reviewed SQL migrations and Supabase configuration.

No tables, policies, storage buckets, users, or production records have been created as part of the initial scaffold.

Before adding schema:
- Model branch ownership and account roles explicitly.
- Enable RLS on every exposed table.
- Keep authorization data in trusted server-managed fields, never user-editable metadata.
- Keep secret/service credentials on the server only.
- Verify policies with positive and negative branch-isolation tests.
