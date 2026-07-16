alter table public.tokens
  add column customer_id uuid references public.users(id) on delete restrict;

alter table public.tokens
  add constraint tokens_customer_required check (customer_id is not null) not valid;

create index tokens_customer_id_idx on public.tokens(customer_id, created_at desc);
