# QueueLess Client API Call Guide

This guide is for the customer mobile application and any public display client. The API base URL is the deployed backend URL followed by `/api` (locally: `http://localhost:3001/api`).

## Authentication rules

Customer-only calls require the Supabase access token created by **Google Sign-In**. Send it on every protected request:

```http
Authorization: Bearer <supabase_google_access_token>
Content-Type: application/json
```

Do not use an admin or staff JWT in the mobile app. The mobile UI only exposes Google Sign-In.

## Customer queue flow

| Step | When to call | API | Authentication | What to use from the response |
| --- | --- | --- | --- | --- |
| 1 | App opens or the branch picker is shown | `GET /branches` | None | Branch `id`, name, status, waiting count, and estimated wait time. Show only `open` branches as joinable. |
| 2 | A customer selects a branch | `GET /branches/{branchId}/services` | None | Service `id`, prefix, status, duration, and waiting count. Show only `active` services as joinable. |
| 3 | Immediately after Google OAuth succeeds, and before joining a queue | `POST /auth/customer/session` | Google token | Creates or updates the QueueLess customer profile. Send the verified mobile number. This must succeed before creating a token. |
| 4 | Customer presses **Join queue** | `POST /tokens` | Google token | Send selected `branchId`, `serviceId`, and the current FCM token when available. Persist returned token `id` locally. |
| 5 | Token/tracking screen opens or app returns to foreground | `GET /tokens/{tokenId}` | Google token | Full token details including number, queue position, wait estimate, service, and counter. |
| 6 | While the token screen is visible | `GET /tokens/{tokenId}/status` every 5 seconds | Google token | Lightweight polling endpoint. Update the token status, queue position, estimate, and counter without reloading the entire screen. |
| 7 | FCM token changes or permission is removed | `PUT /customers/notification-token` | Google token | Send `{ "fcmToken": "..." }` to save, or `{ "fcmToken": null }` to clear it. |
| 8 | Customer cancels before service is completed | `PATCH /tokens/{tokenId}/cancel` | Google token | Remove the active token from the client UI after a successful response. |

## Request examples

### 1. Verify the Google customer session

```http
POST /api/auth/customer/session
Authorization: Bearer <supabase_google_access_token>
Content-Type: application/json

{ "mobile": "9999999999" }
```

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
| `CUSTOMER_PROFILE_INCOMPLETE` | Call `POST /auth/customer/session` with a valid mobile number. |
| `BRANCH_CLOSED` | Disable joining and return to branch selection. |
| `SERVICE_INACTIVE` | Disable joining and refresh the branch service list. |
| `TOKEN_NOT_FOUND` | Clear the locally saved token ID; it is not owned by the current customer. |
| `INVALID_STATUS_TRANSITION` | Refresh token status; the token may have changed on another device or been actioned by staff. |

For field-level examples and the interactive request console, use the [Client Swagger UI](/docs/client/).
