alter table public.users add column fcm_token text;
alter table public.users add column fcm_token_updated_at timestamptz;

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens(id) on delete cascade,
  type text not null check (type in ('joined','three_ahead','called','service_started','skipped','restored','completed','cancelled')),
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(token_id, type)
);
create index notification_events_pending_idx on public.notification_events(status, created_at) where status in ('pending','failed');
alter table public.notification_events enable row level security;
revoke all on public.notification_events from anon, authenticated;
