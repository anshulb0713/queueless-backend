create unique index counters_one_counter_per_staff_idx
  on public.counters(staff_id)
  where staff_id is not null;

update public.counters
set staff_id = (select id from public.users where email = 'staff@queueless.com')
where name = 'Counter 1'
  and branch_id = (select id from public.branches where name = 'City Care Clinic');
