# Classroom Assistant — Phase 1

Google sign-in wired through Supabase, requesting read-only Google Classroom
scopes. No Classroom data is fetched yet — this phase just proves the auth
flow works end-to-end. That's Phase 2.

## What's in this phase

- React + Vite + TypeScript + Tailwind frontend
- Supabase Auth (Google provider) with Classroom read-only scopes requested at sign-in
- A login page and a protected `/dashboard` that shows session info once signed in
- No Classroom API calls, no database tables, no AI yet — deliberately minimal

## 1. Google Cloud setup (manual — do this first)

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a new project (e.g. "Classroom Assistant").
2. **APIs & Services > Library** — search for and enable **Google Classroom API**.
3. **APIs & Services > OAuth consent screen**:
   - User type: **External** (unless you have a Workspace domain)
   - Fill in app name, your email as support contact
   - **Scopes** — add these three:
     - `.../auth/classroom.courses.readonly`
     - `.../auth/classroom.coursework.me.readonly`
     - `.../auth/classroom.announcements.readonly`
   - **Test users** — add your own Google account here. While the app is in "Testing" status, only listed test users can sign in, and you can use these scopes without a full Google review.
4. **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application type: **Web application**
   - You'll add the redirect URI in step 2 below (Supabase gives you the exact URL)

## 2. Supabase setup (manual)

1. Create a project at [supabase.com](https://supabase.com) if you haven't already.
2. **Authentication > Providers > Google** — toggle it on. Supabase shows you a **Callback URL** here (looks like `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`).
3. Go back to Google Cloud Console's OAuth client (step 1.4) and paste that callback URL into **Authorized redirect URIs**. Save, then copy the **Client ID** and **Client Secret** Google gives you.
4. Back in Supabase, paste the Client ID and Secret into the Google provider settings. Save.
5. **Project Settings > API** — copy your **Project URL** and **anon public key** for the next step.

## 3. Run it locally

```bash
npm install
cp .env.example .env.local
# paste your Supabase URL + anon key into .env.local
npm run dev
```

Visit `http://localhost:5173`, click "Continue with Google," sign in with the
test-user account you added in step 1.3, and you should land on `/dashboard`
with your session info showing.

## 4. Deploy to Vercel (when ready)

```bash
npx vercel
```

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables
in the Vercel project settings (same values as `.env.local`). Once deployed,
add the Vercel URL as an authorized JavaScript origin and redirect URI back
in the Google Cloud OAuth client — Google needs to know your production
domain is allowed to use it.

## Troubleshooting

- **"redirect_uri_mismatch"** — the URL in Google Cloud's OAuth client doesn't
  exactly match Supabase's callback URL. Copy-paste, don't retype.
- **Signed in but `provider_token` is missing** — this happens if you sign in
  a second time without `prompt: consent`; Google only issues a refresh token
  on first consent. Revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and try again.
- **"Access blocked: app not verified"** — expected while in Testing status
  if you try signing in with an account that isn't on the test users list.

## Next: Phase 2

Pull courses + coursework from the Classroom API into Supabase tables, shown
in the dashboard.
