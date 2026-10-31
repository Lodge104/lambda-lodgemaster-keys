const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const {
  DynamoDBClient,
  BatchWriteItemCommand,
} = require("@aws-sdk/client-dynamodb");

const REGION = "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "lodge104-keys";

// LodgeMaster now delegates login to an OpenID Connect identity server:
//   lodgemaster-client -> portal.oa-scouting.org -> id.oa-scouting.org (login)
const START_URL = "https://lodgemaster-client.oa-scouting.org/";
const IDENTITY_HOST = "id.oa-scouting.org";
const COOKIE_URLS = [
  "https://lodgemaster-client.oa-scouting.org/",
  "https://portal.oa-scouting.org/",
];

// Optional comma separated allow-list of cookie names to store. When unset,
// every cookie issued for the LodgeMaster/portal hosts is stored.
const COOKIE_NAMES = (process.env.COOKIE_NAMES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const LOGIN_TIMEOUT_MS = 60000;
const MAX_BATCH_SIZE = 25; // DynamoDB BatchWriteItem limit
const MAX_RETRIES = 5;

const ddbClient = new DynamoDBClient({ region: REGION });

console.log("Loading function");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(page) {
  await page.setViewport({ width: 1080, height: 1024 });
  await page.goto(START_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // The request is redirected to the identity server login form.
  await page.waitForSelector("#Username", { timeout: 30000 });
  await page.type("#Username", process.env.USERNAME);
  await page.type("#Password", process.env.PASSWORD);

  const submitSelector = "form.oa-form button[type=submit]";
  await page.waitForSelector(submitSelector);

  // Race: either we leave the identity server (success) or the form shows
  // a validation error (failure).
  const loggedIn = page.waitForFunction(
    (identityHost) => window.location.host !== identityHost,
    { timeout: LOGIN_TIMEOUT_MS },
    IDENTITY_HOST,
  );
  const failed = page
    .waitForSelector(".validation-summary-errors", {
      timeout: LOGIN_TIMEOUT_MS,
    })
    .then(() => {
      throw new Error("LodgeMaster rejected the login credentials");
    });
  // Avoid unhandled rejections from whichever promise loses the race.
  loggedIn.catch(() => {});
  failed.catch(() => {});

  await Promise.all([
    page.click(submitSelector),
    Promise.race([loggedIn, failed]),
  ]);

  // Let the redirect chain back to the app finish and cookies settle.
  await page.waitForNetworkIdle({ idleTime: 2000, timeout: LOGIN_TIMEOUT_MS });

  const finalUrl = new URL(page.url());
  if (finalUrl.host === IDENTITY_HOST) {
    throw new Error(`Login did not complete, still on ${page.url()}`);
  }
  console.log(`Logged in, landed on ${finalUrl.origin}${finalUrl.pathname}`);
}

async function collectCookies(page) {
  const all = await page.cookies(...COOKIE_URLS);
  const byName = new Map();
  for (const c of all) {
    if (COOKIE_NAMES.length && !COOKIE_NAMES.includes(c.name)) continue;
    if (!c.value) continue;
    byName.set(c.name, c.value);
  }
  if (byName.size === 0) {
    throw new Error(
      `No cookies captured after login (urls: ${COOKIE_URLS.join(", ")}` +
        `${COOKIE_NAMES.length ? `, filter: ${COOKIE_NAMES.join(",")}` : ""})`,
    );
  }
  console.log(`Captured cookies: ${[...byName.keys()].join(", ")}`);
  return byName;
}

async function writeCookies(cookies) {
  const requests = [...cookies].map(([name, value]) => ({
    PutRequest: { Item: { name: { S: name }, value: { S: value } } },
  }));

  for (let i = 0; i < requests.length; i += MAX_BATCH_SIZE) {
    let pending = { [TABLE_NAME]: requests.slice(i, i + MAX_BATCH_SIZE) };

    for (let attempt = 0; Object.keys(pending).length > 0; attempt++) {
      if (attempt >= MAX_RETRIES) {
        throw new Error("Gave up writing unprocessed items to DynamoDB");
      }
      if (attempt > 0) await sleep(100 * 2 ** attempt);

      const data = await ddbClient.send(
        new BatchWriteItemCommand({ RequestItems: pending }),
      );
      pending = data.UnprocessedItems || {};
    }
  }
  console.log(`Success, ${requests.length} items written to ${TABLE_NAME}`);
}

exports.handler = async () => {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(
      process.env.AWS_EXECUTION_ENV
        ? "/opt/nodejs/node_modules/@sparticuz/chromium/bin"
        : undefined,
    ),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await browser.newPage();
    await login(page);
    const cookies = await collectCookies(page);
    // Awaited before the browser closes so failures surface to Lambda.
    await writeCookies(cookies);
    return { statusCode: 200, cookies: [...cookies.keys()] };
  } catch (err) {
    console.error("Scrape failed", err);
    throw err;
  } finally {
    await browser.close();
  }
};
