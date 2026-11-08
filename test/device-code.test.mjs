import assert from "node:assert/strict";
import { test } from "node:test";

import { bestDeviceUrl, parseDeviceAuth } from "../lib/device-code.mjs";

const SAMPLE = `
To sign in, open this URL in a browser:
  https://idp.pushtodisplay.com/device

Then enter the code: ABCD-EFGH

Or open this link directly:
  https://idp.pushtodisplay.com/device?user_code=ABCD-EFGH
`;

test("parseDeviceAuth finds the URL and code", () => {
  const parsed = parseDeviceAuth(SAMPLE);
  assert.equal(parsed.url, "https://idp.pushtodisplay.com/device");
  assert.equal(parsed.completeUrl, "https://idp.pushtodisplay.com/device?user_code=ABCD-EFGH");
  assert.equal(parsed.code, "ABCD-EFGH");
  assert.equal(bestDeviceUrl(parsed), parsed.completeUrl);
});

test("parseDeviceAuth tolerates ANSI colour codes and a code only in the URL", () => {
  const parsed = parseDeviceAuth(
    "\u001b[36mOpen https://idp.example/device?user_code=WXYZ-1234\u001b[0m",
  );
  assert.equal(parsed.code, "WXYZ-1234");
  assert.equal(bestDeviceUrl(parsed), "https://idp.example/device?user_code=WXYZ-1234");
});

test("parseDeviceAuth returns empty strings for unrelated output", () => {
  assert.deepEqual(parseDeviceAuth("Login failed: network down"), {
    url: "",
    completeUrl: "",
    code: "",
  });
});
