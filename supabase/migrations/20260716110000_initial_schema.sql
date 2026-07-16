create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'staff', 'customer');
create type public.branch_status as enum ('open', 'closed');
create type public.service_status as enum ('active', 'inactive');
create type public.counter_status as enum ('active', 'busy', 'paused', 'closed');
create type public.token_status as enum ('waiting', 'called', 'serving', 'skipped', 'completed', 'cancelled');

create table public.users (
  id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 2 and 100),
  email text unique, mobile text, password_hash text, role public.user_role not null default 'customer',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.branches (
  id uuid primary key default gen_random_uuid(), name text not null, address text not null,
  status public.branch_status not null default 'open', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.services (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, prefix text not null check (char_length(prefix) between 1 and 8),
  average_duration integer not null check (average_duration > 0 and average_duration <= 240),
  current_sequence integer not null default 100 check (current_sequence >= 0), status public.service_status not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(branch_id, name)
);
create table public.counters (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, staff_id uuid references public.users(id) on delete set null,
  status public.counter_status not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(branch_id, name)
);
create table public.tokens (
  id uuid primary key default gen_random_uuid(), token_number text not null unique, sequence_number integer not null,
  customer_name text not null check (char_length(customer_name) between 2 and 100), mobile text not null check (mobile ~ '^[0-9]{10,15}$'),
  branch_id uuid not null references public.branches(id), service_id uuid not null references public.services(id),
  counter_id uuid references public.counters(id), status public.token_status not null default 'waiting', queue_position integer,
  estimated_wait_time integer not null default 0, created_at timestamptz not null default now(), called_at timestamptz,
  service_started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, skipped_at timestamptz,
  restored_at timestamptz, updated_at timestamptz not null default now()
);
create index tokens_active_queue_idx on public.tokens (branch_id, service_id, created_at) where status = 'waiting';
create index tokens_dashboard_idx on public.tokens (branch_id, status, created_at desc);
create index counters_branch_idx on public.counters(branch_id, status);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger users_updated_at before update on public.users for each row execute function public.set_updated_at();
create trigger branches_updated_at before update on public.branches for each row execute function public.set_updated_at();
create trigger services_updated_at before update on public.services for each row execute function public.set_updated_at();
create trigger counters_updated_at before update on public.counters for each row execute function public.set_updated_at();
create trigger tokens_updated_at before update on public.tokens for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.branches enable row level security;
alter table public.services enable row level security;
alter table public.counters enable row level security;
alter table public.tokens enable row level security;

-- This Express API connects via DATABASE_URL; no browser Data API access is granted by default.
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
