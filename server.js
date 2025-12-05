const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token || token !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

console.log("Deployment test");

async function getDB() {
  return mysql.createConnection({
    host: "nozomi.proxy.rlwy.net",
    port: 48883,
    user: "root",
    password: "KFHgduBLQzgESYpgxDMBpqgMaVZOfzqB",
    database: "railway",
  });
}

// GET /ping
app.get("/ping", async (req, res) => {
  const db = await getDB();
  const [rows] = await db.query("SELECT * FROM ping");
  await db.end();
  res.json(rows);
});

// POST /ping
app.post("/ping", async (req, res) => {
  const { id, value } = req.body;
  const db = await getDB();
  await db.query("INSERT INTO ping (id, value) VALUES (?, ?)", [id, value]);
  await db.end();
  res.json({ status: "ok" });
});

const port = 3000;
app.listen(port, () => console.log(`API running on port ${port}`));
