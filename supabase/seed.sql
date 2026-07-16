insert into public.users (name, email, password_hash, role)
values
  ('QueueLess Admin', 'admin@queueless.com', crypt('admin123', gen_salt('bf')), 'admin'),
  ('Demo Staff', 'staff@queueless.com', crypt('staff123', gen_salt('bf')), 'staff')
on conflict (email) do nothing;

with branch as (
  insert into public.branches (name, address, status)
  select 'City Care Clinic', 'Ahmedabad', 'open'
  where not exists (select 1 from public.branches where name = 'City Care Clinic')
  returning id
), resolved_branch as (
  select id from branch union all select id from public.branches where name = 'City Care Clinic' limit 1
)
insert into public.services (branch_id, name, prefix, average_duration)
select id, service_name, prefix, duration from resolved_branch cross join (values
  ('General Consultation', 'A', 5), ('Document Verification', 'B', 4)
) as v(service_name, prefix, duration)
on conflict (branch_id, name) do nothing;

insert into public.counters (branch_id, name)
select b.id, v.name from public.branches b cross join (values ('Counter 1'), ('Counter 2')) v(name)
where b.name = 'City Care Clinic' on conflict (branch_id, name) do nothing;
