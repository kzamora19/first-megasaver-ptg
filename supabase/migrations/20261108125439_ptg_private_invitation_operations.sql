create function public.ptg_issue_invitation(p_user_id uuid, p_hash text, p_expires timestamptz, p_email text)
returns void language plpgsql set search_path = '' as $$
begin
  update public.user_profiles
  set email = p_email, is_active = false, must_change_password = true, invitation_status = 'SENT',
      invited_at = now(), invitation_expires_at = p_expires, invitation_accepted_at = null,
      activated_at = null, updated_at = now()
  where id = p_user_id;
  if not found then raise exception 'Invitation account not found'; end if;
  delete from private.account_invitations where user_id = p_user_id and accepted_at is null;
  insert into private.account_invitations(user_id, token_hash, expires_at) values (p_user_id, p_hash, p_expires);
end;
$$;

create function public.ptg_accept_invitation(p_hash text)
returns uuid language plpgsql set search_path = '' as $$
declare
  invited_user uuid;
begin
  select user_id into invited_user from private.account_invitations
  where token_hash = p_hash and accepted_at is null and expires_at > now();
  if not found then return null; end if;

  perform 1 from public.user_profiles where id = invited_user and invitation_status = 'SENT' for update;
  if not found then return null; end if;

  update private.account_invitations set accepted_at = now()
  where token_hash = p_hash and user_id = invited_user and accepted_at is null and expires_at > now();
  if not found then return null; end if;

  update public.user_profiles set is_active = true, invitation_status = 'ACCEPTED',
      invitation_accepted_at = now(), updated_at = now()
  where id = invited_user;
  return invited_user;
end;
$$;

revoke execute on function public.ptg_issue_invitation(uuid,text,timestamptz,text), public.ptg_accept_invitation(text) from public, anon, authenticated;
grant execute on function public.ptg_issue_invitation(uuid,text,timestamptz,text), public.ptg_accept_invitation(text) to service_role;
