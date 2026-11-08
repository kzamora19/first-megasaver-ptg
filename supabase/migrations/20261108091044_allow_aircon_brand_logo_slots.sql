alter table public.logo_assets drop constraint logo_assets_logo_key_check,
add constraint logo_assets_logo_key_check check (
  logo_key in ('header','promo','zero','flexi','home','qr','social','appHeader','securityHeader')
  or logo_key ~ '^aircon:[A-Z0-9]{1,40}$'
);