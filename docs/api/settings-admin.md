# Admin Settings API

Owner issue: #16   Status: built

## Access
All routes require an admin bearer access token with `settings.manage`. Moderators and other roles are denied.

## Settings

| Key | Type | Default | Validation |
|---|---|---:|---|
| `announcement_default_expiry_days` | integer | 30 | 1–365 days |
| `partner_min_cohort_size` | integer | 10 | 10–1000; the minimum cannot be lowered below the safeguarding default |
| `maintenance_banner` | string | empty | Up to 500 characters; empty disables the banner |
| `whatsapp_invite_url` | string | Existing `ONBOARDING_WHATSAPP_URL`, or empty | Empty or an HTTPS `chat.whatsapp.com` invite URL |
| `inactive_review_days` | integer | 14 | 1–365 days |

Settings are typed and validated individually. An empty `whatsapp_invite_url` means no invite link is configured. Reads by other API domains use a 30-second in-memory cache; a successful update invalidates that key immediately.

## Routes

### `GET /admin/settings`
- Access: `settings.manage`
- 200:
  ```json
  {
    "items": [
      {
        "key": "announcement_default_expiry_days",
        "value": 30,
        "updated_by": null,
        "updated_at": null
      }
    ]
  }
  ```
  Unchanged values use the documented default and have null update metadata.
- Errors: `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_STORED_SETTING`

### `PATCH /admin/settings`
- Access: `settings.manage`
- Body (one setting per request):
  ```json
  {
    "key": "partner_min_cohort_size",
    "value": 12
  }
  ```
- 200: returns the updated setting with `updated_by` (admin user ID) and `updated_at`.
- Errors: `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `INVALID_STORED_SETTING`
- Audit: every update writes `settings.update` with the key, old value, and new value.
