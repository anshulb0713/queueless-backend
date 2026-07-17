# QueueLess Client API Call Guide

This guide is for the customer mobile application and any public display client. The API base URL is the deployed backend URL followed by `/api` (locally: `http://localhost:3001/api`).

## Authentication rules

Customer-only calls require the Supabase access token created by **Google Sign-In**. Send it on every protected request:

```http
Authorization: Bearer <supabase_google_access_token>
Content-Type: application/json
```

Do not use an admin or staff JWT in the mobile app. The mobile UI only exposes Google Sign-In.

## Google Sign-In setup (web and mobile)

The **Google Client ID** is created in Google Cloud and looks like `1234567890-abc.apps.googleusercontent.com`. It is not a Google username, Supabase project reference, publishable key, or Google ID token.

1. In Google Cloud, create an OAuth client of type **Web application**.
2. Add the app origin as an authorized JavaScript origin. For the local browser test page, use `http://127.0.0.1:5174`.
3. Add the exact Supabase callback URL as an authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase Dashboard → Authentication → Providers → Google shows the exact value.
4. In Supabase Dashboard → Authentication → Providers → Google, enable Google and paste the generated Google **Client ID** and **Client Secret**. If there are multiple platform client IDs, enter them as a comma-separated list with the web client ID first.
5. In Supabase Dashboard → Authentication → URL Configuration, allow the application redirect URL. For the local browser test page, add `http://127.0.0.1:5174`.

Never put `SUPABASE_SECRET_KEY`, the database URL, or `JWT_SECRET` in a browser/mobile client. Only the Supabase URL and publishable key belong in the client.

### Browser test flow

The standalone React test page is at `/Users/anshulborde/anshul/queueless/google-login-test`. Run it with `npm run dev -- --port 5174`, open `http://127.0.0.1:5174`, then enter the Supabase URL and publishable key. It performs:

```ts
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: window.location.origin }
});
if (error) throw error;

// After the redirect, Supabase restores a session in the browser.
await fetch('/api/auth/customer/session', {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.access_token}` }
});
```

The test page proxies `/api` to the local QueueLess backend. It displays the QueueLess customer profile only after this server-side verification succeeds.

## Customer queue flow

| Step | When to call | API | Authentication | What to use from the response |
| --- | --- | --- | --- | --- |
| 1 | App opens | `GET /categories` | None | Active categories such as Bank or Hospital. Render an **All** option locally; it is an aggregate filter, not a category record. |
| 2 | A category is selected | `GET /branches?categoryId={categoryId}` | None | Branch `id`, category, name, status, waiting count, and estimated wait time. Calling `GET /branches` without `categoryId` is the **All** filter. Show only `open` branches as joinable. |
| 3 | A customer selects a branch | `GET /branches/{branchId}/services` | None | Service `id`, prefix, status, duration, and waiting count. Show only `active` services as joinable. |
| 4 | Immediately after Google OAuth succeeds, and before joining a queue | `POST /auth/customer/session` | Google token | Creates or updates the QueueLess customer profile from the verified Google identity. No request body is required. This must succeed before creating a token. |
| 5 | Customer presses **Join queue** | `POST /tokens` | Google token | Send selected `branchId`, `serviceId`, and the current FCM token when available. Persist returned token `id` locally. A customer cannot have two unresolved tokens for the same service, but may join another service. |
| 6 | Token/tracking screen opens or app returns to foreground | `GET /tokens/{tokenId}` | Google token | Full token details including number, queue position, `peopleAhead`, wait estimate, service, and counter. |
| 7 | While the token screen is visible | `GET /tokens/{tokenId}/status` every 5 seconds | Google token | Lightweight polling endpoint. Update status, `peopleAhead`, queue position, estimate, and counter without reloading the entire screen. |
| 8 | Customer opens history | `GET /tokens/history` | Google token | Returns every token for that customer, including cancelled/completed tokens. Optional `branchId` and `limit` filters are available. |
| 9 | FCM token changes or permission is removed | `PUT /customers/notification-token` | Google token | Send `{ "fcmToken": "..." }` to save, or `{ "fcmToken": null }` to clear it. |
| 10 | Customer cancels before service is completed | `PATCH /tokens/{tokenId}/cancel` | Google token | The token is retained with status `cancelled`; remove it only from the active-token screen and show it in history. |

## Request examples

### 1. Verify the Google customer session

```http
POST /api/auth/customer/session
Authorization: Bearer <supabase_google_access_token>
```

## React Native Google sign-up / sign-in

The mobile app must never send a Google ID token directly to QueueLess. First exchange it with Supabase Auth, then send the resulting Supabase access token to QueueLess.

```ts
// 1. Get an ID token from the native Google Sign-In SDK.
const { idToken } = await GoogleSignin.signIn();
if (!idToken) throw new Error('Google did not return an ID token');

