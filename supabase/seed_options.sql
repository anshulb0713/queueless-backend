-- Re-runnable catalog data for exercising the category → branch → service → counter hierarchy.
-- This seed only adds the named records below; it does not delete or alter existing data.

insert into public.categories (name, status)
values
  ('Banking', 'active'),
  ('Healthcare', 'active'),
  ('Government Services', 'active'),
  ('Retail', 'active'),
  ('Education', 'active')
on conflict (name) do update set status = excluded.status;

with seed_branches(category_name, name, address, status) as (
  values
    ('Banking', 'Metro Bank — Andheri', 'Andheri East, Mumbai', 'open'::public.branch_status),
    ('Banking', 'Metro Bank — Bandra', 'Bandra West, Mumbai', 'open'::public.branch_status),
    ('Healthcare', 'Wellness Hospital — Pune', 'Shivajinagar, Pune', 'open'::public.branch_status),
    ('Healthcare', 'Wellness Clinic — Nashik', 'College Road, Nashik', 'open'::public.branch_status),
    ('Government Services', 'Citizen Service Centre — Thane', 'Wagle Estate, Thane', 'open'::public.branch_status),
    ('Government Services', 'Citizen Service Centre — Navi Mumbai', 'Vashi, Navi Mumbai', 'open'::public.branch_status),
    ('Retail', 'CityMart — Powai', 'Hiranandani Gardens, Powai', 'open'::public.branch_status),
    ('Retail', 'CityMart — Dadar', 'Dadar West, Mumbai', 'open'::public.branch_status),
    ('Education', 'LearnHub Admissions — Mumbai', 'Lower Parel, Mumbai', 'open'::public.branch_status),
    ('Education', 'LearnHub Admissions — Pune', 'Kothrud, Pune', 'closed'::public.branch_status)
)
insert into public.branches (category_id, name, address, status)
select c.id, sb.name, sb.address, sb.status
from seed_branches sb
join public.categories c on c.name = sb.category_name
where not exists (select 1 from public.branches b where b.name = sb.name);

with seed_services(branch_name, name, prefix, average_duration) as (
  values
    ('Metro Bank — Andheri', 'Account Opening', 'MBA', 12),
    ('Metro Bank — Andheri', 'Cash Services', 'MBC', 6),
    ('Metro Bank — Andheri', 'Loan Enquiry', 'MBL', 15),
    ('Metro Bank — Bandra', 'Account Opening', 'MBB', 12),
    ('Metro Bank — Bandra', 'Card Services', 'MBD', 8),
    ('Metro Bank — Bandra', 'Loan Enquiry', 'MBE', 15),
    ('Wellness Hospital — Pune', 'General Consultation', 'WPG', 10),
    ('Wellness Hospital — Pune', 'Diagnostics', 'WPD', 18),
    ('Wellness Hospital — Pune', 'Pharmacy Collection', 'WPP', 5),
    ('Wellness Clinic — Nashik', 'General Consultation', 'WNG', 10),
    ('Wellness Clinic — Nashik', 'Vaccination', 'WNV', 7),
    ('Wellness Clinic — Nashik', 'Lab Reports', 'WNL', 6),
    ('Citizen Service Centre — Thane', 'Document Submission', 'CST', 9),
    ('Citizen Service Centre — Thane', 'Certificate Collection', 'CSC', 5),
    ('Citizen Service Centre — Thane', 'Application Support', 'CSA', 14),
    ('Citizen Service Centre — Navi Mumbai', 'Document Submission', 'CSN', 9),
    ('Citizen Service Centre — Navi Mumbai', 'Identity Services', 'CSI', 11),
    ('Citizen Service Centre — Navi Mumbai', 'Application Support', 'CSB', 14),
    ('CityMart — Powai', 'Returns & Exchange', 'CMP', 7),
    ('CityMart — Powai', 'Customer Helpdesk', 'CMH', 8),
    ('CityMart — Powai', 'Order Pickup', 'CMO', 4),
    ('CityMart — Dadar', 'Returns & Exchange', 'CMD', 7),
    ('CityMart — Dadar', 'Billing Support', 'CMB', 5),
    ('CityMart — Dadar', 'Order Pickup', 'CMQ', 4),
    ('LearnHub Admissions — Mumbai', 'Course Counselling', 'LMC', 15),
    ('LearnHub Admissions — Mumbai', 'Document Verification', 'LMD', 9),
    ('LearnHub Admissions — Mumbai', 'Fee Payment', 'LMF', 6),
    ('LearnHub Admissions — Pune', 'Course Counselling', 'LPC', 15),
    ('LearnHub Admissions — Pune', 'Document Verification', 'LPD', 9),
    ('LearnHub Admissions — Pune', 'Fee Payment', 'LPF', 6)
)
insert into public.services (branch_id, name, prefix, average_duration)
select b.id, ss.name, ss.prefix, ss.average_duration
from seed_services ss
join public.branches b on b.name = ss.branch_name
on conflict (branch_id, name) do nothing;

with seed_counter_branches(branch_name) as (
  values
    ('Metro Bank — Andheri'), ('Metro Bank — Bandra'),
    ('Wellness Hospital — Pune'), ('Wellness Clinic — Nashik'),
    ('Citizen Service Centre — Thane'), ('Citizen Service Centre — Navi Mumbai'),
    ('CityMart — Powai'), ('CityMart — Dadar'),
    ('LearnHub Admissions — Mumbai'), ('LearnHub Admissions — Pune')
)
insert into public.counters (branch_id, name, status)
select b.id, v.name, case when v.name = 'Counter 3' then 'paused'::public.counter_status else 'active'::public.counter_status end
from seed_counter_branches sb
join public.branches b on b.name = sb.branch_name
cross join (values ('Counter 1'), ('Counter 2'), ('Counter 3')) as v(name)
on conflict (branch_id, name) do nothing;

-- Give every seeded counter all active services from its own branch. Administrators can
-- subsequently narrow the assignments in the Counter management screen.
insert into public.counter_services (counter_id, service_id)
select c.id, s.id
from public.counters c
join public.branches b on b.id = c.branch_id
join public.services s on s.branch_id = b.id and s.status = 'active'
where b.name in (
  'Metro Bank — Andheri', 'Metro Bank — Bandra',
  'Wellness Hospital — Pune', 'Wellness Clinic — Nashik',
  'Citizen Service Centre — Thane', 'Citizen Service Centre — Navi Mumbai',
  'CityMart — Powai', 'CityMart — Dadar',
  'LearnHub Admissions — Mumbai', 'LearnHub Admissions — Pune'
)
on conflict do nothing;
