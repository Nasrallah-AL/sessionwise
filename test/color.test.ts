import { describe, expect, it } from "vitest";
import { paint, shouldColor } from "../src/color.js";

describe("shouldColor", () => {
  it("is off when NO_COLOR is set", () => {
    expect(shouldColor({ NO_COLOR: "1" }, true)).toBe(false);
    expect(shouldColor({ NO_COLOR: "" }, true)).toBe(true); // empty string means unset, per NO_COLOR spec
  });

  it("is on when FORCE_COLOR is set, even without a TTY", () => {
    expect(shouldColor({ FORCE_COLOR: "1" }, false)).toBe(true);
    expect(shouldColor({ FORCE_COLOR: "0" }, true)).toBe(false);
  });

  it("follows the TTY when neither is set", () => {
    expect(shouldColor({}, true)).toBe(true);
    expect(shouldColor({}, false)).toBe(false);
  });
});

describe("paint", () => {
  it("returns the text unchanged when disabled", () => {
    expect(paint(false, "bold", "hello")).toBe("hello");
  });

  it("wraps the text in ANSI codes when enabled", () => {
    const result = paint(true, "bold", "hello");
    expect(result).not.toBe("hello");
    expect(result).toContain("hello");
  });
});
