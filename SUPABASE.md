# Supabase setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
   This creates the per-user video and playlist course tables and their
   row-level security policies.

   **Upgrading an existing project:** if you ran an older `schema.sql` before
   playlist courses were added, run
   [`supabase/migrations/002_playlist_courses.sql`](./supabase/migrations/002_playlist_courses.sql)
   once in the SQL Editor. Single videos keep working without it, but adding a
   playlist shows an error until it has been run.
3. Copy `.env.example` to `.env.local` and fill in the project URL and anon
   (publishable) key from **Project Settings → API**.
4. In **Authentication → URL Configuration**, set the site URL to your app's
   address and add local/deployed callback URLs if needed.
5. Make sure the Email provider is enabled under **Authentication → Sign In /
   Providers**.
6. Start the app with `npm run dev`, create an account with your email and
   password, then sign in. If email confirmation is enabled, confirm the email
   before signing in. You can turn off email confirmation in Supabase if you
   want to sign up without verifying an email address.

The Supabase anon/publishable key is intended for browser use; never put a
service-role key in a `NEXT_PUBLIC_` variable. Row-level security ensures each
signed-in account can only access its own course rows.

On the first sign-in in a browser, the app imports the existing
`course-shelf-v1` local library into that account. It removes the browser copy
only after Supabase confirms the import succeeded.

## YouTube Data API key (recommended when deployed)

Video descriptions, playlists and channel pictures come from YouTube. On
your own computer they're read from youtube.com directly, but YouTube often
blocks those reads from hosting providers' servers (such as Vercel). With a
YouTube Data API key the server uses Google's official API instead, which
always works, and falls back to youtube.com only when the API has no answer.

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project (or pick one) and enable **YouTube Data API v3**.
2. Under **APIs & Services → Credentials**, choose **Create credentials → API
   key**. Restrict the key to the YouTube Data API v3.
3. Add it as `YOUTUBE_API_KEY` in `.env.local`, and in Vercel under
   **Project → Settings → Environment Variables**, then redeploy.

The free quota is 10,000 units a day. Looking up one video costs 1 unit, and
the app keeps what it has looked up on each device, so a personal library
stays far below the limit.

