-- Remembered-device sessions are explicit opt-in and revocable.
-- Existing sessions remain non-remembered and retain 30-minute idle / 8-hour maximum.
-- This column is server-owned and not user-editable through the Data API.
alter table public.app_sessions
  add column if not exists remember_device boolean not null default false;
comment on column public.app_sessions.remember_device is
  'True only for password-authenticated sessions where user explicitly chose Remember me on this device.';
