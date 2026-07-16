import { query } from '../database/postgres.js';
import { getFirebaseMessaging } from '../config/firebase.js';

export type NotificationType = 'joined' | 'three_ahead' | 'called' | 'service_started' | 'skipped' | 'restored' | 'completed' | 'cancelled';
type NotificationTarget = { id: string; token_number: string; status: string; queue_position: number | null; customer_id: string; fcm_token: string | null };

const messages: Record<NotificationType, { title: string; body: (token: NotificationTarget) => string }> = {
  joined: { title: 'Queue token created', body: token => `${token.token_number} is in the queue. We will keep you updated.` },
  three_ahead: { title: 'Your turn is near', body: token => `Only three customers are ahead of ${token.token_number}.` },
  called: { title: 'Please proceed to your counter', body: token => `${token.token_number} has been called.` },
  service_started: { title: 'Service started', body: token => `Your service for ${token.token_number} has started.` },
  skipped: { title: 'Token skipped', body: token => `${token.token_number} was skipped. Contact staff if you are available.` },
  restored: { title: 'Token restored', body: token => `${token.token_number} is back in the waiting queue.` },
  completed: { title: 'Service completed', body: token => `Your service for ${token.token_number} is complete. Thank you.` },
  cancelled: { title: 'Token cancelled', body: token => `${token.token_number} has been cancelled.` }
};

const getTarget = async (tokenId: string) => {
  const result = await query<NotificationTarget>(`select t.id,t.token_number,t.status,t.queue_position,t.customer_id,u.fcm_token from public.tokens t join public.users u on u.id=t.customer_id where t.id=$1`, [tokenId]);
  return result.rows[0];
};

export const sendTokenNotification = async (tokenId: string, type: NotificationType) => {
  let eventId: string | undefined;
  try {
    const token = await getTarget(tokenId);
    if (!token?.fcm_token) return;
    const event = await query<{ id: string }>(`insert into public.notification_events(token_id,type,status) values($1,$2,'pending') on conflict(token_id,type) do nothing returning id`, [token.id, type]);
    if (!event.rowCount) return; eventId = event.rows[0].id;
    const message = messages[type]; const firebase = getFirebaseMessaging();
    if (!firebase) { await query(`update public.notification_events set status='skipped', error_message='Firebase is not configured' where id=$1`, [eventId]); return; }
    await firebase.send({ token: token.fcm_token, notification: { title: message.title, body: message.body(token) }, data: { tokenId: token.id, tokenNumber: token.token_number, type, status: token.status } });
    await query(`update public.notification_events set status='sent', sent_at=now() where id=$1`, [eventId]);
  } catch (error) {
    if (eventId) await query(`update public.notification_events set status='failed', error_message=$2 where id=$1`, [eventId, error instanceof Error ? error.message.slice(0, 500) : 'Unknown notification error']);
    console.error(`Failed to send ${type} notification for token ${tokenId}`, error);
  }
};

export const notifyThreeAhead = async (serviceId: string) => {
  const tokens = await query<{ id: string }>(`select id from public.tokens where service_id=$1 and status='waiting' and queue_position=4`, [serviceId]);
  await Promise.all(tokens.rows.map(token => sendTokenNotification(token.id, 'three_ahead')));
};
