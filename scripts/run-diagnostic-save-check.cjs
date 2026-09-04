const readline = require("node:readline/promises");

const baseUrl = process.argv[2] || "https://fueltechphil.vercel.app";
const branch = process.argv[3] || "Liloan";

async function askAdminPin() {
  if (process.env.FUELTECH_DIAGNOSTIC_ADMIN_PIN) return process.env.FUELTECH_DIAGNOSTIC_ADMIN_PIN;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question("Admin PIN: ");
  } finally {
    rl.close();
  }
}

async function postJson(path, body, token = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-fueltech-session": token } : {}) },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || `Request failed: ${path}`);
  return result;
}

(async () => {
  const pin = await askAdminPin();
  const login = await postJson("/api/auth/verify", { role: "Admin", branch, pin });
  if (!login.token) throw new Error("Admin login failed.");

  const result = await postJson("/api/admin/diagnostic-save-check", { branch }, login.token);
  console.log(result.message);
  console.log(`Branch: ${result.branch}`);
  console.log(`Test date: ${result.testDate}`);
  console.log(`Created: ${result.reportRowsCreated} fake reports, ${result.priceRowsCreated} fake price row`);
  console.log(`Remaining after cleanup: ${result.reportRowsRemaining} reports, ${result.priceRowsRemaining} prices`);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
