# OfficeFlow Pro v2

A modern multi-user office-work workspace built around Supabase.

## What is included

- Email/password registration and login
- User profiles with employee code, department, designation and role
- Roles: employee, approver, manager, admin
- Supabase PostgreSQL database with Row Level Security
- Private document storage using the `office-documents` bucket
- Document metadata, status, version, tags and search/filtering
- Approval inbox with approve/return decisions
- Audit log for major user actions
- Browser signature capture with stored signature hash and document metadata
- Personal To-Do List with due dates, priorities and status
- Indent / requirement workflow
- Estimate builder persisted to the database
- Purchase-order tracker persisted to the database
- Temporary advance request workflow persisted to the database
- SAP PR process guide with transaction/checklist references
- Notifications and unread count
- Admin / manager People & Roles screen
- Responsive dashboard and mobile navigation

## Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase-schema.sql`.
3. In Supabase Storage, create a **private** bucket named `office-documents`.
4. Copy `supabase-config.example.js` to `supabase-config.js` if needed and put your project URL and anon/publishable key in it.
5. Open `login.html` through a local/static web server. For example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080/login.html`.

## Important security rule

Only the public anon/publishable Supabase key belongs in browser code. Never put a Supabase service-role/secret key in `supabase-config.js`.

## Making the first admin

Register an account, then in Supabase SQL Editor run:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR-ADMIN-EMAIL');
```

After refreshing OfficeFlow, the **People & Roles** module will be available to that admin.

## Production next steps

For a full enterprise rollout, add:

- server-side signed-URL/file-preview service for cross-department documents
- controlled e-sign / DSC integration if legally required
- email/WhatsApp/SMS notification provider
- SSO / organization identity provider
- SAP integration through your approved middleware or APIs
- immutable audit retention and scheduled backups
- configurable approval matrix by department / authority / financial limit
- document version diffing, OCR and retention policy controls
