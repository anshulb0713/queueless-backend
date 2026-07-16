alter table public.users
  add column auth_user_id uuid unique references auth.users(id) on delete cascade,
  add column auth_provider text check (auth_provider in ('google'));

alter table public.users
  add constraint customer_google_auth_required check (
    (role = 'customer' and auth_user_id is not null and auth_provider = 'google')
    or role in ('admin', 'staff')
  );

create index users_auth_user_id_idx on public.users(auth_user_id) where auth_user_id is not null;
