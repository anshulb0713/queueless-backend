create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 100),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

insert into public.categories (name)
values ('Bank'), ('Hospital'), ('General')
on conflict (name) do nothing;

alter table public.branches add column category_id uuid references public.categories(id) on delete restrict;

update public.branches b
set category_id = (
  select c.id
  from public.categories c
  where c.name = case when lower(b.name) like '%clinic%' or lower(b.name) like '%hospital%' then 'Hospital' else 'General' end
)
where b.category_id is null;

alter table public.branches alter column category_id set not null;
create index branches_category_idx on public.branches(category_id, status);

alter table public.categories enable row level security;
revoke all on public.categories from anon, authenticated;
