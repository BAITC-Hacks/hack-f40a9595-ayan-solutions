import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const colors = Object.fromEntries(
  [...css.matchAll(/--gm-([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [
    match[1],
    match[2],
  ]),
);
function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const contrast = (first: string, second: string) => {
  const a = luminance(colors[first]),
    b = luminance(colors[second]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
test("actual text tokens reach 4.5:1 against workspace surfaces", () => {
  for (const text of [
    "text",
    "text-muted",
    "text-subtle",
    "info",
    "warning",
    "error",
  ])
    for (const surface of ["bg", "surface", "surface-raised", "surface-hover"])
      expect(
        contrast(text, surface),
        `${text}/${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
  expect(contrast("on-primary", "primary")).toBeGreaterThanOrEqual(4.5);
  expect(contrast("on-primary", "primary-hover")).toBeGreaterThanOrEqual(4.5);
});
test("control boundaries and focus indicators reach 3:1", () => {
  for (const surface of ["bg", "surface", "surface-raised", "surface-hover"])
    for (const token of ["control-border", "focus"])
      expect(
        contrast(token, surface),
        `${token}/${surface}`,
      ).toBeGreaterThanOrEqual(3);
});
