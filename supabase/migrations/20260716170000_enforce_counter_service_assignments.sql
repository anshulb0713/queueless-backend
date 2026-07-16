create table public.counter_services (
  counter_id uuid not null references public.counters(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (counter_id, service_id)
);

create index counter_services_service_id_idx on public.counter_services(service_id);

-- Preserve the current demo behaviour until an administrator narrows each counter's scope.
insert into public.counter_services(counter_id, service_id)
select c.id, s.id
from public.counters c
join public.services s on s.branch_id = c.branch_id;

alter table public.counter_services enable row level security;
revoke all on public.counter_services from anon, authenticated;

alter table public.notification_events
  add column attempt_count integer not null default 0,
  add column next_attempt_at timestamptz not null default now();

create index notification_events_retry_idx
  on public.notification_events(next_attempt_at)
  where status in ('pending', 'failed');
