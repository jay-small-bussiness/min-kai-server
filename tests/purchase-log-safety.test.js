const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const serverSource = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf8"
);

function getPurchaseLogRegion() {
  const start = serverSource.indexOf('console.log("purchase verification result"');
  const end = serverSource.indexOf('app.post("/api/voice-search/usage"');

  assert.notEqual(start, -1, "purchase verification log must exist");
  assert.notEqual(end, -1, "purchase log region must have an endpoint boundary");
  return serverSource.slice(start, end);
}

function getPurchaseLogs() {
  return (
    getPurchaseLogRegion().match(
      /console\.(?:log|warn|error)\([\s\S]*?\n\s*\}\);/g
    ) ?? []
  ).join("\n");
}

function getPurchaseEndpoint() {
  const start = serverSource.indexOf('app.post("/api/billing/purchases/sync"');
  const end = serverSource.indexOf('app.post("/api/voice-search/usage"');

  assert.notEqual(start, -1, "purchase sync endpoint must exist");
  assert.notEqual(end, -1, "purchase sync endpoint must have a boundary");
  return serverSource.slice(start, end);
}

test("purchase logs never map full identifiers or token heads", () => {
  const source = getPurchaseLogs();

  assert.doesNotMatch(source, /\buser_id\s*:\s*userId\b/);
  assert.doesNotMatch(source, /\baccount_uuid\s*:/);
  assert.doesNotMatch(source, /\btokenHead\s*:/);
  assert.doesNotMatch(source, /\bpurchaseToken\s*[,}]/);
  assert.doesNotMatch(getPurchaseEndpoint(), /console\.error\(err\)/);
});

test("purchase logs expose only explicit identifier suffix fields", () => {
  const source = getPurchaseLogRegion();

  assert.match(source, /userIdLast4:\s*getIdentifierLast4\(userId\)/);
  assert.match(
    source,
    /accountUuidLast4:\s*getIdentifierLast4\(result\.account\?\.account_uuid\)/
  );
  assert.match(source, /tokenLength:\s*purchaseToken\.length/);
  assert.match(source, /tokenLast4:\s*purchaseToken\.slice\(-4\)/);
});

test("purchase completion log keeps operational result fields observable", () => {
  const source = getPurchaseLogRegion();

  assert.match(source, /console\.log\("purchase sync completed"/);
  assert.match(source, /httpStatus:\s*200/);
  assert.match(source, /accountLinkStatus:\s*result\.accountLinkStatus/);
  assert.match(source, /linkedDeviceCount:\s*result\.linkedDeviceCount/);
  assert.match(source, /acknowledgeStatus:\s*result\.acknowledgeStatus/);
  assert.match(source, /plan:\s*result\.planResponse\?\.plan/);
});
