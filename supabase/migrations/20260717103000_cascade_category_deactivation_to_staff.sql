alter table public.users
  add column if not exists is_active boolean not null default true;

create index if not exists users_staff_active_idx
  on public.users(role, is_active)
  where role = 'staff';
