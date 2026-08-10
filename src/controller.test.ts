import { describe, expect, it } from "vitest";
import {
  controllerActionsForGamepad,
  controllerActionForKey,
  type GamepadSnapshot,
} from "./controller";

function buttons(overrides: Record<number, boolean> = {}): boolean[] {
  return Array.from({ length: 16 }, (_, index) => overrides[index] ?? false);
}

function snapshot(
  overrides: Record<number, boolean> = {},
  axes: [number, number] = [0, 0],
): GamepadSnapshot {
  return { buttons: buttons(overrides), axes };
}

describe("controller input semantics", () => {
  it.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["Enter", "confirm"],
    ["Escape", "back"],
    ["F1", "menu"],
    ["[", "previousSection"],
    ["]", "nextSection"],
  ] as const)("maps %s to %s", (key, action) => {
    expect(controllerActionForKey(key)).toBe(action);
  });

  it("emits a button action only on the press edge", () => {
    const pressed = snapshot({ 0: true });
    expect(controllerActionsForGamepad(pressed, snapshot(), 0)).toEqual([
      "confirm",
    ]);
    expect(controllerActionsForGamepad(pressed, pressed, 0)).toEqual([]);
  });

  it("supports standard buttons and a held direction with controlled repeat", () => {
    const pressed = snapshot({ 4: true, 5: true, 9: true, 12: true });
    expect(controllerActionsForGamepad(pressed, snapshot(), 0)).toEqual([
      "previousSection",
      "nextSection",
      "menu",
      "up",
    ]);

    expect(controllerActionsForGamepad(pressed, pressed, 100)).toEqual([]);
    expect(controllerActionsForGamepad(pressed, pressed, 250)).toEqual(["up"]);
  });

  it("uses the left stick when the d-pad is idle", () => {
    expect(
      controllerActionsForGamepad(snapshot({}, [0.8, 0]), snapshot(), 0),
    ).toEqual(["right"]);
  });
});
