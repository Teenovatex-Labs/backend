# Auth API

Owner issue: Epic Teenovatex-Labs/frontend#39   Status: built

## Access
Authentication routes are public. Rate limits apply per IP / route.

## Fields

### `user.role`
- Type: `string` (`"member" | "mentor" | "tutor" | "partner" | "moderator" | "admin"`)
- Example: `"member"`, `"moderator"`, `"tutor"`, `"partner"`
- Note: `role` is intentionally **not** included in the JWT payload; token contents and verification remain unchanged.

### `user.permissions`
- Type: `string[]` (array of permission identifiers granted to the role)
- Example values:
  - `member`, `mentor`, `tutor`, `partner`: `[]`
  - `moderator`: `["staff.access", "reports.read", "reports.resolve", "users.read", "users.suspend", "audit.read", "attachments.review", "events.manage", "announcements.manage", "learn.manage", "analytics.read"]`
  - `admin`: all staff permissions plus admin-only permissions (`users.set_role`, `settings.manage`, `applications.review`, etc.)

## Routes

### `POST /auth/login`
- Access: public
- Body:
  ```json
  {
    "email": "user@example.com",
    "password": "Sup3rSecretPassword"
  }
  ```
- 200:
  ```json
  {
    "access_token": "eyJhbGciOi...",
    "refresh_token": "eyJhbGciOi...",
    "user": {
      "id": "clxxxxxxxxxxxxxxxxx",
      "username": "ada_l",
      "avatar_url": null,
      "role": "member",
      "permissions": []
    }
  }
  ```
- Errors: `INVALID_CREDENTIALS`, `GOOGLE_ACCOUNT`, `ACCOUNT_REMOVED`, `EMAIL_NOT_VERIFIED`

### `POST /auth/google`
- Access: public
- Body:
  ```json
  {
    "id_token": "google-id-token-string",
    "invite_token": "optional-invite-token"
  }
  ```
- 200:
  ```json
  {
    "access_token": "eyJhbGciOi...",
    "refresh_token": "eyJhbGciOi...",
    "user": {
      "id": "clxxxxxxxxxxxxxxxxx",
      "username": "user_4f92b7c10d",
      "avatar_url": "https://lh3.googleusercontent.com/...",
      "role": "member",
      "permissions": []
    }
  }
  ```
- Errors: `GOOGLE_NOT_CONFIGURED`, `INVALID_TOKEN`, `INVITE_REQUIRED`, `INVITE_USED`, `INVITE_EXPIRED`, `INVITE_REVOKED`, `INVITE_WRONG_EMAIL`

### `POST /auth/refresh`
- Access: public
- Body:
  ```json
  {
    "refresh_token": "eyJhbGciOi..."
  }
  ```
- 200:
  ```json
  {
    "access_token": "eyJhbGciOi...",
    "refresh_token": "eyJhbGciOi...",
    "user": {
      "id": "clxxxxxxxxxxxxxxxxx",
      "username": "ada_l",
      "avatar_url": null,
      "role": "moderator",
      "permissions": [
        "staff.access",
        "reports.read",
        "reports.resolve",
        "users.read",
        "users.suspend",
        "audit.read",
        "attachments.review",
        "events.manage",
        "announcements.manage",
        "learn.manage",
        "analytics.read"
      ]
    }
  }
  ```
- Errors: `INVALID_TOKEN`, `SESSION_EXPIRED`

