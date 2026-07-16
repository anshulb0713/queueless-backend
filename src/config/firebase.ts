import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { config } from './env.js';

let messaging: Messaging | null | undefined;

export const getFirebaseMessaging = (): Messaging | null => {
  if (messaging !== undefined) return messaging;
  if (!config.firebaseServiceAccountJson) return (messaging = null);
  try {
    const credential = cert(JSON.parse(config.firebaseServiceAccountJson));
    if (!getApps().length) initializeApp({ credential });
    return (messaging = getMessaging());
  } catch (error) {
    console.error('Firebase Admin initialization failed', error);
    return (messaging = null);
  }
};
