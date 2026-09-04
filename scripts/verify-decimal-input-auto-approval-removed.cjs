const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const saveApi = fs.readFileSync(path.join(__dirname, "..", "api", "reports", "save.js"), "utf8");

const numberInputStart = app.indexOf("function NumberInput");
assert(numberInputStart >= 0, "NumberInput should exist.");
const numberInputEnd = app.indexOf("function SelectInput", numberInputStart);
const numberInput = app.slice(numberInputStart, numberInputEnd);

assert(app.includes("const DECIMAL_INPUT_PATTERN = /^-?\\d*([.,]\\d*)?$/;"), "Decimal input should accept dot and comma decimal separators.");
assert(numberInput.includes('event.target.value.replace(",", ".")'), "NumberInput should normalize comma decimals to dot decimals.");
assert(numberInput.includes("onChange(nextValue)"), "NumberInput should pass decimal text through while typing.");
assert(!numberInput.includes("Number(event.target.value)"), "NumberInput should not immediately coerce decimals to Number.");

assert(!app.includes("function shouldAutoApproveLiloanShift3Correction"), "Liloan Shift 3 auto-approval should be removed.");
assert(!app.includes("pendingAutoApprovals"), "No background correction request auto-approval should run.");
assert(!app.includes("status: shouldAutoApprove ?"), "New correction requests should not auto-approve.");
assert(app.includes("repairAutoApprovedCorrection"), "Existing auto-approved reports should be repaired safely.");
assert(app.includes("!correctionRequest(report).autoApproved"), "Old auto-approved requests should not become active correction reports.");

assert(app.includes("withClientSaveMeta"), "Report saves should carry client save metadata.");
assert(app.includes("localChangeVersionRef.current === version"), "Older save completions should not mark newer edits saved.");
assert(saveApi.includes("isStaleSameClientSave"), "Save API should detect stale same-client saves.");
assert(saveApi.includes("staleSave: true"), "Save API should reject stale saves visibly so the device retains its draft.");
assert(!saveApi.includes("staleIgnored"), "Stale saves must not be reported as successful and silently removed from the offline queue.");

console.log("Decimal input, auto-approval removal, and stale-save guard check passed.");
