const express = require("express");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";

// Your GitHub structure:
// Workflow/
//   Backend/server.js
//   Frontend/index.html
//   Frontend/login.html
//   Frontend/app.js
//   Frontend/styles.css

const FRONTEND_DIR = path.join(__dirname, "..", "Frontend");

const DATA_DIR = process.env.OFFICEFLOW_DATA_DIR || path.join(__dirname, "..", "data");
const STORAGE_DIR = process.env.OFFICEFLOW_STORAGE_DIR || path.join(DATA_DIR, "storage");
const DB_FILE = path.join(DATA_DIR, "officeflow-db.json");
const SECRET = process.env.OFFICEFLOW_AUTH_SECRET || "change-this-secret-in-production";
const TABLES = ["profiles","documents","tasks","approvals","audit_logs","notifications","workflow_items","estimates","estimate_items","advance_requests","purchase_orders","signatures"];
function ensureDb(){fs.mkdirSync(DATA_DIR,{recursive:true});fs.mkdirSync(STORAGE_DIR,{recursive:true});if(!fs.existsSync(DB_FILE)){const db={users:[]};for(const t of TABLES)db[t]=[];saveDb(db);}}
function loadDb(){ensureDb();return JSON.parse(fs.readFileSync(DB_FILE,"utf8"));}
function saveDb(db){fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2));}
function now(){return new Date().toISOString();}
function hashPassword(password,salt=crypto.randomBytes(16).toString("hex")){const hash=crypto.pbkdf2Sync(password,salt,210000,32,"sha256").toString("hex");return `${salt}:${hash}`;}
function verifyPassword(password,stored){const [salt,hash]=stored.split(":");return crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(hashPassword(password,salt).split(":")[1]));}
function tokenFor(user){const payload=Buffer.from(JSON.stringify({sub:user.id,email:user.email,exp:Date.now()+1000*60*60*24*14})).toString("base64url");const sig=crypto.createHmac("sha256",SECRET).update(payload).digest("base64url");return `${payload}.${sig}`;}
function userFromReq(req){const raw=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!raw)return null;const [payload,sig]=raw.split(".");const good=crypto.createHmac("sha256",SECRET).update(payload).digest("base64url");if(sig!==good)return null;const data=JSON.parse(Buffer.from(payload,"base64url").toString());if(data.exp<Date.now())return null;return loadDb().users.find(u=>u.id===data.sub)||null;}
function publicUser(u){return {id:u.id,email:u.email,user_metadata:u.user_metadata||{}};}
function session(u){return {session:{access_token:tokenFor(u),user:publicUser(u)},user:publicUser(u)};}
function requireAuth(req,res,next){const u=userFromReq(req);if(!u)return res.status(401).json({error:"Authentication required"});req.user=u;next();}
function matches(row, filters, user){return filters.every(f=>{if(f.op==="eq")return String(row[f.key]??"")===String(f.value??"");if(f.op==="is")return (row[f.key]??null)===f.value;if(f.op==="or")return f.value.split(",").some(x=>{const m=x.match(/^([\w_]+)\.eq\.(.+)$/);return m&&String(row[m[1]]??"")===String(m[2]);});return true;});}
function scoped(table, rows, user){if(["profiles","audit_logs","notifications"].includes(table))return rows;if(table==="tasks")return rows.filter(r=>r.created_by===user.id||r.assignee_id===user.id);if(table==="approvals")return rows.filter(r=>r.requested_by===user.id||r.approver_id===user.id||!r.approver_id);return rows.filter(r=>!r.owner_id||r.owner_id===user.id||user.role==="admin"||user.role==="manager");}
function registerApi(app){ensureDb();
app.use("/api/storage/:bucket", express.raw({type:"*/*",limit:process.env.OFFICEFLOW_UPLOAD_LIMIT||"500mb"}));
app.post("/api/auth/register",(req,res)=>{const db=loadDb();const email=String(req.body.email||"").trim().toLowerCase();if(!email||!req.body.password)return res.status(400).json({error:"Email and password are required"});if(db.users.some(u=>u.email===email))return res.status(409).json({error:"An account already exists for this email"});const id=crypto.randomUUID();const meta=req.body.profile||{};const user={id,email,password_hash:hashPassword(req.body.password),user_metadata:meta,created_at:now()};db.users.push(user);db.profiles.push({id,email,full_name:meta.full_name||email.split("@")[0],employee_code:meta.employee_code||null,department:meta.department||"",designation:meta.designation||"",role:db.users.length===1?"admin":"employee",created_at:now(),updated_at:now()});saveDb(db);res.json({data:session(user)});});
app.post("/api/auth/login",(req,res)=>{const db=loadDb();const email=String(req.body.email||"").trim().toLowerCase();const u=db.users.find(x=>x.email===email);if(!u||!verifyPassword(req.body.password||"",u.password_hash))return res.status(401).json({error:"Invalid email or password"});res.json({data:session(u)});});
app.get("/api/auth/session",requireAuth,(req,res)=>res.json({data:session(req.user)}));
app.post("/api/auth/password-reset",(_req,res)=>res.json({data:{message:"Ask an administrator to reset your password on the server."}}));
app.route("/api/tables/:table").all(requireAuth).get((req,res)=>{const db=loadDb(),table=req.params.table;if(!TABLES.includes(table))return res.status(404).json({error:"Unknown table"});let rows=scoped(table,db[table],req.user);const filters=JSON.parse(req.query.filters||"[]");rows=rows.filter(r=>matches(r,filters,req.user));if(table==="approvals"){rows=rows.map(a=>({...a,workflow_items:db.workflow_items.find(w=>w.id===a.workflow_item_id)||null,documents:db.documents.find(d=>d.id===a.document_id)||null}));}const order=req.query.order&&JSON.parse(req.query.order);if(order)rows.sort((a,b)=>(a[order.key]>b[order.key]?1:-1)*(order.ascending?1:-1));if(req.query.limit)rows=rows.slice(0,Number(req.query.limit));res.json({data:rows});}).post((req,res)=>{const db=loadDb(),table=req.params.table;if(!TABLES.includes(table))return res.status(404).json({error:"Unknown table"});const items=Array.isArray(req.body.data)?req.body.data:[req.body.data];const rows=items.map(x=>({id:crypto.randomUUID(),created_at:now(),updated_at:now(),...x}));db[table].push(...rows);saveDb(db);res.json({data:Array.isArray(req.body.data)?rows:rows[0]});}).patch((req,res)=>{const db=loadDb(),table=req.params.table,filters=JSON.parse(req.query.filters||"[]");let changed=[];db[table]=db[table].map(r=>matches(r,filters,req.user)?(changed.push({...r,...req.body.data,updated_at:now()}),changed.at(-1)):r);saveDb(db);res.json({data:changed});}).delete((req,res)=>{const db=loadDb(),table=req.params.table,filters=JSON.parse(req.query.filters||"[]");const before=db[table].length;db[table]=db[table].filter(r=>!matches(r,filters,req.user));saveDb(db);res.json({data:{deleted:before-db[table].length}});});
app.post("/api/storage/:bucket",requireAuth,(req,res)=>{const rel=String(req.query.path||"").replace(/\.\.|^\//g,"");const target=path.join(STORAGE_DIR,req.params.bucket,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,req.body);res.json({data:{path:rel}});});
app.get("/api/storage/:bucket/signed-url",requireAuth,(req,res)=>res.json({data:{signedUrl:`/api/storage/${encodeURIComponent(req.params.bucket)}/file?path=${encodeURIComponent(req.query.path||"")}`}}));
app.get("/api/storage/:bucket/file",requireAuth,(req,res)=>res.sendFile(path.join(STORAGE_DIR,req.params.bucket,String(req.query.path||"").replace(/\.\.|^\//g,""))));
app.delete("/api/storage/:bucket",requireAuth,(req,res)=>{for(const k of req.body.keys||[])fs.rmSync(path.join(STORAGE_DIR,req.params.bucket,String(k).replace(/\.\.|^\//g,"")),{force:true});res.json({data:{removed:req.body.keys||[]}});});
}


// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.disable("x-powered-by");

app.use(
  helmet({
    // Your current frontend loads external browser libraries.
    contentSecurityPolicy: false
  })
);

app.use(compression());
app.use(cors());

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb"
  })
);

// --------------------------------------------------
// HEALTH CHECK
// Render uses this to verify the server is alive.
// --------------------------------------------------

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "OfficeFlow Pro",
    version: "2.0.0",
    timestamp: new Date().toISOString()
  });
});

// --------------------------------------------------
// OFFICEFLOW CONFIG
//
// This is important:
//
// The browser client is first-party and does not require database credentials.
// This endpoint exists for older deployments that still load a config file.
// --------------------------------------------------

app.get("/officeflow-config.js", (_req, res) => {
  const officeflowUrl = process.env.OFFICEFLOW_URL || "";

  const officeflowAnonKey =
    process.env.OFFICEFLOW_ANON_KEY ||
    process.env.OFFICEFLOW_PUBLISHABLE_KEY ||
    "";

  const config = {
    officeflowUrl,
    officeflowAnonKey
  };

  res
    .type("application/javascript")
    .set("Cache-Control", "no-store")
    .send(
      `window.OFFICEFLOW_CONFIG=${JSON.stringify(config)};`
    );
});

// --------------------------------------------------
// API STATUS
// --------------------------------------------------

registerApi(app);

app.get("/api", (_req, res) => {
  res.json({
    name: "OfficeFlow Pro API",
    version: "2.0.0",
    status: "running"
  });
});

// --------------------------------------------------
// STATIC FRONTEND
// --------------------------------------------------

app.use(
  express.static(FRONTEND_DIR, {
    extensions: ["html"],
    maxAge:
      process.env.NODE_ENV === "production"
        ? "1h"
        : 0
  })
);

// --------------------------------------------------
// MAIN ROUTES
// --------------------------------------------------

app.get("/", (_req, res) => {
  res.sendFile(
    path.join(FRONTEND_DIR, "login.html")
  );
});

app.get("/login", (_req, res) => {
  res.sendFile(
    path.join(FRONTEND_DIR, "login.html")
  );
});

app.get("/app", (_req, res) => {
  res.sendFile(
    path.join(FRONTEND_DIR, "index.html")
  );
});

// --------------------------------------------------
// 404
// --------------------------------------------------

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API route not found",
      path: req.path
    });
  }

  res.status(404).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        >
        <title>OfficeFlow Pro</title>

        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: Arial, sans-serif;
            background: #f5f7fb;
            color: #172033;
          }

          .box {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,.08);
            text-align: center;
            max-width: 500px;
          }

          a {
            color: #365cff;
            text-decoration: none;
            font-weight: 700;
          }
        </style>
      </head>

      <body>
        <div class="box">
          <h1>Page Not Found</h1>
          <p>
            The OfficeFlow Pro page you're looking for
            does not exist.
          </p>

          <a href="/">
            Go to OfficeFlow Pro
          </a>
        </div>
      </body>
    </html>
  `);
});

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error(
    "Unhandled server error:",
    err
  );

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error: "Internal server error"
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(
    `OfficeFlow Pro running on ${HOST}:${PORT}`
  );

  console.log(
    `Frontend directory: ${FRONTEND_DIR}`
  );

  console.log(
    `OfficeFlow configuration: ${
      process.env.OFFICEFLOW_URL
        ? "configured"
        : "NOT CONFIGURED"
    }`
  );
});
