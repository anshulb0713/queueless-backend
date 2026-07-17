import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../database/postgres.js';
import { ApiError, asyncRoute, ok } from '../middlewares/error.middleware.js';
import { hashPassword, requireAuth, requireCustomerAuth, signToken, verifyPassword } from '../middlewares/auth.middleware.js';
import { assertTransition, recalculateQueue } from '../services/queue.service.js';
import { TokenStatus } from '../types/index.js';
import { supabaseAuth } from '../config/supabase.js';
import { enqueueTokenNotification, NotificationType, notifyThreeAhead } from '../services/notification.service.js';

const id = z.string().uuid();
const fcmToken = z.string().trim().min(20).max(4096);
const tokenInput = z.object({ branchId: id, serviceId: id, fcmToken: fcmToken.nullable().optional() });
const callInput = z.object({ serviceId: id, counterId: id });
const counterInput = z.object({ counterId: id });
const json = <T>(schema: z.ZodType<T>, value: unknown): T => { const parsed = schema.safeParse(value); if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues.map(x => x.message).join(', ')); return parsed.data; };
const tokenSelect = `select t.*, s.name as service_name, s.average_duration, c.name as counter_name, greatest(coalesce(t.queue_position, 1) - 1, 0)::int as "peopleAhead" from public.tokens t join public.services s on s.id=t.service_id left join public.counters c on c.id=t.counter_id`;
const staffInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), password: z.string().min(8).max(100), counterId: id.optional(), serviceIds: z.array(id).min(1).optional() }).refine(input => Boolean(input.counterId) === Boolean(input.serviceIds), 'Select a counter and at least one allowed service together');
const staffAssignmentInput = z.object({ counterId: id.nullable(), serviceIds: z.array(id).min(1).optional() }).refine(input => Boolean(input.counterId) === Boolean(input.serviceIds), 'Select a counter and at least one allowed service together');
const serviceIds = z.array(id).min(1).refine(values => new Set(values).size === values.length, 'Service IDs must be unique');
const counterServiceInput = z.object({ serviceIds });
const categoryInput = z.object({ name: z.string().trim().min(2).max(100), status: z.enum(['active', 'inactive']).optional() });
const categoryUpdateInput = categoryInput.partial().refine(value => Object.keys(value).length > 0);
const branchInput = z.object({ name: z.string().trim().min(2).max(100), address: z.string().trim().min(2).max(300), categoryId: id });
const branchUpdateInput = branchInput.partial().extend({ status: z.enum(['open', 'closed']).optional() }).refine(value => Object.keys(value).length > 0);
const activeCustomerTokenStatuses = ['waiting', 'called', 'serving', 'skipped'] as const;
const assertStaff = async (staffId: string | null | undefined) => { if (!staffId) return; const result = await query(`select id from public.users where id=$1 and role='staff' and is_active=true`, [staffId]); if (!result.rowCount) throw new ApiError(400, 'STAFF_NOT_FOUND', 'Active staff user not found'); };
const assertStaffBranchAccess = async (user: { id: string; role: string }, branchId: string) => { if (user.role === 'admin') return; const result = await query(`select 1 from public.counters where branch_id=$1 and staff_id=$2`, [branchId, user.id]); if (!result.rowCount) throw new ApiError(403, 'BRANCH_NOT_ASSIGNED', 'You can only access your assigned branch'); };
const assertNoTokens = async (client: { query: typeof query }, column: 'branch_id' | 'service_id' | 'counter_id', resourceId: string, resource: string, activeOnly = false) => {
  const activeFilter = activeOnly ? ` and status in ('waiting','called','serving')` : '';
  const tokens = await client.query(`select 1 from public.tokens where ${column}=$1${activeFilter} limit 1`, [resourceId]);
  if (tokens.rowCount) throw new ApiError(409, `${resource.toUpperCase()}_HAS_TOKENS`, activeOnly ? `Cannot turn off this ${resource} while it has active queue tokens` : `Cannot delete this ${resource} because token history depends on it`);
};
const assertServiceNotAssigned = async (client: { query: typeof query }, serviceId: string, activeCountersOnly = false) => {
  const statusFilter = activeCountersOnly ? ` and c.status in ('active','busy')` : '';
  const assignments = await client.query(`select 1 from public.counter_services cs join public.counters c on c.id=cs.counter_id where cs.service_id=$1${statusFilter} limit 1`, [serviceId]);
  if (assignments.rowCount) throw new ApiError(409, 'SERVICE_ASSIGNED_TO_COUNTER', activeCountersOnly ? 'Remove this service from active counters before turning it off' : 'Remove this service from counters before deleting it');
};
const assignStaffCounterServices = async (client: { query: typeof query }, staffId: string, counterId: string | null | undefined, selectedServiceIds: string[] | undefined) => {
  await client.query(`update public.counters set staff_id=null where staff_id=$1`, [staffId]);
  await client.query(`delete from public.staff_counter_services where staff_id=$1`, [staffId]);
  if (!counterId || !selectedServiceIds) return null;
  const counter = await client.query<{ id: string; name: string; branch_id: string }>(`select id,name,branch_id from public.counters where id=$1 for update`, [counterId]);
  if (!counter.rowCount) throw new ApiError(404, 'COUNTER_NOT_FOUND', 'Counter not found');
  const valid = await client.query(`select cs.service_id from public.counter_services cs join public.services s on s.id=cs.service_id and s.status='active' where cs.counter_id=$1 and cs.service_id=any($2::uuid[])`, [counterId, selectedServiceIds]);
  if (valid.rowCount !== selectedServiceIds.length) throw new ApiError(400, 'SERVICE_NOT_ASSIGNED', 'Every allowed service must be an active service at the selected counter');
  await client.query(`delete from public.staff_counter_services where counter_id=$1`, [counterId]);
  await client.query(`update public.counters set staff_id=$2 where id=$1`, [counterId, staffId]);
  await client.query(`insert into public.staff_counter_services(staff_id,counter_id,service_id) select $1,$2,unnest($3::uuid[])`, [staffId, counterId, selectedServiceIds]);
  return counter.rows[0];
};

