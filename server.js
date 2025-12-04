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
console.log("Deployment test");

async function getDB() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
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
