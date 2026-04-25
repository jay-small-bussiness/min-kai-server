const { randomUUID } = require("crypto");
const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());
console.log("Deployment test");

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
const ACCOUNT_STATUSES = new Set(["active", "cancel_scheduled", "expired"]);
const DEFAULT_VOICE_DAILY_LIMIT = 5;
const HARDCODED_TRIAL_ENDS_AT = "2026-03-01T00:00:00Z";
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function getJstDayRangeUtc(now = new Date()) {
  const jstOffsetMinutes = 9 * 60;
  const jstNow = new Date(now.getTime() + jstOffsetMinutes * 60 * 1000);

  const startOfJstDay = new Date(
    Date.UTC(
      jstNow.getUTCFullYear(),
      jstNow.getUTCMonth(),
      jstNow.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );

  const endOfJstDay = new Date(
    Date.UTC(
      jstNow.getUTCFullYear(),
      jstNow.getUTCMonth(),
      jstNow.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );

  return {
    startUtc: new Date(startOfJstDay.getTime() - jstOffsetMinutes * 60 * 1000),
    endUtc: new Date(endOfJstDay.getTime() - jstOffsetMinutes * 60 * 1000),
  };
}

function getVoiceTrialEndsAt(plan, now) {
  if (plan !== "Free") {
    return null;
  }

  return HARDCODED_TRIAL_ENDS_AT;
}

function evaluateVoiceSearch(plan, now, usedToday = 0) {
  const trialEndsAt = getVoiceTrialEndsAt(plan, now);
  const dailyLimit = DEFAULT_VOICE_DAILY_LIMIT;
  const trialActive = trialEndsAt ? now < new Date(trialEndsAt) : false;
  const remainingToday = trialActive
    ? dailyLimit
    : Math.max(0, dailyLimit - usedToday);

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
      body: "音声検索は本日分を使い切りました。\nカテゴリー一覧から商品を選んで追加できます。",
      campaignId: "voice-limit-reached",
      actions: [
        {
          type: "dismiss",
          label: "カテゴリー一覧を見る",
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

function normalizeUserId(userId) {
  if (userId === undefined || userId === null) {
    return null;
  }

  if (typeof userId !== "string") {
    return null;
  }

  const trimmed = userId.trim();
  if (!trimmed) {
    return null;
  }

  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizePlan(plan) {
  if (typeof plan !== "string") {
    return "Free";
  }

  const trimmed = plan.trim();
  return VALID_PLANS.has(trimmed) ? trimmed : "Free";
}

function normalizeAccountPlanType(planType) {
  if (typeof planType !== "string") {
    return "free";
  }

  const trimmed = planType.trim().toLowerCase();
  return trimmed === "solo" ? "solo" : "free";
}

function normalizeAccountStatus(status) {
  if (typeof status !== "string") {
    return "active";
  }

  const trimmed = status.trim().toLowerCase();
  return ACCOUNT_STATUSES.has(trimmed) ? trimmed : "active";
}

async function countVoiceSearchUsageToday(userId, now = new Date()) {
  if (!userId) {
    return 0;
  }

  const { startUtc, endUtc } = getJstDayRangeUtc(now);
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS used_today
      FROM voice_search_usage
      WHERE user_id = ?
        AND used_at >= ?
        AND used_at < ?
    `,
    [userId, startUtc, endUtc]
  );

  return Number(rows[0]?.used_today ?? 0);
}

async function buildPlanResponse(plan, userId) {
  const normalizedPlan = normalizePlan(plan);
  const now = new Date();
  const usedToday = await countVoiceSearchUsageToday(userId, now);
  const voiceSearch = evaluateVoiceSearch(normalizedPlan, now, usedToday);

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

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [process.env.MYSQL_DATABASE, tableName, columnName]
  );

  return rows.length > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1`,
    [process.env.MYSQL_DATABASE, tableName, indexName]
  );

  return rows.length > 0;
}

async function ensureAccountPlanSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id BIGINT NOT NULL AUTO_INCREMENT,
      account_uuid CHAR(36) NOT NULL,
      plan_type VARCHAR(10) NOT NULL DEFAULT 'free',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_accounts_account_uuid (account_uuid)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_users (
      id BIGINT NOT NULL AUTO_INCREMENT,
      account_id BIGINT NOT NULL,
      user_id CHAR(36) NOT NULL,
      linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unlinked_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_account_users_user_id (user_id),
      KEY idx_account_users_account_id (account_id),
      KEY idx_account_users_user_id (user_id)
    )
  `);

  if (!(await columnExists("accounts", "account_uuid"))) {
    await pool.query(`
      ALTER TABLE accounts
      ADD COLUMN account_uuid CHAR(36) NULL AFTER id
    `);
  }

  if (!(await columnExists("accounts", "plan_type"))) {
    await pool.query(`
      ALTER TABLE accounts
      ADD COLUMN plan_type VARCHAR(10) NOT NULL DEFAULT 'free' AFTER account_uuid
    `);
  }

  if (!(await columnExists("accounts", "status"))) {
    await pool.query(`
      ALTER TABLE accounts
      ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER plan_type
    `);
  }

  if (!(await columnExists("accounts", "expires_at"))) {
    await pool.query(`
      ALTER TABLE accounts
      ADD COLUMN expires_at DATETIME NULL AFTER status
    `);
  }

  const [accountPlanTypeRows] = await pool.query(
    `SELECT COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'accounts'
        AND COLUMN_NAME = 'plan_type'
      LIMIT 1`,
    [process.env.MYSQL_DATABASE]
  );

  if (accountPlanTypeRows.length === 0) {
    throw new Error("accounts.plan_type column is missing");
  }

  const accountPlanType = String(
    accountPlanTypeRows[0].COLUMN_TYPE || ""
  ).toLowerCase();
  if (accountPlanType !== "varchar(10)" && accountPlanType !== "enum('free','solo')") {
    await pool.query(`
      ALTER TABLE accounts
      MODIFY COLUMN plan_type VARCHAR(10) NOT NULL DEFAULT 'free'
    `);
  }

  const [accountUsersRows] = await pool.query(
    `SELECT COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'account_users'
        AND COLUMN_NAME = 'user_id'
      LIMIT 1`,
    [process.env.MYSQL_DATABASE]
  );

  if (accountUsersRows.length === 0) {
    throw new Error("account_users.user_id column is missing");
  }

  const accountUsersType = String(
    accountUsersRows[0].COLUMN_TYPE || ""
  ).toLowerCase();
  if (accountUsersType !== "varchar(36)" && accountUsersType !== "char(36)") {
    await pool.query(`
      ALTER TABLE account_users
      MODIFY COLUMN user_id CHAR(36) NOT NULL
    `);
  }

  if (!(await columnExists("account_users", "linked_at"))) {
    await pool.query(`
      ALTER TABLE account_users
      ADD COLUMN linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
  }

  if (!(await columnExists("account_users", "unlinked_at"))) {
    await pool.query(`
      ALTER TABLE account_users
      ADD COLUMN unlinked_at DATETIME NULL
    `);
  }

  if (!(await indexExists("accounts", "uk_accounts_account_uuid"))) {
    await pool.query(`
      ALTER TABLE accounts
      ADD UNIQUE KEY uk_accounts_account_uuid (account_uuid)
    `);
  }

  if (!(await indexExists("account_users", "uk_account_users_user_id"))) {
    if (await indexExists("account_users", "uq_account_users_user_id")) {
      await pool.query(`
        ALTER TABLE account_users
        RENAME INDEX uq_account_users_user_id TO uk_account_users_user_id
      `);
    } else {
      await pool.query(`
        ALTER TABLE account_users
        ADD UNIQUE KEY uk_account_users_user_id (user_id)
      `);
    }
  }

  if (!(await indexExists("account_users", "idx_account_users_user_id"))) {
    await pool.query(`
      ALTER TABLE account_users
      ADD KEY idx_account_users_user_id (user_id)
    `);
  }

  await pool.query(`
    UPDATE accounts
       SET account_uuid = UUID()
     WHERE account_uuid IS NULL
        OR TRIM(account_uuid) = ''
  `);

  await pool.query(`
    UPDATE accounts
       SET plan_type = CASE
         WHEN LOWER(TRIM(plan_type)) = 'solo' THEN 'solo'
         ELSE 'free'
       END
  `);

  await pool.query(`
    UPDATE accounts
       SET status = CASE
         WHEN LOWER(TRIM(status)) IN ('active', 'cancel_scheduled', 'expired')
           THEN LOWER(TRIM(status))
         ELSE 'active'
       END
  `);

  await pool.query(`
    UPDATE account_users
       SET linked_at = COALESCE(linked_at, CURRENT_TIMESTAMP)
     WHERE linked_at IS NULL
  `);
}

function resolveEffectivePlan(account) {
  if (!account) {
    return "Free";
  }

  const normalizedPlanType = normalizeAccountPlanType(account.plan_type);
  const normalizedStatus = normalizeAccountStatus(account.status);
  if (normalizedPlanType !== "solo") {
    return "Free";
  }

  if (!["active", "cancel_scheduled"].includes(normalizedStatus)) {
    return "Free";
  }

  if (!account.expires_at) {
    return "Free";
  }

  const expiresAt = new Date(account.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return "Free";
  }

  return "Solo";
}

async function getAccountByUserId(executor, userId) {
  const [rows] = await executor.query(
    `
      SELECT
        au.account_id,
        a.account_uuid,
        a.plan_type,
        a.status,
        a.expires_at
      FROM account_users au
      INNER JOIN accounts a ON a.id = au.account_id
      WHERE au.user_id = ?
        AND au.unlinked_at IS NULL
      LIMIT 1
    `,
    [userId]
  );

  return rows[0] ?? null;
}

async function findOrCreateAccountByUserId(userId) {
  const account = await getAccountByUserId(pool, userId);
  if (account) {
    return account;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const existingAccount = await getAccountByUserId(connection, userId);
    if (existingAccount) {
      await connection.commit();
      return existingAccount;
    }

    const accountUuid = randomUUID();
    const [accountResult] = await connection.query(
      `
        INSERT INTO accounts (account_uuid, plan_type, status, expires_at)
        VALUES (?, 'free', 'active', NULL)
      `,
      [accountUuid]
    );

    await connection.query(
      `
        INSERT INTO account_users (account_id, user_id, linked_at, unlinked_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, NULL)
      `,
      [accountResult.insertId, userId]
    );

    await connection.commit();

    return {
      account_id: accountResult.insertId,
      account_uuid: accountUuid,
      plan_type: "free",
      status: "active",
      expires_at: null,
    };
  } catch (err) {
    await connection.rollback();

    if (err && err.code === "ER_DUP_ENTRY") {
      const retryAccount = await getAccountByUserId(pool, userId);
      if (retryAccount) {
        return retryAccount;
      }
    }

    throw err;
  } finally {
    connection.release();
  }
}

async function ensureVoiceSearchUsageSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_search_usage (
      id BIGINT NOT NULL AUTO_INCREMENT,
      user_id CHAR(36) NOT NULL,
      used_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_voice_search_usage_user_used_at (user_id, used_at)
    )
  `);

  const [columnRows] = await pool.query(
    `SELECT COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'voice_search_usage'
        AND COLUMN_NAME = 'user_id'
      LIMIT 1`,
    [process.env.MYSQL_DATABASE]
  );

  if (columnRows.length === 0) {
    throw new Error("voice_search_usage.user_id column is missing");
  }

  const columnType = String(columnRows[0].COLUMN_TYPE || "").toLowerCase();
  if (columnType !== "varchar(36)" && columnType !== "char(36)") {
    await pool.query(`
      ALTER TABLE voice_search_usage
      MODIFY COLUMN user_id CHAR(36) NOT NULL
    `);
  }

  if (!(await indexExists("voice_search_usage", "idx_voice_search_usage_user_used_at"))) {
    await pool.query(`
      ALTER TABLE voice_search_usage
      ADD KEY idx_voice_search_usage_user_used_at (user_id, used_at)
    `);
  }
}

app.get("/api/account/plan", async (req, res) => {
  const rawUserId = req.query.user_id ?? req.header("X-User-ID");
  const userId = normalizeUserId(rawUserId);

  if (rawUserId !== undefined && rawUserId !== null && !userId) {
    return res.status(400).json({ error: "user_id must be a UUID string" });
  }

  try {
    if (!userId) {
      return res.json(await buildPlanResponse("Free", null));
    }

    const account = await findOrCreateAccountByUserId(userId);
    const effectivePlan = resolveEffectivePlan(account);
    return res.json(await buildPlanResponse(effectivePlan, userId));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/voice-search/usage", async (req, res) => {
  const userId = normalizeUserId(req.body?.user_id);

  if (!userId) {
    return res
      .status(400)
      .json({ error: "user_id is required and must be a UUID string" });
  }

  try {
    const account = await findOrCreateAccountByUserId(userId);
    const effectivePlan = resolveEffectivePlan(account);

    if (effectivePlan !== "Free") {
      return res.json({ status: "ok" });
    }

    const usedAt = new Date();

    await pool.query(
      `
        INSERT INTO voice_search_usage (user_id, used_at)
        VALUES (?, ?)
      `,
      [userId, usedAt]
    );

    return res.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/ping", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM ping");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/ping", async (req, res) => {
  const { id, value } = req.body;

  try {
    await pool.query("INSERT INTO ping (id, value) VALUES (?, ?)", [id, value]);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/families", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM family");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/checklist/:familyId", async (req, res) => {
  const { familyId } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM shared_checklist WHERE family_id = ?",
      [familyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/shopping-list", async (req, res) => {
  const { family_id, item_id, category_id, name, status, updated_by } = req.body;

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
      updated_by,
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

app.post("/checklist", async (req, res) => {
  const { family_id, item_name, is_checked, updated_by } = req.body;

  try {
    const [existRows] = await pool.query(
      `SELECT item_id FROM shared_checklist
       WHERE family_id = ? AND item_name = ? AND is_checked = 0`,
      [family_id, item_name]
    );

    if (existRows.length > 0) {
      return res.json({
        status: "exists",
        item_id: existRows[0].item_id,
      });
    }

    const [result] = await pool.query(
      `INSERT INTO shared_checklist
        (family_id, item_name, is_checked, updated_by, updated_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [family_id, item_name, is_checked, updated_by]
    );

    return res.json({
      status: "ok",
      insertedId: result.insertId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/checklist/:id", async (req, res) => {
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

app.delete("/checklist/:id", async (req, res) => {
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
    await ensureVoiceSearchUsageSchema();
    app.listen(port, () => console.log(`API running on port ${port}`));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