export const router = Router();
router.get('/health', (_req, res) => ok(res, { timestamp: new Date().toISOString() }, 'QueueLess API is running'));

router.get('/categories', asyncRoute(async (_req, res) => {
  const result = await query(`select c.id,c.name,c.status,count(b.id)::int as "branchCount" from public.categories c left join public.branches b on b.category_id=c.id where c.status='active' group by c.id order by c.name`);
  ok(res, result.rows);
}));
router.get('/admin/categories', requireAuth(['admin']), asyncRoute(async (_req, res) => {
  const result = await query(`select c.id,c.name,c.status,c.created_at,count(b.id)::int as "branchCount" from public.categories c left join public.branches b on b.category_id=c.id group by c.id order by c.name`);
  ok(res, result.rows);
}));
router.post('/admin/categories', requireAuth(['admin']), asyncRoute(async (req, res) => {
  const input = json(categoryInput, req.body);
  const existing = await query(`select 1 from public.categories where lower(name)=lower($1)`, [input.name]);
  if (existing.rowCount) throw new ApiError(409, 'CATEGORY_NAME_EXISTS', 'A category with this name already exists');
  const created = await query(`insert into public.categories(name,status) values($1,$2) returning *`, [input.name, input.status ?? 'active']);
  ok(res, created.rows[0], 'Category created', 201);
}));
router.put('/admin/categories/:categoryId', requireAuth(['admin']), asyncRoute(async (req, res) => {
  const categoryId = id.parse(req.params.categoryId); const input = json(categoryUpdateInput, req.body);
  const updated = await transaction(async client => {
    const category = await client.query<{ id: string; status: string }>(`select id,status from public.categories where id=$1 for update`, [categoryId]);
    if (!category.rowCount) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    if (input.name) {
      const duplicate = await client.query(`select 1 from public.categories where lower(name)=lower($1) and id<>$2`, [input.name, categoryId]);
      if (duplicate.rowCount) throw new ApiError(409, 'CATEGORY_NAME_EXISTS', 'A category with this name already exists');
    }
    if (input.status === 'inactive' && category.rows[0].status !== 'inactive') {
      const activeTokens = await client.query(`select 1 from public.tokens t join public.branches b on b.id=t.branch_id where b.category_id=$1 and t.status in ('waiting','called','serving') limit 1`, [categoryId]);
      if (activeTokens.rowCount) throw new ApiError(409, 'CATEGORY_HAS_ACTIVE_TOKENS', 'Resolve active queue tokens before turning this category off');
      await client.query(`update public.counters c set status='closed' from public.branches b where c.branch_id=b.id and b.category_id=$1`, [categoryId]);
      await client.query(`update public.services s set status='inactive' from public.branches b where s.branch_id=b.id and b.category_id=$1`, [categoryId]);
      await client.query(`update public.branches set status='closed' where category_id=$1`, [categoryId]);
      await client.query(`update public.users u set is_active=false where u.role='staff' and exists(select 1 from public.counters c join public.branches b on b.id=c.branch_id where c.staff_id=u.id and b.category_id=$1)`, [categoryId]);
    }
    if (input.status === 'active' && category.rows[0].status !== 'active') await client.query(`update public.users u set is_active=true where u.role='staff' and exists(select 1 from public.counters c join public.branches b on b.id=c.branch_id where c.staff_id=u.id and b.category_id=$1)`, [categoryId]);
    return (await client.query(`update public.categories set name=coalesce($2,name),status=coalesce($3,status) where id=$1 returning *`, [categoryId, input.name ?? null, input.status ?? null])).rows[0];
  });
  ok(res, updated, 'Category updated');
}));
router.delete('/admin/categories/:categoryId', requireAuth(['admin']), asyncRoute(async (req, res) => {
  const categoryId = id.parse(req.params.categoryId);
  await transaction(async client => {
    const category = await client.query(`select id from public.categories where id=$1 for update`, [categoryId]);
    if (!category.rowCount) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    const branches = await client.query(`select 1 from public.branches where category_id=$1 limit 1`, [categoryId]);
    if (branches.rowCount) throw new ApiError(409, 'CATEGORY_HAS_BRANCHES', 'Move or delete the category branches before deleting this category');
    await client.query(`delete from public.categories where id=$1`, [categoryId]);
  });
  ok(res, null, 'Category deleted');
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = json(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const result = await query<{ id: string; name: string; role: 'admin' | 'staff'; password_hash: string; is_active: boolean }>('select id,name,role,password_hash,is_active from public.users where email=$1 and role in (\'admin\',\'staff\')', [email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password'); if (!user.is_active) throw new ApiError(403, 'ACCOUNT_INACTIVE', 'This staff account is inactive because its assigned category is inactive');
  const safeUser = { id: user.id, name: user.name, role: user.role };
  ok(res, { token: signToken(safeUser), user: safeUser }, 'Logged in successfully');
}));

router.get('/staff/assignment', requireAuth(['staff']), asyncRoute(async (req, res) => {
  const result = await query<{ branch_id: string; branch_name: string; branch_status: string; counter_id: string; counter_name: string; counter_status: string; current_token: string | null; services: Array<{ id: string; name: string; prefix: string; average_duration: number; waitingCount: number }> }>(`
    select b.id as branch_id,b.name as branch_name,b.status as branch_status,c.id as counter_id,c.name as counter_name,c.status as counter_status,t.token_number as current_token,
      coalesce(json_agg(json_build_object('id',s.id,'name',s.name,'prefix',s.prefix,'average_duration',s.average_duration,'waitingCount',coalesce(waiting.count,0)) order by s.name) filter(where s.id is not null),'[]'::json) as services
    from public.counters c
    join public.branches b on b.id=c.branch_id
    left join public.tokens t on t.counter_id=c.id and t.status in ('called','serving')
    left join public.staff_counter_services cs on cs.counter_id=c.id and cs.staff_id=c.staff_id
    left join public.services s on s.id=cs.service_id and s.status='active'
    left join lateral (select count(*)::int as count from public.tokens wt where wt.service_id=s.id and wt.status='waiting') waiting on true
    where c.staff_id=$1
    group by b.id,b.name,b.status,c.id,c.name,c.status,t.token_number
    order by c.name
  `, [req.user!.id]);
  const assignment = result.rows[0];
  if (!assignment) throw new ApiError(409, 'COUNTER_NOT_ASSIGNED', 'No counter is assigned to this staff account');
  ok(res, { branch: { id: assignment.branch_id, name: assignment.branch_name, status: assignment.branch_status }, counter: { id: assignment.counter_id, name: assignment.counter_name, status: assignment.counter_status, current_token: assignment.current_token, service_ids: assignment.services.map(service => service.id) }, services: assignment.services }, 'Staff assignment loaded');
}));

router.get('/admin/staff', requireAuth(['admin']), asyncRoute(async (_req, res) => {
  const result = await query(`select u.id,u.name,u.email,u.is_active,u.created_at,c.id as counter_id,c.name as counter_name,c.branch_id,coalesce(json_agg(json_build_object('id',s.id,'name',s.name)) filter(where s.id is not null),'[]'::json) as services from public.users u left join public.counters c on c.staff_id=u.id left join public.staff_counter_services scs on scs.staff_id=u.id and scs.counter_id=c.id left join public.services s on s.id=scs.service_id where u.role='staff' group by u.id,c.id order by u.name`);
  ok(res, result.rows);
}));
router.post('/admin/staff', requireAuth(['admin']), asyncRoute(async (req, res) => {
  const input = json(staffInput, req.body);
  const staff = await transaction(async client => {
    const created = await client.query<{ id: string; name: string; email: string }>(`insert into public.users(name,email,password_hash,role) values($1,$2,$3,'staff') returning id,name,email`, [input.name, input.email.toLowerCase(), await hashPassword(input.password)]);
    const assignment = await assignStaffCounterServices(client, created.rows[0].id, input.counterId, input.serviceIds);
    return { ...created.rows[0], assignment };
  });
  ok(res, staff, 'Staff user created', 201);
}));
router.patch('/admin/staff/:staffId/counter', requireAuth(['admin']), asyncRoute(async (req, res) => {
  const staffId = id.parse(req.params.staffId); const { counterId, serviceIds } = json(staffAssignmentInput, req.body);
  const assignment = await transaction(async client => {
    const staff = await client.query(`select id from public.users where id=$1 and role='staff' for update`, [staffId]);
    if (!staff.rowCount) throw new ApiError(404, 'STAFF_NOT_FOUND', 'Staff user not found');
    return assignStaffCounterServices(client, staffId, counterId, serviceIds);
  });
  ok(res, assignment, assignment ? 'Staff counter assigned' : 'Staff counter unassigned');
}));

// Customer sign-up and sign-in happen in the Android app through Supabase Google OAuth.
// This endpoint verifies the Supabase access token and creates/updates the local customer profile.
router.post('/auth/customer/session', asyncRoute(async (req, res) => {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHORIZED', 'A Supabase access token is required');

  const { data, error } = await supabaseAuth.auth.getUser(authorization.slice(7));
  const user = data.user;
  if (error || !user) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired Supabase access token');
  if (!user.identities?.some(identity => identity.provider === 'google')) {
    throw new ApiError(403, 'GOOGLE_SIGN_IN_REQUIRED', 'Customer accounts must use Google Sign-In');
  }
  if (!user.email) throw new ApiError(400, 'EMAIL_REQUIRED', 'A Google account email address is required');

  const name = typeof user.user_metadata.full_name === 'string' && user.user_metadata.full_name.trim().length >= 2
    ? user.user_metadata.full_name.trim().slice(0, 100)
    : user.email.split('@')[0];
  const existingEmail = await query<{ auth_user_id: string | null }>('select auth_user_id from public.users where email=$1', [user.email.toLowerCase()]);
  if (existingEmail.rowCount && existingEmail.rows[0].auth_user_id !== user.id) {
    throw new ApiError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already assigned to a dashboard account');
  }
  const profile = await query<{ id: string; name: string; email: string; mobile: string | null; role: string }>(
    `insert into public.users (name, email, auth_user_id, auth_provider, role)
     values ($1, $2, $3, 'google', 'customer')
     on conflict (auth_user_id) do update set name = excluded.name, email = excluded.email
     returning id, name, email, mobile, role`,
    [name, user.email.toLowerCase(), user.id]
  );
  ok(res, profile.rows[0], 'Google customer session verified');
}));

router.get('/branches', asyncRoute(async (req, res) => {
  const categoryId = req.query.categoryId ? id.parse(req.query.categoryId) : undefined;
  const result = await query(`select b.*,c.name as category_name,c.status as category_status,count(t.id) filter (where t.status='waiting')::int as "waitingCount",coalesce(sum(t.estimated_wait_time) filter (where t.status='waiting'),0)::int as "estimatedWaitTime" from public.branches b join public.categories c on c.id=b.category_id left join public.tokens t on t.branch_id=b.id where ($1::uuid is null or b.category_id=$1) group by b.id,c.id order by c.name,b.name`, [categoryId ?? null]);
  ok(res, result.rows);
}));
router.post('/branches', requireAuth(['admin']), asyncRoute(async (req, res) => { const input = json(branchInput, req.body); const created = await transaction(async client => { const category = await client.query(`select id from public.categories where id=$1 and status='active'`, [input.categoryId]); if (!category.rowCount) throw new ApiError(409, 'CATEGORY_INACTIVE', 'Choose an active category for the branch'); return (await client.query(`insert into public.branches(name,address,category_id) values($1,$2,$3) returning *`, [input.name, input.address, input.categoryId])).rows[0]; }); ok(res, created, 'Branch created', 201); }));
router.get('/branches/:branchId', asyncRoute(async (req, res) => { const result = await query(`select b.*,c.name as category_name,c.status as category_status from public.branches b join public.categories c on c.id=b.category_id where b.id=$1`, [id.parse(req.params.branchId)]); if (!result.rowCount) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Branch not found'); ok(res, result.rows[0]); }));
router.put('/branches/:branchId', requireAuth(['admin']), asyncRoute(async (req, res) => { const branchId = id.parse(req.params.branchId); const input = json(branchUpdateInput, req.body); const updated = await transaction(async client => { const current = await client.query<{ id: string; status: string; category_status: string }>(`select b.id,b.status,c.status as category_status from public.branches b join public.categories c on c.id=b.category_id where b.id=$1 for update`, [branchId]); if (!current.rowCount) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Branch not found'); if (input.status === 'closed' && current.rows[0].status !== 'closed') await assertNoTokens(client, 'branch_id', branchId, 'branch', true); if (input.status === 'open' && current.rows[0].category_status !== 'active') throw new ApiError(409, 'CATEGORY_INACTIVE', 'Activate the parent category before opening this branch'); if (input.categoryId) { const category = await client.query(`select id from public.categories where id=$1 and status='active'`, [input.categoryId]); if (!category.rowCount) throw new ApiError(409, 'CATEGORY_INACTIVE', 'Choose an active category for the branch'); } return (await client.query(`update public.branches set name=coalesce($2,name),address=coalesce($3,address),category_id=coalesce($4,category_id),status=coalesce($5,status) where id=$1 returning *`, [branchId, input.name ?? null, input.address ?? null, input.categoryId ?? null, input.status ?? null])).rows[0]; }); ok(res, updated, 'Branch updated'); }));
router.delete('/branches/:branchId', requireAuth(['admin']), asyncRoute(async (req, res) => { const branchId = id.parse(req.params.branchId); await transaction(async client => { const branch = await client.query(`select id from public.branches where id=$1 for update`, [branchId]); if (!branch.rowCount) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Branch not found'); await assertNoTokens(client, 'branch_id', branchId, 'branch'); await client.query(`delete from public.branches where id=$1`, [branchId]); }); ok(res, null, 'Branch deleted'); }));
router.get('/branches/:branchId/services', asyncRoute(async (req, res) => { const result = await query(`select s.*, count(t.id) filter (where t.status='waiting')::int as "waitingCount" from public.services s left join public.tokens t on t.service_id=s.id where s.branch_id=$1 group by s.id order by s.name`, [id.parse(req.params.branchId)]); ok(res, result.rows); }));
router.post('/services', requireAuth(['admin']), asyncRoute(async (req, res) => { const input = json(z.object({ branchId: id, name: z.string().trim().min(2).max(100), prefix: z.string().trim().min(1).max(8), averageDuration: z.number().int().min(1).max(240) }), req.body); const created = await transaction(async client => { const branch = await client.query(`select id from public.branches where id=$1 and status='open'`, [input.branchId]); if (!branch.rowCount) throw new ApiError(409, 'BRANCH_CLOSED', 'Services can only be added to an open branch'); return (await client.query('insert into public.services(branch_id,name,prefix,average_duration) values($1,$2,$3,$4) returning *', [input.branchId, input.name, input.prefix.toUpperCase(), input.averageDuration])).rows[0]; }); ok(res, created, 'Service created', 201); }));
router.put('/services/:serviceId', requireAuth(['admin']), asyncRoute(async (req, res) => { const serviceId = id.parse(req.params.serviceId); const input = json(z.object({ name: z.string().trim().min(2).max(100).optional(), prefix: z.string().trim().min(1).max(8).optional(), averageDuration: z.number().int().min(1).max(240).optional(), status: z.enum(['active', 'inactive']).optional() }).refine(x => Object.keys(x).length > 0), req.body); const updated = await transaction(async client => { const current = await client.query<{ id: string; branch_id: string; status: string; branch_status: string; category_status: string }>(`select s.id,s.branch_id,s.status,b.status as branch_status,c.status as category_status from public.services s join public.branches b on b.id=s.branch_id join public.categories c on c.id=b.category_id where s.id=$1 for update`, [serviceId]); if (!current.rowCount) throw new ApiError(404, 'SERVICE_NOT_FOUND', 'Service not found'); if (input.status === 'inactive' && current.rows[0].status !== 'inactive') { await assertNoTokens(client, 'service_id', serviceId, 'service', true); await assertServiceNotAssigned(client, serviceId, true); } if (input.status === 'active' && current.rows[0].category_status !== 'active') throw new ApiError(409, 'CATEGORY_INACTIVE', 'Activate the parent category before activating this service'); if (input.status === 'active' && current.rows[0].branch_status !== 'open') throw new ApiError(409, 'BRANCH_CLOSED', 'Open the parent branch before activating this service'); return (await client.query('update public.services set name=coalesce($2,name),prefix=coalesce($3,prefix),average_duration=coalesce($4,average_duration),status=coalesce($5,status) where id=$1 returning *', [serviceId, input.name ?? null, input.prefix?.toUpperCase() ?? null, input.averageDuration ?? null, input.status ?? null])).rows[0]; }); ok(res, updated, 'Service updated'); }));
router.delete('/services/:serviceId', requireAuth(['admin']), asyncRoute(async (req, res) => { const serviceId = id.parse(req.params.serviceId); await transaction(async client => { const service = await client.query(`select id from public.services where id=$1 for update`, [serviceId]); if (!service.rowCount) throw new ApiError(404, 'SERVICE_NOT_FOUND', 'Service not found'); await assertNoTokens(client, 'service_id', serviceId, 'service'); await assertServiceNotAssigned(client, serviceId); await client.query('delete from public.services where id=$1', [serviceId]); }); ok(res, null, 'Service deleted'); }));

router.post('/tokens', requireCustomerAuth, asyncRoute(async (req, res) => {
  const input = json(tokenInput, req.body);
  const customer = req.customer!;
  const token = await transaction(async client => {
    // Serialise token creation per customer so two simultaneous join requests cannot bypass the active-token check.
    await client.query(`select id from public.users where id=$1 for update`, [customer.id]);
    const active = await client.query<{ token_number: string }>(`select token_number from public.tokens where customer_id=$1 and service_id=$2 and status=any($3::public.token_status[]) order by created_at desc limit 1`, [customer.id, input.serviceId, activeCustomerTokenStatuses]);
    if (active.rowCount) throw new ApiError(409, 'ACTIVE_TOKEN_EXISTS', `Resolve active token ${active.rows[0].token_number} before joining this service again`);
    if (input.fcmToken !== undefined) await client.query(`update public.users set fcm_token=$2, fcm_token_updated_at=now() where id=$1`, [customer.id, input.fcmToken]);
    const service = await client.query<{ id: string; prefix: string; average_duration: number; status: string; branch_status: string; category_status: string }>(`select s.id,s.prefix,s.average_duration,s.status,b.status as branch_status,c.status as category_status from public.services s join public.branches b on b.id=s.branch_id join public.categories c on c.id=b.category_id where s.id=$1 and s.branch_id=$2 for update`, [input.serviceId, input.branchId]);
    const row = service.rows[0]; if (!row) throw new ApiError(404, 'SERVICE_NOT_FOUND', 'Service does not belong to this branch'); if (row.category_status !== 'active') throw new ApiError(409, 'CATEGORY_INACTIVE', 'Category is inactive'); if (row.branch_status !== 'open') throw new ApiError(409, 'BRANCH_CLOSED', 'Branch is closed'); if (row.status !== 'active') throw new ApiError(409, 'SERVICE_INACTIVE', 'Service is inactive');
    const seq = await client.query<{ current_sequence: number }>('update public.services set current_sequence=current_sequence+1 where id=$1 returning current_sequence', [input.serviceId]);
    const sequence = seq.rows[0].current_sequence; const created = await client.query(`insert into public.tokens(token_number,sequence_number,customer_id,customer_name,mobile,branch_id,service_id) values($1,$2,$3,$4,$5,$6,$7) returning *`, [`${row.prefix}-${sequence}`, sequence, customer.id, customer.name, customer.mobile, input.branchId, input.serviceId]);
    await recalculateQueue(client, input.serviceId); return (await client.query(`${tokenSelect} where t.id=$1`, [created.rows[0].id])).rows[0];
  });
  await enqueueTokenNotification(token.id, 'joined');
  await notifyThreeAhead(input.serviceId);
  ok(res, token, 'Token created successfully', 201);
}));
router.get('/tokens/history', requireCustomerAuth, asyncRoute(async (req, res) => {
  const branchId = req.query.branchId ? id.parse(req.query.branchId) : undefined;
  const limit = req.query.limit ? z.coerce.number().int().min(1).max(100).parse(req.query.limit) : 50;
  const result = await query(`${tokenSelect} where t.customer_id=$1 and ($2::uuid is null or t.branch_id=$2) order by t.created_at desc,t.id desc limit $3`, [req.customer!.id, branchId ?? null, limit]);
  ok(res, result.rows);
}));
router.get('/tokens/:tokenId', requireCustomerAuth, asyncRoute(async (req, res) => { const result = await query(`${tokenSelect} where t.id=$1 and t.customer_id=$2`, [id.parse(req.params.tokenId), req.customer!.id]); if (!result.rowCount) throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found'); ok(res, result.rows[0]); }));
router.get('/tokens/:tokenId/status', requireCustomerAuth, asyncRoute(async (req, res) => { const result = await query(`select id,token_number,status,queue_position,greatest(coalesce(queue_position,1)-1,0)::int as "peopleAhead",estimated_wait_time,counter_id,updated_at from public.tokens where id=$1 and customer_id=$2`, [id.parse(req.params.tokenId), req.customer!.id]); if (!result.rowCount) throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found'); ok(res, result.rows[0]); }));
router.put('/customers/notification-token', requireCustomerAuth, asyncRoute(async (req, res) => { const input = json(z.object({ fcmToken: fcmToken.nullable() }), req.body); await query(`update public.users set fcm_token=$2, fcm_token_updated_at=now() where id=$1`, [req.customer!.id, input.fcmToken]); ok(res, null, input.fcmToken ? 'Notification token updated' : 'Notification token cleared'); }));

router.get('/queues/:branchId', requireAuth(), asyncRoute(async (req, res) => { const branchId = id.parse(req.params.branchId); await assertStaffBranchAccess(req.user!, branchId); const serviceId = req.query.serviceId ? id.parse(req.query.serviceId) : undefined; const status = req.query.status ? z.enum(['waiting', 'called', 'serving', 'skipped', 'completed', 'cancelled']).parse(req.query.status) : undefined; const result = await query(`${tokenSelect} where t.branch_id=$1 and ($2::uuid is null or t.service_id=$2) and ($3::public.token_status is null or t.status=$3) and ($4::public.user_role='admin' or exists(select 1 from public.counters sc join public.staff_counter_services scs on scs.counter_id=sc.id where sc.staff_id=$5 and sc.branch_id=t.branch_id and scs.staff_id=$5 and scs.service_id=t.service_id)) and ($4::public.user_role='admin' or t.status in ('waiting','skipped','cancelled') or t.counter_id in(select id from public.counters where staff_id=$5)) order by case when t.status='waiting' then 0 else 1 end,t.queue_position nulls last,t.created_at`, [branchId, serviceId ?? null, status ?? null, req.user!.role, req.user!.id]); ok(res, result.rows); }));
router.post('/queues/:branchId/call-next', requireAuth(), asyncRoute(async (req, res) => { const branchId = id.parse(req.params.branchId); const input = json(callInput, req.body); const token = await transaction(async client => { const service = await client.query('select s.id from public.services s join public.branches b on b.id=s.branch_id and b.status=\'open\' join public.categories c on c.id=b.category_id and c.status=\'active\' join public.counter_services cs on cs.service_id=s.id and cs.counter_id=$3 where s.id=$1 and s.branch_id=$2 and s.status=\'active\' and ($4::public.user_role=\'admin\' or exists(select 1 from public.staff_counter_services scs where scs.staff_id=$5 and scs.counter_id=$3 and scs.service_id=s.id)) for update', [input.serviceId, branchId, input.counterId, req.user!.role, req.user!.id]); if (!service.rowCount) throw new ApiError(403, 'SERVICE_NOT_ASSIGNED', 'This staff account is not allowed to serve the selected service at this counter'); const counter = await client.query('select id from public.counters where id=$1 and branch_id=$2 and status=\'active\' and ($3::public.user_role=\'admin\' or staff_id=$4) for update', [input.counterId, branchId, req.user!.role, req.user!.id]); if (!counter.rowCount) throw new ApiError(403, 'COUNTER_NOT_ASSIGNED', 'You can only operate your assigned active counter'); const next = await client.query<{ id: string }>('select id from public.tokens where branch_id=$1 and service_id=$2 and status=\'waiting\' order by coalesce(restored_at,created_at),created_at limit 1 for update skip locked', [branchId, input.serviceId]); if (!next.rowCount) throw new ApiError(409, 'EMPTY_QUEUE', 'No waiting token is available'); const updated = await client.query(`update public.tokens set status='called',counter_id=$2,called_at=now() where id=$1 and status='waiting' returning *`, [next.rows[0].id, input.counterId]); await client.query('update public.counters set status=\'busy\' where id=$1', [input.counterId]); await recalculateQueue(client, input.serviceId); return (await client.query(`${tokenSelect} where t.id=$1`, [updated.rows[0].id])).rows[0]; }); await enqueueTokenNotification(token.id, 'called'); await notifyThreeAhead(input.serviceId); ok(res, token, 'Next token called'); }));

const updateToken = (next: TokenStatus, needsCounter = false) => asyncRoute(async (req, res) => { const tokenId = id.parse(req.params.tokenId); const input = needsCounter ? json(counterInput, req.body) : undefined; const updated = await transaction(async client => { const found = await client.query<{ id: string; status: TokenStatus; service_id: string; branch_id: string; counter_id: string | null }>('select id,status,service_id,branch_id,counter_id from public.tokens where id=$1 for update', [tokenId]); const current = found.rows[0]; if (!current) throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found'); assertTransition(current.status, next); if (next === 'serving' && !current.counter_id) throw new ApiError(409, 'COUNTER_NOT_FOUND', 'A counter must be assigned before service can start'); const counterId = input?.counterId ?? current.counter_id; if (req.user!.role === 'staff') { const managedCounter = counterId ?? current.counter_id; if (managedCounter) { const ownership = await client.query(`select id from public.counters where id=$1 and staff_id=$2`, [managedCounter, req.user!.id]); if (!ownership.rowCount) throw new ApiError(403, 'COUNTER_NOT_ASSIGNED', 'You can only manage tokens at your assigned counter'); } else if (current.status === 'waiting' && ['skipped', 'cancelled'].includes(next)) { const permission = await client.query(`select 1 from public.counters c join public.staff_counter_services scs on scs.counter_id=c.id where c.staff_id=$1 and c.branch_id=$2 and scs.staff_id=$1 and scs.service_id=$3 limit 1`, [req.user!.id, current.branch_id, current.service_id]); if (!permission.rowCount) throw new ApiError(403, 'SERVICE_NOT_ASSIGNED', 'You can only manage waiting tokens for services assigned to your counter'); } else throw new ApiError(403, 'COUNTER_NOT_ASSIGNED', 'Staff can only manage tokens assigned to their counter'); } if (next === 'called') { const counter = await client.query('select id from public.counters where id=$1 and branch_id=$2 and status=\'active\' and ($3::public.user_role=\'admin\' or staff_id=$4) for update', [counterId, current.branch_id, req.user!.role, req.user!.id]); if (!counter.rowCount) throw new ApiError(403, 'COUNTER_NOT_ASSIGNED', 'You can only operate your assigned active counter'); const assignment = await client.query('select 1 from public.counter_services where counter_id=$1 and service_id=$2', [counterId, current.service_id]); if (!assignment.rowCount) throw new ApiError(403, 'SERVICE_NOT_ASSIGNED', 'This counter is not assigned to the token service'); await client.query('update public.counters set status=\'busy\' where id=$1', [counterId]); } const fields: Record<TokenStatus, string> = { waiting: `status='waiting', counter_id=null, restored_at=now()`, called: `status='called', counter_id=$2, called_at=now()`, serving: `status='serving', service_started_at=now()`, completed: `status='completed', completed_at=now()`, skipped: `status='skipped', skipped_at=now()`, cancelled: `status='cancelled', cancelled_at=now()` }; const result = await client.query(`update public.tokens set ${fields[next]} where id=$1 returning *`, next === 'called' ? [tokenId, counterId] : [tokenId]); if (['completed', 'skipped', 'cancelled'].includes(next) && current.counter_id) await client.query('update public.counters set status=\'active\' where id=$1', [current.counter_id]); await recalculateQueue(client, current.service_id); return (await client.query(`${tokenSelect} where t.id=$1`, [result.rows[0].id])).rows[0]; }); const notificationType: Record<TokenStatus, NotificationType> = { waiting: 'restored', called: 'called', serving: 'service_started', skipped: 'skipped', completed: 'completed', cancelled: 'cancelled' }; await enqueueTokenNotification(updated.id, notificationType[next]); await notifyThreeAhead(updated.service_id); ok(res, updated, `Token ${next}`); });
router.patch('/tokens/:tokenId/call', requireAuth(), updateToken('called', true)); router.patch('/tokens/:tokenId/start', requireAuth(), updateToken('serving')); router.patch('/tokens/:tokenId/complete', requireAuth(), updateToken('completed')); router.patch('/tokens/:tokenId/skip', requireAuth(), updateToken('skipped')); router.patch('/tokens/:tokenId/restore', requireAuth(), updateToken('waiting')); router.patch('/staff/tokens/:tokenId/cancel', requireAuth(), updateToken('cancelled'));
router.patch('/tokens/:tokenId/cancel', requireCustomerAuth, asyncRoute(async (req, res) => { const tokenId = id.parse(req.params.tokenId); const updated = await transaction(async client => { const found = await client.query<{ id: string; status: TokenStatus; service_id: string; counter_id: string | null }>('select id,status,service_id,counter_id from public.tokens where id=$1 and customer_id=$2 for update', [tokenId, req.customer!.id]); const token = found.rows[0]; if (!token) throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found'); assertTransition(token.status, 'cancelled'); const result = await client.query(`update public.tokens set status='cancelled', cancelled_at=now() where id=$1 returning *`, [token.id]); if (token.counter_id) await client.query(`update public.counters set status='active' where id=$1 and status='busy'`, [token.counter_id]); await recalculateQueue(client, token.service_id); return result.rows[0]; }); await enqueueTokenNotification(updated.id, 'cancelled'); await notifyThreeAhead(updated.service_id); ok(res, updated, 'Token cancelled'); }));

router.get('/counters', requireAuth(), asyncRoute(async (req, res) => { const branchId = req.query.branchId ? id.parse(req.query.branchId) : undefined; const result = await query(`select c.*,u.name as staff_name,t.token_number as current_token,coalesce(array_agg(cs.service_id) filter(where cs.service_id is not null),'{}') as service_ids from public.counters c left join public.users u on u.id=c.staff_id left join public.tokens t on t.counter_id=c.id and t.status in ('called','serving') left join public.counter_services cs on cs.counter_id=c.id where ($1::uuid is null or c.branch_id=$1) and ($2::public.user_role='admin' or c.staff_id=$3) group by c.id,u.name,t.token_number order by c.name`, [branchId ?? null, req.user!.role, req.user!.id]); ok(res, result.rows); }));
router.post('/counters', requireAuth(['admin']), asyncRoute(async (req, res) => { const input = json(z.object({ branchId: id, name: z.string().trim().min(2).max(100), staffId: id.optional(), serviceIds }), req.body); await assertStaff(input.staffId); const result = await transaction(async client => { const branch = await client.query(`select id from public.branches where id=$1 and status='open'`, [input.branchId]); if (!branch.rowCount) throw new ApiError(409, 'BRANCH_CLOSED', 'Counters can only be added to an open branch'); const valid = await client.query(`select id from public.services where branch_id=$1 and status='active' and id=any($2::uuid[])`, [input.branchId, input.serviceIds]); if (valid.rowCount !== input.serviceIds.length) throw new ApiError(400, 'SERVICE_NOT_FOUND', 'Every active counter service must belong to the selected branch'); const created = await client.query(`insert into public.counters(branch_id,name,staff_id) values($1,$2,$3) returning *`, [input.branchId, input.name, input.staffId ?? null]); await client.query(`insert into public.counter_services(counter_id,service_id) select $1,unnest($2::uuid[])`, [created.rows[0].id, input.serviceIds]); return created.rows[0]; }); ok(res, result, 'Counter created', 201); }));
router.put('/counters/:counterId', requireAuth(['admin']), asyncRoute(async (req, res) => { const counterId = id.parse(req.params.counterId); const input = json(z.object({ name: z.string().trim().min(2).max(100).optional(), staffId: id.nullable().optional(), status: z.enum(['active', 'busy', 'paused', 'closed']).optional() }).refine(x => Object.keys(x).length > 0), req.body); const hasStaffId = Object.prototype.hasOwnProperty.call(input, 'staffId'); if (hasStaffId) await assertStaff(input.staffId); const updated = await transaction(async client => { const current = await client.query<{ id: string; branch_id: string; status: string; branch_status: string; category_status: string }>(`select c.id,c.branch_id,c.status,b.status as branch_status,ca.status as category_status from public.counters c join public.branches b on b.id=c.branch_id join public.categories ca on ca.id=b.category_id where c.id=$1 for update`, [counterId]); if (!current.rowCount) throw new ApiError(404, 'COUNTER_NOT_FOUND', 'Counter not found'); if (input.status && input.status !== 'active' && current.rows[0].status === 'busy') throw new ApiError(409, 'COUNTER_BUSY', 'Complete, skip, or cancel the current token before turning this counter off'); if (input.status === 'active' && current.rows[0].category_status !== 'active') throw new ApiError(409, 'CATEGORY_INACTIVE', 'Activate the parent category before activating this counter'); if (input.status === 'active' && current.rows[0].branch_status !== 'open') throw new ApiError(409, 'BRANCH_CLOSED', 'Open the parent branch before activating this counter'); return (await client.query(`update public.counters set name=coalesce($2,name),staff_id=case when $4 then $3::uuid else staff_id end,status=coalesce($5,status) where id=$1 returning *`, [counterId, input.name ?? null, input.staffId ?? null, hasStaffId, input.status ?? null])).rows[0]; }); ok(res, updated, 'Counter updated'); }));
router.delete('/counters/:counterId', requireAuth(['admin']), asyncRoute(async (req, res) => { const counterId = id.parse(req.params.counterId); await transaction(async client => { const counter = await client.query(`select id from public.counters where id=$1 for update`, [counterId]); if (!counter.rowCount) throw new ApiError(404, 'COUNTER_NOT_FOUND', 'Counter not found'); await assertNoTokens(client, 'counter_id', counterId, 'counter'); await client.query(`delete from public.counters where id=$1`, [counterId]); }); ok(res, null, 'Counter deleted'); }));
router.put('/counters/:counterId/services', requireAuth(['admin']), asyncRoute(async (req, res) => { const counterId = id.parse(req.params.counterId); const { serviceIds } = json(counterServiceInput, req.body); const updated = await transaction(async client => { const counter = await client.query<{ branch_id: string; status: string }>(`select branch_id,status from public.counters where id=$1 for update`, [counterId]); if (!counter.rowCount) throw new ApiError(404, 'COUNTER_NOT_FOUND', 'Counter not found'); if (counter.rows[0].status === 'busy') throw new ApiError(409, 'COUNTER_BUSY', 'Complete, skip, or cancel the current token before changing counter services'); const valid = await client.query(`select id from public.services where branch_id=$1 and status='active' and id=any($2::uuid[])`, [counter.rows[0].branch_id, serviceIds]); if (valid.rowCount !== serviceIds.length) throw new ApiError(400, 'SERVICE_NOT_FOUND', 'Every active service must belong to the counter branch'); await client.query(`delete from public.staff_counter_services where counter_id=$1 and service_id<>all($2::uuid[])`, [counterId, serviceIds]); await client.query(`delete from public.counter_services where counter_id=$1`, [counterId]); await client.query(`insert into public.counter_services(counter_id,service_id) select $1,unnest($2::uuid[])`, [counterId, serviceIds]); return valid.rows; }); ok(res, updated, 'Counter services updated'); }));
router.get('/dashboard/summary', requireAuth(), asyncRoute(async (req, res) => { const branchId = req.query.branchId ? id.parse(req.query.branchId) : undefined; if (req.user!.role === 'staff' && !branchId) throw new ApiError(400, 'BRANCH_REQUIRED', 'A branch is required for staff dashboard data'); if (branchId) await assertStaffBranchAccess(req.user!, branchId); const result = await query(`select count(*)::int total,count(*) filter(where status='waiting')::int waiting,count(*) filter(where status='called')::int called,count(*) filter(where status='serving')::int serving,count(*) filter(where status='completed')::int completed,count(*) filter(where status='skipped')::int skipped,count(*) filter(where status='cancelled')::int cancelled,coalesce(round(avg(extract(epoch from (called_at-created_at))/60) filter(where called_at is not null)),0)::int as "averageWaitTime" from public.tokens where ($1::uuid is null or branch_id=$1) and created_at::date=current_date and ($2::public.user_role='admin' or (tokens.status='waiting' and exists(select 1 from public.counters sc join public.staff_counter_services scs on scs.counter_id=sc.id where sc.staff_id=$3 and sc.branch_id=tokens.branch_id and scs.staff_id=$3 and scs.service_id=tokens.service_id)) or tokens.counter_id in(select id from public.counters where staff_id=$3))`, [branchId ?? null, req.user!.role, req.user!.id]); ok(res, result.rows[0]); }));
router.get('/dashboard/current-serving', requireAuth(), asyncRoute(async (req, res) => { const branchId = id.parse(req.query.branchId); await assertStaffBranchAccess(req.user!, branchId); const result = await query(`${tokenSelect} where t.branch_id=$1 and t.status in ('called','serving') and ($2::public.user_role='admin' or t.counter_id in(select id from public.counters where staff_id=$3)) order by t.called_at`, [branchId, req.user!.role, req.user!.id]); ok(res, result.rows); }));
router.get('/dashboard/analytics', requireAuth(), asyncRoute(async (req, res) => { const branchId = req.query.branchId ? id.parse(req.query.branchId) : undefined; if (req.user!.role === 'staff' && !branchId) throw new ApiError(400, 'BRANCH_REQUIRED', 'A branch is required for staff analytics'); if (branchId) await assertStaffBranchAccess(req.user!, branchId); const result = await query(`select s.name as service, count(t.id)::int as total, count(t.id) filter(where t.status='completed')::int as completed, coalesce(round(avg(extract(epoch from (t.completed_at-t.service_started_at))/60) filter(where t.completed_at is not null and t.service_started_at is not null)),0)::int as "averageServiceTime" from public.services s left join public.tokens t on t.service_id=s.id and ($1::uuid is null or t.branch_id=$1) where ($1::uuid is null or s.branch_id=$1) and ($2::public.user_role='admin' or exists(select 1 from public.counters sc join public.counter_services scs on scs.counter_id=sc.id where sc.staff_id=$3 and sc.branch_id=s.branch_id and scs.service_id=s.id)) group by s.id,s.name order by total desc,s.name`, [branchId ?? null, req.user!.role, req.user!.id]); ok(res, { byService: result.rows }); }));
router.get('/public-display/:branchId', asyncRoute(async (req, res) => { const branchId = id.parse(req.params.branchId); const [now, next] = await Promise.all([query(`${tokenSelect} where t.branch_id=$1 and t.status in ('called','serving') order by t.called_at limit 1`, [branchId]), query('select token_number from public.tokens where branch_id=$1 and status=\'waiting\' order by queue_position limit 3', [branchId])]); ok(res, { nowServing: now.rows[0] ? { tokenNumber: now.rows[0].token_number, counter: now.rows[0].counter_name } : null, upNext: next.rows.map(x => x.token_number) }); }));
