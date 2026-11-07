-- Branchline PTG: allow shared branch mailboxes across multiple employee accounts.
-- Username remains the unique login identifier; account email is a delivery destination.
drop index if exists public.user_profiles_email_unique;

comment on column public.user_profiles.email is
  'Invitation and password-reset delivery address. May be shared by multiple branch accounts; usernames remain unique.';
