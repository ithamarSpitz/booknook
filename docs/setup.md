# Local operator setup

These steps are for someone running Torimitor on the shared local Supabase stack (`npm run supabase:start`). They are not part of the harness task loop.

## Prerequisites

- Local stack is running (`npm run supabase:start`).
- You know the **service role** key from `supabase status` (under **API URL** / **service_role**).

Public sign-up is disabled; each person must be created as a user before they can sign in.

## Invite a user

### Option A: Supabase Studio

1. Open Studio at [http://127.0.0.1:54323](http://127.0.0.1:54323).
2. Go to **Authentication** → **Users**.
3. **Add user** → **Create new user**, set email and password, and confirm the email if prompted.

Share the credentials securely. The app has no sign-up screen.

### Option B: Auth Admin API

Replace `SERVICE_ROLE_KEY`, email and password with real values:

```bash
curl -s -X POST "http://127.0.0.1:54321/auth/v1/admin/users" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"reader@example.com","password":"choose-a-strong-password","email_confirm":true}'
```

On success the response includes the new user id. A profile row is created by the database sign-up trigger.

## Reset the database

Reset reapplies all migrations from `supabase/migrations/` and clears data. Use this when you want a clean catalog and libraries.

**With pgTAP tests** (same as CI-style database verification):

```bash
npm run test:db
```

**Reset only** (no tests):

```bash
npx supabase db reset
```

Only run a reset when you intend to wipe local data. The harness coordinates `test:db` across tasks so two agents do not reset in parallel.
