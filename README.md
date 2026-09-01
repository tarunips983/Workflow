# OfficeFlow Pro v2

A modern multi-user office-work workspace with a first-party Node.js backend, built-in email/password authentication, server-side access controls, and private on-disk document storage.

## What is included

- Email/password registration and login handled by the OfficeFlow API
- User profiles with employee code, department, designation and role
- Roles: employee, approver, manager, admin
- First-party JSON document database stored under `data/officeflow-db.json`
- Private file storage under `data/storage/office-documents`
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

1. Install dependencies with `npm install`.
2. Set a strong server-only secret: `OFFICEFLOW_AUTH_SECRET="replace-with-a-long-random-secret"`.
3. Start the application with `npm start`.
4. Open `http://localhost:10000`.

OfficeFlow creates its database and private storage directories automatically on first start. To store data somewhere else, set:

```bash
OFFICEFLOW_DATA_DIR=/persistent/officeflow-data
OFFICEFLOW_STORAGE_DIR=/persistent/officeflow-files
```

## Vercel deployment: persistent data is required

Vercel server functions have an ephemeral filesystem. Therefore `data/officeflow-db.json` and uploaded files cannot be the production datastore on Vercel: a function restart can make a previously registered account unavailable and can discard uploads. Deploy this JSON-storage edition on a host with a mounted persistent volume, or replace the JSON/file adapters with a managed database and object-storage service before using Vercel for production.

Set a stable `OFFICEFLOW_AUTH_SECRET` in the deployment environment. If you use password reset emails, also configure:

```bash
RESEND_API_KEY=re_...
OFFICEFLOW_EMAIL_FROM="OfficeFlow <no-reply@your-domain.com>"
OFFICEFLOW_APP_URL=https://your-domain.example
```

The reset endpoint now reports a configuration or delivery failure instead of falsely saying that an email was sent. Reset links expire after 30 minutes and become unusable after a password change.

## Important security rule

Keep `OFFICEFLOW_AUTH_SECRET`, database files, and storage files on the server. Browser code talks only to the OfficeFlow API and never needs a database secret.

## Making the first admin

The first registered user is promoted to `admin` automatically. Admins and managers can update roles from the **People & Roles** screen.

## Production next steps

For a full enterprise rollout, add:

- managed persistent disk or object storage backups
- controlled e-sign / DSC integration if legally required
- email/WhatsApp/SMS notification provider
- SSO / organization identity provider
- SAP integration through your approved middleware or APIs
- immutable audit retention and scheduled backups
- configurable approval matrix by department / authority / financial limit
- document version diffing, OCR and retention policy controls
