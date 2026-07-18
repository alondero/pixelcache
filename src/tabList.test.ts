import { describe, expect, it } from "vitest";
import { nextTabIndex } from "./tabList";

describe("nextTabIndex", () => {
  it("moves right and wraps past the last tab", () => {
    expect(nextTabIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextTabIndex(2, "ArrowRight", 3)).toBe(0);
  });

  it("moves left and wraps past the first tab", () => {
    expect(nextTabIndex(1, "ArrowLeft", 3)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 3)).toBe(2);
  });

  it("jumps to the first tab on Home and the last on End", () => {
    expect(nextTabIndex(2, "Home", 3)).toBe(0);
    expect(nextTabIndex(0, "End", 3)).toBe(2);
  });

  it("ignores keys that are not tablist navigation keys", () => {
    expect(nextTabIndex(0, "Enter", 3)).toBeNull();
    expect(nextTabIndex(0, "a", 3)).toBeNull();
    expect(nextTabIndex(0, "ArrowDown", 3)).toBeNull();
  });

  it("is a no-op when there are no tabs", () => {
    expect(nextTabIndex(0, "ArrowRight", 0)).toBeNull();
  });
});