// 2. Exchange it for a Supabase session.
const { data, error } = await supabase.auth.signInWithIdToken({
  provider: 'google',
  token: idToken,
});
if (error) throw error;

// 3. Register/refresh the QueueLess profile. No mobile number is sent.
const response = await fetch(`${API_BASE_URL}/auth/customer/session`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${data.session.access_token}` },
});
const payload = await response.json();
if (!response.ok) throw new Error(payload.message);
```

For an Expo OAuth flow that uses a browser redirect instead of a native Google SDK, configure an app URL scheme and the Supabase redirect URL, complete `signInWithOAuth`, then use the returned Supabase session access token in the same QueueLess request above.

### 2. Join a queue and register FCM in the same call

```http
POST /api/tokens
Authorization: Bearer <supabase_google_access_token>
Content-Type: application/json

{
  "branchId": "<branch-uuid>",
  "serviceId": "<service-uuid>",
  "fcmToken": "<firebase-registration-token>"
}
```

### 3. Poll the lightweight status endpoint

```http
GET /api/tokens/<token-uuid>/status
Authorization: Bearer <supabase_google_access_token>
```

Stop polling when the token becomes `completed` or `cancelled`, and when the user signs out. Continue polling in the foreground for `waiting`, `called`, `serving`, and `skipped` tokens.

`peopleAhead` is always present for the token detail and status APIs. It is `queue_position - 1` for a waiting token and `0` after the token is no longer waiting.

## Push-notification behavior

When an FCM token has been saved, QueueLess sends notifications for:

- Token joined
- Three people ahead
- Token called to a counter
- Service started
- Token skipped or restored
- Service completed
- Token cancelled

Notifications improve delivery, but polling remains the source of truth for the current queue state.

## Public display flow

The public display does not authenticate and should poll every 5 seconds:

```http
GET /api/public-display/{branchId}
```

It returns the current token being served and up to three next waiting token numbers. Do not display customer names or mobile numbers.

## Response and error handling

Every successful response uses this envelope:

```json
{ "success": true, "message": "Optional message", "data": {} }
```

Every error uses this envelope:

```json
{ "success": false, "message": "Human-readable explanation", "errorCode": "MACHINE_READABLE_CODE" }
```

Important client actions:

| Error code | Client behavior |
| --- | --- |
| `UNAUTHORIZED` | Refresh the Supabase session or send the user through Google Sign-In again. |
| `GOOGLE_SIGN_IN_REQUIRED` | Do not continue; customer authentication must use Google. |
| `CUSTOMER_PROFILE_INCOMPLETE` | Call `POST /auth/customer/session` again with a valid Supabase Google session. |
| `BRANCH_CLOSED` | Disable joining and return to branch selection. |
| `SERVICE_INACTIVE` | Disable joining and refresh the branch service list. |
| `TOKEN_NOT_FOUND` | Clear the locally saved token ID; it is not owned by the current customer. |
| `INVALID_STATUS_TRANSITION` | Refresh token status; the token may have changed on another device or been actioned by staff. |

For field-level examples and the interactive request console, use the [Client Swagger UI](/docs/client/).
