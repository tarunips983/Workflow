# Division Estimate Suite

A deployable full-stack web application for creating estimates, indents and supporting office documents from reusable data. It uses MongoDB for application data and MongoDB GridFS for uploaded reference files.

## Included features
- Registration + login with JWT httpOnly cookie authentication
- Division/work/location master data
- Estimate builder with editable quantity/rate rows and live calculations
- 2026-27 sample labour rates seeded from the supplied reference screenshots; fully editable
- Unified CLA / job metadata: work title, site, unit, financial year, PR/indent references, estimated amount and cost centre flow into generated documents
- One-click document bundle: covering letter, report-to-accompany-estimate, detailed estimate, scope of work, indent, OES/proprietary form, screening committee report
- Indent workflow with step-by-step checklist
- File-explorer style reference library with folders and uploads (GridFS)
- Rate catalogue with categories and revision dates
- Print-ready A4 document templates with official-style spacing, headings, tables and signatures
- Audit log for estimate/document activity
- Demo seed account when `SEED_DEMO=true`

## Local development
1. Install Node.js 22+ and MongoDB.
2. Copy `server/.env.example` to `server/.env`.
3. From the project root run `npm install`.
4. Run `npm run dev`.
5. Open http://localhost:5173.

Demo login (when seeded):
- Email: `admin@example.com`
- Password: `Admin@123`

## Production
- `npm run build`
- `npm start`
- Set a strong `JWT_SECRET`, `MONGODB_URI`, `CLIENT_ORIGIN` and `SEED_DEMO=false`.
- The Express server serves the Vite build from `client/dist` and exposes `/api/*`.

## Important accounting note
The seeded 2026-27 rates are sample rates extracted from the supplied screenshots. Replace/verify them against the division's latest approved cost data before issuing any official document.
