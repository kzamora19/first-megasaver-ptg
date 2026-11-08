create function public.ptg_enforce_managed_branch_password()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role_key = 'BRANCH_USER' then
    new.must_change_password := false;
    if new.invitation_status = 'ACCEPTED' then
      new.invitation_status := 'ACTIVATED';
      new.activated_at := coalesce(new.activated_at, now());
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.ptg_enforce_managed_branch_password() from public, anon, authenticated;

create trigger ptg_enforce_managed_branch_password
before insert or update of role_key, must_change_password, invitation_status on public.user_profiles
for each row execute function public.ptg_enforce_managed_branch_password();

update public.user_profiles set must_change_password = false
where role_key = 'BRANCH_USER' and (must_change_password or invitation_status = 'ACCEPTED');
