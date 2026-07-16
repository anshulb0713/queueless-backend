import { query } from '../database/postgres.js';
import { getFirebaseMessaging } from '../config/firebase.js';

export type NotificationType = 'joined' | 'three_ahead' | 'called' | 'service_started' | 'skipped' | 'restored' | 'completed' | 'cancelled';
type NotificationTarget = { id: string; token_number: string; status: string; fcm_token: string | null; counter_name: string | null };
type NotificationEvent = { id: string; token_id: string; type: NotificationType; attempt_count: number };

const messages: Record<NotificationType, { title: string; body: (token: NotificationTarget) => string }> = {
  joined: { title: 'Queue token created', body: token => `${token.token_number} is in the queue. We will keep you updated.` },
  three_ahead: { title: 'Your turn is near', body: token => `Only three customers are ahead of ${token.token_number}.` },
  called: { title: 'Please proceed to your counter', body: token => `${token.token_number} has been called. Please proceed to ${token.counter_name ?? 'your assigned counter'}.` },
  service_started: { title: 'Service started', body: token => `Your service for ${token.token_number} has started.` },
  skipped: { title: 'Token skipped', body: token => `${token.token_number} was skipped. Contact staff if you are available.` },
  restored: { title: 'Token restored', body: token => `${token.token_number} is back in the waiting queue.` },
  completed: { title: 'Service completed', body: token => `Your service for ${token.token_number} is complete. Thank you.` },
  cancelled: { title: 'Token cancelled', body: token => `${token.token_number} has been cancelled.` }
};

const getTarget = async (tokenId: string) => (await query<NotificationTarget>(`select t.id,t.token_number,t.status,u.fcm_token,c.name as counter_name from public.tokens t join public.users u on u.id=t.customer_id left join public.counters c on c.id=t.counter_id where t.id=$1`, [tokenId])).rows[0];

const scheduleDelivery = (eventId: string) => {
  setImmediate(() => { void deliverNotificationEvent(eventId); });
};

export const enqueueTokenNotification = async (tokenId: string, type: NotificationType) => {
  const target = await getTarget(tokenId);
  if (!target?.fcm_token) return;
  const result = await query<{ id: string }>(`insert into public.notification_events(token_id,type,status,next_attempt_at) values($1,$2,'pending',now()) on conflict(token_id,type) do nothing returning id`, [tokenId, type]);
  if (result.rowCount) scheduleDelivery(result.rows[0].id);
};

const deliverNotificationEvent = async (eventId: string) => {
  const event = (await query<NotificationEvent>(`select id,token_id,type,attempt_count from public.notification_events where id=$1 and status in ('pending','failed') and next_attempt_at<=now()`, [eventId])).rows[0];
  if (!event) return;
  const target = await getTarget(event.token_id);
  if (!target?.fcm_token) {
    await query(`update public.notification_events set status='skipped', error_message='Customer has no active FCM token' where id=$1`, [event.id]);
    return;
  }
  const firebase = getFirebaseMessaging();
  if (!firebase) {
    await query(`update public.notification_events set status='failed', attempt_count=attempt_count+1, next_attempt_at=now()+interval '5 minutes', error_message='Firebase is not configured' where id=$1`, [event.id]);
    return;
  }
  try {
    const message = messages[event.type];
    await firebase.send({ token: target.fcm_token, notification: { title: message.title, body: message.body(target) }, data: { tokenId: target.id, tokenNumber: target.token_number, type: event.type, status: target.status, counterName: target.counter_name ?? '' } });
    await query(`update public.notification_events set status='sent', sent_at=now(), error_message=null where id=$1`, [event.id]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown notification error';
    const invalidToken = /registration-token-not-registered|invalid-registration-token/i.test(message);
    if (invalidToken) await query(`update public.users set fcm_token=null, fcm_token_updated_at=now() where fcm_token=$1`, [target.fcm_token]);
    const exhausted = event.attempt_count >= 4 || invalidToken;
    await query(`update public.notification_events set status=$2, attempt_count=attempt_count+1, next_attempt_at=now()+make_interval(secs=>least(900, power(2, attempt_count + 1)::int * 30)), error_message=$3 where id=$1`, [event.id, exhausted ? 'skipped' : 'failed', message]);
    console.error(`Failed to send ${event.type} notification for token ${event.token_id}`, error);
  }
};

export const retryPendingNotifications = async () => {
  const events = await query<{ id: string }>(`select id from public.notification_events where status in ('pending','failed') and attempt_count<5 and next_attempt_at<=now() order by created_at limit 25`);
  events.rows.forEach(event => scheduleDelivery(event.id));
};

export const startNotificationWorker = () => {
  const timer = setInterval(() => { void retryPendingNotifications(); }, 30_000);
  timer.unref();
  void retryPendingNotifications();
};

export const notifyThreeAhead = async (serviceId: string) => {
  const tokens = await query<{ id: string }>(`select id from public.tokens where service_id=$1 and status='waiting' and queue_position=4`, [serviceId]);
  await Promise.all(tokens.rows.map(token => enqueueTokenNotification(token.id, 'three_ahead')));
};
