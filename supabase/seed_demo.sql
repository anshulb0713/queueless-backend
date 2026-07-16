-- Re-runnable portal demo data. This only deletes token numbers beginning with DEMO-.
-- It deliberately reuses the seeded admin as the database owner of placeholder
-- customers; it does not create fake Supabase Auth or Google identities.

delete from public.tokens where token_number like 'DEMO-%';

with context as (
  select
    (select id from public.users where email = 'admin@queueless.com') as owner_id,
    (select id from public.branches where name = 'City Care Clinic') as branch_id,
    (select id from public.services where name = 'General Consultation' limit 1) as consultation_id,
    (select id from public.services where name = 'Document Verification' limit 1) as verification_id,
    (select id from public.counters where name = 'Counter 1' limit 1) as counter_one_id,
    (select id from public.counters where name = 'Counter 2' limit 1) as counter_two_id
)
insert into public.tokens (
  token_number, sequence_number, customer_id, customer_name, mobile, branch_id, service_id,
  counter_id, status, queue_position, estimated_wait_time, created_at, called_at,
  service_started_at, completed_at, skipped_at, cancelled_at
)
select * from (
  select 'DEMO-A-101', 101, owner_id, 'Aarav Shah', '9876543210', branch_id, consultation_id, null::uuid, 'waiting'::public.token_status, 1, 0, now() - interval '24 minutes', null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz from context union all
  select 'DEMO-A-102', 102, owner_id, 'Mira Patel', '9876543211', branch_id, consultation_id, null::uuid, 'waiting'::public.token_status, 2, 5, now() - interval '20 minutes', null, null, null, null, null from context union all
  select 'DEMO-A-103', 103, owner_id, 'Ishaan Mehta', '9876543212', branch_id, consultation_id, null::uuid, 'waiting'::public.token_status, 3, 10, now() - interval '16 minutes', null, null, null, null, null from context union all
  select 'DEMO-A-104', 104, owner_id, 'Nisha Rao', '9876543213', branch_id, consultation_id, null::uuid, 'waiting'::public.token_status, 4, 15, now() - interval '12 minutes', null, null, null, null, null from context union all
  select 'DEMO-B-101', 101, owner_id, 'Kabir Singh', '9876543214', branch_id, verification_id, null::uuid, 'waiting'::public.token_status, 1, 0, now() - interval '9 minutes', null, null, null, null, null from context union all
  select 'DEMO-A-100', 100, owner_id, 'Priya Desai', '9876543215', branch_id, consultation_id, counter_one_id, 'called'::public.token_status, null, 0, now() - interval '28 minutes', now() - interval '2 minutes', null, null, null, null from context union all
  select 'DEMO-B-100', 100, owner_id, 'Rohan Joshi', '9876543216', branch_id, verification_id, counter_two_id, 'serving'::public.token_status, null, 0, now() - interval '22 minutes', now() - interval '5 minutes', now() - interval '3 minutes', null, null, null from context union all
  select 'DEMO-A-099', 99, owner_id, 'Sana Khan', '9876543217', branch_id, consultation_id, null::uuid, 'completed'::public.token_status, null, 0, now() - interval '52 minutes', now() - interval '35 minutes', now() - interval '31 minutes', now() - interval '25 minutes', null, null from context union all
  select 'DEMO-B-099', 99, owner_id, 'Dev Malhotra', '9876543218', branch_id, verification_id, null::uuid, 'skipped'::public.token_status, null, 0, now() - interval '40 minutes', now() - interval '12 minutes', null, null, now() - interval '10 minutes', null from context union all
  select 'DEMO-A-098', 98, owner_id, 'Anaya Iyer', '9876543219', branch_id, consultation_id, null::uuid, 'cancelled'::public.token_status, null, 0, now() - interval '46 minutes', null, null, null, null, now() - interval '15 minutes' from context
) as demo_tokens;

update public.services
set current_sequence = greatest(current_sequence, case name when 'General Consultation' then 104 when 'Document Verification' then 101 else current_sequence end)
where name in ('General Consultation', 'Document Verification');

update public.counters
set status = case name when 'Counter 1' then 'busy'::public.counter_status when 'Counter 2' then 'busy'::public.counter_status else status end
where name in ('Counter 1', 'Counter 2');
