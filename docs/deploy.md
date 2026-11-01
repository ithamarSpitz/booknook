# Deploy BookNook (manual checklist)

BookNook runs as static files on **GitHub Pages** and a **Supabase** cloud project (Postgres, Auth, Edge Functions). Follow these steps **in order**. The local stack (`supabase/config.toml`) stays pointed at `http://127.0.0.1:4175`; production Auth (public sign-up off, Site URL) is set in the **cloud dashboard**.

**Day to day you do not run anything below.** Every push to `master` on GitHub runs `.github/workflows/deploy.yml`: tests, then `supabase db push` and every Edge Function, then the site on Pages. It needs two repository secrets, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` (Settings → Secrets and variables → Actions). The steps below are for a fresh project or a manual deploy. Dashboard-only settings (Auth URLs, sign-up off, email templates, `HARDCOVER_API_KEY`) are not part of the push.

On the free plan, a project **pauses after about one week without activity**. Open the dashboard or use the app to wake it; paused projects do not serve API or functions until resumed.

## 1. Create the Supabase cloud project

1. In [Supabase Dashboard](https://supabase.com/dashboard), create a new project (free tier is enough for ~10 invited users).
2. Note the **project ref**, **project URL** (`https://<ref>.supabase.co`), and **anon (public) key** from **Project Settings → API**. Never copy the service-role key into `public/` or `config.js`.
3. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and log in: `supabase login`.
4. **Turn public sign-up off.** A new cloud project has this **on**. Local `config.toml` does not change the cloud project.
   - Open **Authentication → Providers → Email** (also listed under Authentication general settings as **Allow new users to sign up**).
   - Switch **Allow new users to sign up** **off** and save.
   - Leave other providers disabled. Invites (step 6) still work after this is off; uninvited people cannot register.

## 2. Fill production values in the repo

1. In `public/js/config.js`, fill in the **OPERATOR** block:
   - `PRODUCTION_SUPABASE_URL` — your project URL.
   - `PRODUCTION_SUPABASE_ANON_KEY` — the anon key (public by design).
2. Prepare a local secrets file that includes `HARDCOVER_API_KEY` (see `supabase/functions/.env.example`). The deploy script reads **only** that variable. Default path is `../book-discovery-plan/.env.local` next to this repo; otherwise set `BOOKNOOK_ENV_FILE`.
3. **Ship the filled `config.js` with the static site**, or Pages will serve the `YOUR_PROJECT_REF` / `YOUR_SUPABASE_ANON_KEY` placeholders:
   - **Git-connected Pages:** commit and push `public/js/config.js` (anon key is public; do not commit the service-role key or `HARDCOVER_API_KEY`) **before** the first production Pages deploy.
   - **Direct Upload:** skip git for this file; you will upload `public/` after filling the values.

## 3. Run the Supabase deploy script

From the repository root in Windows PowerShell 5.1 or later:

```powershell
# Optional if your secrets file is not in the default location:
# $env:BOOKNOOK_ENV_FILE = "C:\path\to\.env.local"

powershell -File scripts/deploy.ps1
```

The script stops on the first error and, in order:

- `supabase link` (select your cloud project)
- `supabase db push` (apply migrations)
- `supabase functions deploy` for `add-book`, `book-details`, `link-edition`, and `recommendations`
- `supabase secrets set HARDCOVER_API_KEY=...` read from your secrets file (no other keys from that file)

Do not run `supabase config push`. That would copy local `site_url` (`http://127.0.0.1:4175`) onto the cloud project.

## 4. Publish the static site (GitHub Pages)

Production is live at **https://ithamarspitz.github.io/booknook/**, served by GitHub Pages from the `main` branch of the public repo `ithamarSpitz/booknook`, which holds only a copy of `public/` plus an empty `.nojekyll`. (Cloudflare Pages and Netlify would also work; they need an account login.) All app paths are relative, so the `/torimitor-app/` subpath needs no changes.

To publish a new version, run `node scripts/build-site.mjs <clone of booknook>` (it copies `public/` and stamps every module and stylesheet reference with `?v=<git hash>`, so a browser never mixes cached old modules with new ones), then commit and push `main` there; Pages redeploys in about a minute. `public/` contains only what every visitor downloads anyway: the anon key is public, and `HARDCOVER_API_KEY` and the service-role key never go there.

## 5. Set production Auth URLs in the cloud dashboard

Do this **before** inviting anyone. Invite and password-reset links use **Site URL**; the app also sends `redirectTo` from `location.origin`.

1. In Supabase **Authentication → URL configuration**:
   - Set **Site URL** to `https://ithamarspitz.github.io/booknook/`.
   - Under **Redirect URLs**, add `https://ithamarspitz.github.io/booknook/**`. If you use a custom domain, add it as well (and `https://<your-domain>/**` if you need path wildcards).
2. Leave `supabase/config.toml` `site_url` as `http://127.0.0.1:4175`. Changing it to the Pages URL breaks local auth redirects. `additional_redirect_urls` lists the production URL for documentation; that file still only configures the **local** stack.

## 6. Invite users

Public sign-up must already be off (step 1). In **Authentication → Users**, invite each person by email. They set a password via the invite link, which now lands on the Pages origin.

## Local development (unchanged)

`npm run supabase:start`, `npm run functions:serve`, `npm run web:serve`, then open [http://127.0.0.1:4175](http://127.0.0.1:4175).

## Invites from inside the app

Any signed-in user can invite friends from the menu (**הזמנת חברים**, route `#invite`). The `invite-user` Edge Function sends the invite (limit 10 per user per day) and records it in `public.invitations`.

Two dashboard steps are needed once, both under **Authentication → Emails**:

1. **SMTP Settings**: set up custom SMTP. Supabase's built-in sender only delivers to members of the project's team, so invites to anyone else fail until this is set. A Gmail app password works (host `smtp.gmail.com`, port `465`, username and sender = the Gmail address, sender name `BookNook`).
2. **Templates → Invite user**: subject `{{ .Data.inviter_name }} מזמין/ה אותך ל־BookNook`, body = the contents of `supabase/templates/invite.html`. Template editing is unlocked only after step 1.
