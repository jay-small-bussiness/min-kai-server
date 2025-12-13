const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());  // ★ JSON読み取り有効化
console.log("Deployment test");

/*
▼旧バージョン（pool 導入前）
  必要あれば復活させるため残してある
async function getDB() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
}
*/
// poolを使ったDBアクセスの準備
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});
// GET /ping
app.get("/ping", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM ping");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /ping
app.post("/ping", async (req, res) => {
  const { id, value } = req.body;

  try {
    await pool.query(
      "INSERT INTO ping (id, value) VALUES (?, ?)",
      [id, value]
    );

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/families', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM family');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/checklist/:familyId', async (req, res) => {
  const { familyId } = req.params;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM shared_checklist WHERE family_id = ?',
      [familyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/checklist', async (req, res) => {
  const { family_id, item_name, is_checked, updated_by } = req.body;

  try {
    // ① 重複チェック
    const [existRows] = await pool.query(
      `SELECT item_id FROM shared_checklist
       WHERE family_id = ? AND item_name = ? AND is_checked = 0`,
      [family_id, item_name]
    );

    if (existRows.length > 0) {
      // すでに未チェックで存在する → 新規追加せずそれを返す
      return res.json({
        status: "exists",
        item_id: existRows[0].item_id
      });
    }

    // ② 新規追加
    const [result] = await pool.query(
      `INSERT INTO shared_checklist 
        (family_id, item_name, is_checked, updated_by, updated_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [family_id, item_name, is_checked, updated_by]
    );

    return res.json({
      status: "ok",
      insertedId: result.insertId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const port = 3000;
app.listen(port, () => console.log(`API running on port ${port}`));
