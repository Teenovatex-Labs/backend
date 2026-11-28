# Moderation API

Owner issue: #14   Status: built

## Access
All routes require a bearer access token. Moderators and admins need `moderation.read` to browse content; hide and restore also require `reports.resolve`.

## Routes

### `GET /admin/moderation/posts`, `GET /admin/moderation/comments`, `GET /admin/moderation/labs`
- Access: `moderation.read`
- Optional query parameters:
  - `hidden=true|false`
  - `reported=true|false` (based on open reports)
  - `q` searches text and author username
  - `from` and `to` are ISO 8601 timestamps and filter by creation time
  - `cursor` is the ID of the last item in the previous page
  - `limit` is an integer from 1 to 100 (default 20)
- 200:
  ```json
  {
    "items": [
      {
        "id": "uuid",
        "title": "Project title",
        "excerpt": "A short content excerpt",
        "author": "member_username",
        "hidden": false,
        "created_at": "2026-11-27T12:00:00.000Z",
        "open_report_count": 1
      }
    ],
    "next_cursor": null
  }
  ```
  Comment items omit `title`.
- Errors: `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `INVALID_CURSOR`
- Responses contain author usernames only, never email addresses or birth dates.

### `POST /admin/moderation/:type/:id/hide` and `POST /admin/moderation/:type/:id/restore`
- Access: `moderation.read` and `reports.resolve`
- `type`: `post`, `comment`, or `lab`
- Body: none
- 200:
  ```json
  { "message": "Content hidden" }
  ```
  Restore returns `"Content restored"`.
- Errors: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `ALREADY_HIDDEN`, `NOT_HIDDEN`, `CONTENT_CHANGED`, `VALIDATION_ERROR`
- Audit actions: `moderation.hide` and `moderation.restore`
