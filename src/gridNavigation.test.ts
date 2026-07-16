import { describe, expect, it } from "vitest";
import { computeColumns, moveFocusIndex } from "./gridNavigation";

describe("computeColumns", () => {
  it("fits as many items as the container width allows", () => {
    // 1000px container, 220px cards, 16px gap -> floor(1000 / 236) = 4
    expect(computeColumns(1000, 220, 16)).toBe(4);
  });

  it("always returns at least one column", () => {
    expect(computeColumns(50, 220, 16)).toBe(1);
  });

  it("returns one column for a zero or negative width container", () => {
    expect(computeColumns(0, 220, 16)).toBe(1);
    expect(computeColumns(-10, 220, 16)).toBe(1);
  });
});

describe("moveFocusIndex", () => {
  // A 3-column grid of 7 items:
  // [0] [1] [2]
  // [3] [4] [5]
  // [6]
  const itemCount = 7;
  const columns = 3;

  it("moves right within a row", () => {
    expect(moveFocusIndex(0, "right", itemCount, columns)).toBe(1);
  });

  it("moves left within a row", () => {
    expect(moveFocusIndex(1, "left", itemCount, columns)).toBe(0);
  });

  it("moves down a full row", () => {
    expect(moveFocusIndex(1, "down", itemCount, columns)).toBe(4);
  });

  it("moves up a full row", () => {
    expect(moveFocusIndex(4, "up", itemCount, columns)).toBe(1);
  });

  it("wraps right from the last column to the start of the next row", () => {
    expect(moveFocusIndex(2, "right", itemCount, columns)).toBe(3);
  });

  it("wraps left from the first column to the end of the previous row", () => {
    expect(moveFocusIndex(3, "left", itemCount, columns)).toBe(2);
  });

  it("wraps right from the very last item back to the first item", () => {
    expect(moveFocusIndex(6, "right", itemCount, columns)).toBe(0);
  });

  it("wraps left from the first item back to the last item", () => {
    expect(moveFocusIndex(0, "left", itemCount, columns)).toBe(6);
  });

  it("wraps down from the last row back to the top, clamped into the ragged row's column", () => {
    // row2 only has column 0 (item 6); moving down from row1 col2 clamps to it.
    expect(moveFocusIndex(5, "down", itemCount, columns)).toBe(6);
  });

  it("wraps down from the ragged last row back to the top", () => {
    expect(moveFocusIndex(6, "down", itemCount, columns)).toBe(0);
  });

  it("wraps up from the first row into the ragged last row, clamped to its column", () => {
    expect(moveFocusIndex(0, "up", itemCount, columns)).toBe(6);
    expect(moveFocusIndex(2, "up", itemCount, columns)).toBe(6);
  });

  it("returns the same index when there are no items", () => {
    expect(moveFocusIndex(0, "right", 0, columns)).toBe(0);
  });

  it("stays put when there is only one item", () => {
    expect(moveFocusIndex(0, "right", 1, 3)).toBe(0);
    expect(moveFocusIndex(0, "down", 1, 3)).toBe(0);
  });
});

describe("moveFocusIndex with a leading full-width row", () => {
  // A hero banner above a 3-column grid of 6 cards (7 items total):
  // [0        ]   <- hero, full width
  // [1] [2] [3]
  // [4] [5] [6]
  const itemCount = 7;
  const columns = 3;
  const leading = 1;

  it("moves down from the hero into the first grid row's first column", () => {
    expect(moveFocusIndex(0, "down", itemCount, columns, leading)).toBe(1);
  });

  it("moves up from anywhere in the first grid row back to the hero", () => {
    expect(moveFocusIndex(1, "up", itemCount, columns, leading)).toBe(0);
    expect(moveFocusIndex(3, "up", itemCount, columns, leading)).toBe(0);
  });

  it("keeps the column when moving between grid rows below the hero", () => {
    expect(moveFocusIndex(2, "down", itemCount, columns, leading)).toBe(5);
    expect(moveFocusIndex(6, "up", itemCount, columns, leading)).toBe(3);
  });

  it("wraps up from the hero into the last grid row", () => {
    expect(moveFocusIndex(0, "up", itemCount, columns, leading)).toBe(4);
  });

  it("wraps down from the last grid row back to the hero", () => {
    expect(moveFocusIndex(5, "down", itemCount, columns, leading)).toBe(0);
  });

  it("clamps into a ragged last row when descending past it", () => {
    // [0] hero / [1][2][3] / [4] — moving down from col 2 clamps to item 4.
    expect(moveFocusIndex(3, "down", 5, columns, leading)).toBe(4);
  });

  it("walks linearly with left/right straight through the hero", () => {
    expect(moveFocusIndex(0, "right", itemCount, columns, leading)).toBe(1);
    expect(moveFocusIndex(1, "left", itemCount, columns, leading)).toBe(0);
    expect(moveFocusIndex(0, "left", itemCount, columns, leading)).toBe(6);
  });

  it("matches the plain grid behaviour when leading is zero", () => {
    expect(moveFocusIndex(1, "down", itemCount, columns, 0)).toBe(4);
    expect(moveFocusIndex(1, "down", itemCount, columns)).toBe(
      moveFocusIndex(1, "down", itemCount, columns, 0),
    );
  });
});
