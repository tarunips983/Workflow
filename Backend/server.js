const express = require("express");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");

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
// SUPABASE CONFIG
//
// This is important:
//
// Do NOT put your Supabase secret/service-role key here.
//
// Only expose:
// - Supabase project URL
// - public anon/publishable key
//
// These come from Render Environment Variables.
// --------------------------------------------------

app.get("/supabase-config.js", (_req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || "";

  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";

  const config = {
    supabaseUrl,
    supabaseAnonKey
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
    `Supabase configuration: ${
      process.env.SUPABASE_URL
        ? "configured"
        : "NOT CONFIGURED"
    }`
  );
});
