# <Domain> API

Owner issue: #<n>   Status: planned | built

## Access
Who may call these routes (role or permission) and any rate limits.

## Routes

### `POST /<path>`
- Access: <role / permission / public>
- Body:
  ```json
  { "example": "value" }
  ```
- 200:
  ```json
  { "message": "Done" }
  ```
- Errors: `VALIDATION_ERROR`, `<DOMAIN_CODE>`
- Audit: `<domain>.<action>` (if staff-only)

## New error codes
| Code | Status | When |
|---|---|---|
