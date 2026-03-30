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
const VALID_PLANS = new Set(["Free", "Solo", "Family"]);
let familyLookupColumn = null;
const DEFAULT_VOICE_DAILY_LIMIT = 5;
const HARDCODED_TRIAL_ENDS_AT = "2026-03-01T00:00:00Z";

function getVoiceTrialEndsAt(plan, now) {
  if (plan !== "Free") {
    return null;
  }

  // Hardcoded for now. Replace with persisted install/trial data later.
  return HARDCODED_TRIAL_ENDS_AT;
}

function evaluateVoiceSearch(plan, now) {
  const trialEndsAt = getVoiceTrialEndsAt(plan, now);
  const dailyLimit = DEFAULT_VOICE_DAILY_LIMIT;
  const trialActive = trialEndsAt ? now < new Date(trialEndsAt) : false;
  const remainingToday = trialActive ? dailyLimit : 0;

  return {
    trialActive,
    trialEndsAt,
    dailyLimit,
    remainingToday,
    restricted: !trialActive && remainingToday <= 0,
  };
}

function buildRestrictionNotice(plan, voiceSearch) {
  if (plan !== "Free") {
    return {
      title: "Voice search available",
      body: "Your current plan can use voice search without Free-plan restrictions.",
      campaignId: "voice-search-available",
      actions: [
        {
          type: "dismiss",
          label: "OK",
        },
      ],
    };
  }

  if (voiceSearch.trialActive) {
    return {
      title: "Free trial is active",
      body: "You can use voice search without daily limits during the trial period.",
      campaignId: "free-trial-active",
      actions: [
        {
          type: "dismiss",
          label: "OK",
        },
      ],
    };
  }

  if (voiceSearch.restricted) {
    return {
      title: "本日のFreeプランの音声検索回数は上限に達しています",
      body: "",
      campaignId: "voice-limit-reached",
      actions: [
        {
          type: "dismiss",
          label: "OK",
        },
      ],
    };
  }

  return {
    title: "Voice search available",
    body: "Voice search is available within today's Free-plan limit.",
    campaignId: "voice-limit-available",
    actions: [
      {
        type: "dismiss",
        label: "OK",
      },
    ],
  };
}

function buildScreenHelp() {
  return {};
}

function normalizePlan(plan) {
  if (typeof plan !== "string") {
    return "Free";
  }

  const trimmed = plan.trim();
  return VALID_PLANS.has(trimmed) ? trimmed : "Free";
}

function buildPlanResponse(plan) {
  const normalizedPlan = normalizePlan(plan);
  const now = new Date();
  const voiceSearch = evaluateVoiceSearch(normalizedPlan, now);

  return {
    plan: normalizedPlan,
    features: {
      sync: normalizedPlan === "Family",
      voiceSearch,
    },
    restrictionNotice: buildRestrictionNotice(normalizedPlan, voiceSearch),
    screenHelp: buildScreenHelp(),
  };
}

async function ensureAccountPlanSchema() {
  const [tableRows] = await pool.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'family'
      LIMIT 1`,
    [process.env.MYSQL_DATABASE]
  );

  if (tableRows.length === 0) {
    return;
  }

  const [columnRows] = await pool.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'family'
        AND COLUMN_NAME = 'plan'
      LIMIT 1`,
    [process.env.MYSQL_DATABASE]
  );

  if (columnRows.length === 0) {
    await pool.query(
      "ALTER TABLE family ADD COLUMN plan VARCHAR(10) NOT NULL DEFAULT 'Family'"
    );
  }

  const [lookupColumnRows] = await pool.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'family'
        AND COLUMN_NAME IN ('id', 'family_id')`,
    [process.env.MYSQL_DATABASE]
  );

  familyLookupColumn =
    lookupColumnRows.find((row) => row.COLUMN_NAME === "id")?.COLUMN_NAME ??
    lookupColumnRows.find((row) => row.COLUMN_NAME === "family_id")?.COLUMN_NAME ??
    null;

  await pool.query(
    `UPDATE family
        SET plan = 'Family'
      WHERE plan IS NULL
         OR TRIM(plan) = ''
         OR plan NOT IN ('Free', 'Solo', 'Family')`
  );
}

app.get("/api/account/plan", async (req, res) => {
  const familyId = req.query.family_id ?? req.header("X-Family-ID");

  try {
    if (!familyId || !familyLookupColumn) {
      return res.json(buildPlanResponse("Free"));
    }

    const [rows] = await pool.query(
      `SELECT plan FROM family WHERE ${familyLookupColumn} = ? LIMIT 1`,
      [familyId]
    );

    if (rows.length === 0) {
      return res.json(buildPlanResponse("Free"));
    }

    return res.json(buildPlanResponse(rows[0].plan));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
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
app.post("/shopping-list", async (req, res) => {
  const {
    family_id,
    item_id,
    category_id,
    name,
    status,
    updated_by
  } = req.body;

  try {
    const sql = `
      INSERT INTO ShoppingListItem
        (family_id, item_id, category_id, name, status, is_memo, added_at, updated_at, updated_by)
      VALUES
        (?, ?, ?, ?, ?, 0, NOW(), NOW(), ?)
    `;

    await pool.query(sql, [
      family_id,
      item_id,
      category_id,
      name,
      status,
      updated_by
    ]);

    res.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/shopping-list", async (req, res) => {
  const familyId = req.query.family_id;

  if (!familyId) {
    return res.status(400).json({ error: "family_id is required" });
  }

  try {
    const sql = `
      SELECT
        id,
        family_id,
        item_id,
        category_id,
        name,
        status,
        is_memo,
        added_at,
        updated_at,
        updated_by
      FROM ShoppingListItem
      WHERE family_id = ?
      ORDER BY updated_at ASC
    `;

    const [rows] = await pool.query(sql, [familyId]);

    res.json(rows);
  } catch (err) {
    console.error(err);
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

// PUT /checklist/:id
app.put('/checklist/:id', async (req, res) => {
  const { id } = req.params;
  const { is_checked, updated_by } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE shared_checklist
       SET is_checked = ?, updated_by = ?, updated_at = NOW()
       WHERE item_id = ?`,
      [is_checked, updated_by, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ status: "ok", updatedId: id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
// DELETE /checklist/:id
app.delete('/checklist/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      `DELETE FROM shared_checklist WHERE item_id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ status: "ok", deletedId: id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const port = 3000;

async function startServer() {
  try {
    await ensureAccountPlanSchema();
    app.listen(port, () => console.log(`API running on port ${port}`));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
