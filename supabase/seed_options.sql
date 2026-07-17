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

-- Expanded options for broader hierarchy and status testing.
insert into public.categories (name, status)
values
  ('Travel', 'active'),
  ('Legal Services', 'active'),
  ('Utilities', 'active'),
  ('Insurance', 'active'),
  ('Automotive', 'active')
on conflict (name) do update set status = excluded.status;

with seed_branches(category_name, name, address, status) as (
  values
    ('Travel', 'TravelDesk — Mumbai Airport', 'Terminal 2, Mumbai Airport', 'open'::public.branch_status),
    ('Travel', 'TravelDesk — Pune Station', 'Pune Railway Station, Pune', 'open'::public.branch_status),
    ('Legal Services', 'LegalAid — Fort', 'Fort, Mumbai', 'open'::public.branch_status),
    ('Legal Services', 'LegalAid — Pune Camp', 'Camp, Pune', 'open'::public.branch_status),
    ('Utilities', 'PowerConnect — Andheri', 'Andheri West, Mumbai', 'open'::public.branch_status),
    ('Utilities', 'PowerConnect — Kalyan', 'Kalyan West, Thane', 'open'::public.branch_status),
    ('Insurance', 'SecureLife — BKC', 'Bandra Kurla Complex, Mumbai', 'open'::public.branch_status),
    ('Insurance', 'SecureLife — Viman Nagar', 'Viman Nagar, Pune', 'open'::public.branch_status),
    ('Automotive', 'AutoHub — Borivali', 'Borivali East, Mumbai', 'open'::public.branch_status),
    ('Automotive', 'AutoHub — Wakad', 'Wakad, Pune', 'closed'::public.branch_status)
)
insert into public.branches (category_id, name, address, status)
select c.id, sb.name, sb.address, sb.status
from seed_branches sb
join public.categories c on c.name = sb.category_name
where not exists (select 1 from public.branches b where b.name = sb.name);

with seed_services(branch_name, name, prefix, average_duration) as (
  values
    ('TravelDesk — Mumbai Airport', 'Ticket Booking', 'TMA', 8),
    ('TravelDesk — Mumbai Airport', 'Visa Assistance', 'TMV', 16),
    ('TravelDesk — Mumbai Airport', 'Itinerary Changes', 'TMI', 10),
    ('TravelDesk — Mumbai Airport', 'Baggage Support', 'TMB', 7),
    ('TravelDesk — Pune Station', 'Ticket Booking', 'TPA', 8),
    ('TravelDesk — Pune Station', 'Visa Assistance', 'TPV', 16),
    ('TravelDesk — Pune Station', 'Itinerary Changes', 'TPI', 10),
    ('TravelDesk — Pune Station', 'Baggage Support', 'TPB', 7),
    ('LegalAid — Fort', 'Legal Consultation', 'LFC', 20),
    ('LegalAid — Fort', 'Document Notary', 'LFN', 12),
    ('LegalAid — Fort', 'Case Filing', 'LFF', 18),
    ('LegalAid — Fort', 'Certificate Attestation', 'LFA', 10),
    ('LegalAid — Pune Camp', 'Legal Consultation', 'LPC', 20),
    ('LegalAid — Pune Camp', 'Document Notary', 'LPN', 12),
    ('LegalAid — Pune Camp', 'Case Filing', 'LPF', 18),
    ('LegalAid — Pune Camp', 'Certificate Attestation', 'LPA', 10),
    ('PowerConnect — Andheri', 'Electricity Billing', 'PEB', 8),
    ('PowerConnect — Andheri', 'Water Services', 'PEW', 10),
    ('PowerConnect — Andheri', 'Gas Connection', 'PEG', 14),
    ('PowerConnect — Andheri', 'Complaint Desk', 'PEC', 12),
    ('PowerConnect — Kalyan', 'Electricity Billing', 'PKB', 8),
    ('PowerConnect — Kalyan', 'Water Services', 'PKW', 10),
    ('PowerConnect — Kalyan', 'Gas Connection', 'PKG', 14),
    ('PowerConnect — Kalyan', 'Complaint Desk', 'PKC', 12),
    ('SecureLife — BKC', 'Policy Renewal', 'SBR', 10),
    ('SecureLife — BKC', 'Claims Support', 'SBC', 18),
    ('SecureLife — BKC', 'New Policy', 'SBN', 15),
    ('SecureLife — BKC', 'Document Upload', 'SBD', 7),
    ('SecureLife — Viman Nagar', 'Policy Renewal', 'SVR', 10),
    ('SecureLife — Viman Nagar', 'Claims Support', 'SVC', 18),
    ('SecureLife — Viman Nagar', 'New Policy', 'SVN', 15),
    ('SecureLife — Viman Nagar', 'Document Upload', 'SVD', 7),
    ('AutoHub — Borivali', 'Vehicle Service', 'ABV', 20),
    ('AutoHub — Borivali', 'Test Drive', 'ABT', 12),
    ('AutoHub — Borivali', 'Parts Collection', 'ABP', 8),
    ('AutoHub — Borivali', 'Insurance Desk', 'ABI', 11),
    ('AutoHub — Wakad', 'Vehicle Service', 'AWV', 20),
    ('AutoHub — Wakad', 'Test Drive', 'AWT', 12),
    ('AutoHub — Wakad', 'Parts Collection', 'AWP', 8),
    ('AutoHub — Wakad', 'Insurance Desk', 'AWI', 11)
)
insert into public.services (branch_id, name, prefix, average_duration)
select b.id, ss.name, ss.prefix, ss.average_duration
from seed_services ss
join public.branches b on b.name = ss.branch_name
on conflict (branch_id, name) do nothing;

with seed_counter_branches(branch_name) as (
  values
    ('TravelDesk — Mumbai Airport'), ('TravelDesk — Pune Station'),
    ('LegalAid — Fort'), ('LegalAid — Pune Camp'),
    ('PowerConnect — Andheri'), ('PowerConnect — Kalyan'),
    ('SecureLife — BKC'), ('SecureLife — Viman Nagar'),
    ('AutoHub — Borivali'), ('AutoHub — Wakad')
)
insert into public.counters (branch_id, name, status)
select b.id, v.name, case when v.name = 'Counter 4' then 'paused'::public.counter_status else 'active'::public.counter_status end
from seed_counter_branches sb
join public.branches b on b.name = sb.branch_name
cross join (values ('Counter 1'), ('Counter 2'), ('Counter 3'), ('Counter 4')) as v(name)
on conflict (branch_id, name) do nothing;

insert into public.counter_services (counter_id, service_id)
select c.id, s.id
from public.counters c
join public.branches b on b.id = c.branch_id
join public.services s on s.branch_id = b.id and s.status = 'active'
where b.name in (
  'TravelDesk — Mumbai Airport', 'TravelDesk — Pune Station',
  'LegalAid — Fort', 'LegalAid — Pune Camp',
  'PowerConnect — Andheri', 'PowerConnect — Kalyan',
  'SecureLife — BKC', 'SecureLife — Viman Nagar',
  'AutoHub — Borivali', 'AutoHub — Wakad'
)
on conflict do nothing;
