import { PoolClient } from 'pg';
import { ApiError } from '../middlewares/error.middleware.js';
import { TokenStatus } from '../types/index.js';

export const transitions: Record<TokenStatus, TokenStatus[]> = {
  waiting: ['called', 'skipped', 'cancelled'], called: ['serving', 'skipped', 'cancelled'], serving: ['completed'],
  skipped: ['waiting', 'cancelled'], completed: [], cancelled: []
};
export function assertTransition(current: TokenStatus, next: TokenStatus) { if (!transitions[current].includes(next)) throw new ApiError(409, 'INVALID_STATUS_TRANSITION', `Cannot transition token from ${current.toUpperCase()} to ${next.toUpperCase()}`); }
export async function recalculateQueue(client: PoolClient, serviceId: string) {
  await client.query(`with ranked as (select id, row_number() over (order by coalesce(restored_at, created_at), created_at) as position from public.tokens where service_id = $1 and status = 'waiting') update public.tokens t set queue_position = ranked.position, estimated_wait_time = (ranked.position - 1) * s.average_duration, updated_at = now() from ranked cross join public.services s where t.id = ranked.id and s.id = $1`, [serviceId]);
  await client.query(`update public.tokens set queue_position = null, estimated_wait_time = 0 where service_id = $1 and status <> 'waiting' and queue_position is not null`, [serviceId]);
}
