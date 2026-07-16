create table public.staff_counter_services (
  staff_id uuid not null references public.users(id) on delete cascade,
  counter_id uuid not null references public.counters(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, counter_id, service_id)
);

create index staff_counter_services_scope_idx
  on public.staff_counter_services(staff_id, counter_id, service_id);

-- Preserve current staff access during rollout. New staff are granted only the
-- services explicitly selected by an administrator through the API.
insert into public.staff_counter_services(staff_id, counter_id, service_id)
select c.staff_id, cs.counter_id, cs.service_id
from public.counters c
join public.counter_services cs on cs.counter_id = c.id
where c.staff_id is not null
on conflict do nothing;

alter table public.staff_counter_services enable row level security;
revoke all on public.staff_counter_services from anon, authenticated;
