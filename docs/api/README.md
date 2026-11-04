# API contracts

One file per domain in this folder (`auth.md`, `admin.md`, `admissions.md`, ...). Every PR that adds or changes a route updates the matching file in the same PR. Frontend work starts from these files, not from reading controllers. Copy `_template.md` for a new domain.

## Conventions (as the API behaves today)

**Errors.** Every failure is `{ "error": "<message for people>", "code": "<STABLE_CODE>" }`. Clients branch on `code`, never on the message.
- 400 `VALIDATION_ERROR` (first problem only), `INVALID_JSON`
- 401 / 403 for missing or insufficient access
- 404 `NOT_FOUND`
- 413 `PAYLOAD_TOO_LARGE`, `FILE_TOO_LARGE`
- 500 `INTERNAL_ERROR` (never includes details)
Throw `HttpError(status, code, message)` from `src/lib/errors.ts`. New codes are listed in the domain file.

**Lists.** Paged lists return `{ "items": [...], "total": 42, "page": 1, "pages": 3 }` with `?page=` starting at 1 (admin lists use 20 per page). Do not invent a second shape.

**Actions.** A write that returns nothing useful returns `{ "message": "<Done>" }` plus any small facts (for example `suspended_until`).

**Auth.** Protected routes use `requireAuth`, then `requireRole(...)` or, once W0-BE-02 lands, `requirePermission(...)`. Access is always enforced here on the server; the UI hiding a button is not a control.

**Validation.** Request bodies are validated with a zod schema in `src/schemas/` through the `validate` middleware.

**Dates.** ISO 8601 strings in UTC. A calendar date with no time (such as a birth date) is `YYYY-MM-DD`.

**Audit.** Staff actions write an `AuditLog` row. The domain file names the action strings it writes.

## Each domain file lists
For every route: method and path, who may call it, request body or query, a success response example, and the error codes it can return. Mark routes that are not built yet as `planned`.
