import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCENT, STATUS_COLOR, SURFACE, TEXT, TEXT_DIM } from "../lib/payloads.mjs";

/** WCAG relative luminance. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

const foregrounds = [
  ["body", TEXT],
  ["agent", ACCENT],
  ["time", TEXT_DIM],
  ...Object.entries(STATUS_COLOR).map(([k, v]) => [`status ${k}`, v]),
];

for (const [name, colour] of foregrounds) {
  test(`${name} clears AA on the surface`, () => {
    assert.ok(contrast(colour, SURFACE) >= AA, `${name} contrast`);
  });
}

test("the time is quieter than the body but still readable", () => {
  assert.ok(contrast(TEXT_DIM, SURFACE) < contrast(TEXT, SURFACE));
  assert.ok(contrast(TEXT_DIM, SURFACE) >= AA);
});

test("the surface separates from both page themes", () => {
  assert.ok(contrast(SURFACE, "#ffffff") > 10);
  assert.ok(contrast(SURFACE, "#000000") > 1.2);
});

test("status colours group into five distinct hues", () => {
  assert.equal(new Set(Object.values(STATUS_COLOR)).size, 5);
});
