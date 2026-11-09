-- Usernames identify one PTG account across all branches and roles.
create unique index login_identity_global_username_uq
  on private.login_identities (normalized_username);
