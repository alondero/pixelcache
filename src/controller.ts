export type Direction = "up" | "down" | "left" | "right";

export type ControllerAction =
  | Direction
  | "confirm"
  | "back"
  | "menu"
  | "secondary"
  | "favorite"
  | "previousSection"
  | "nextSection";

export interface GamepadSnapshot {
  buttons: boolean[];
  axes: [number, number];
}

const DIRECTION_BUTTONS: readonly [number, Direction][] = [
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];

const BUTTON_ACTIONS: readonly [
  number,
  Exclude<ControllerAction, Direction>[],
][] = [
  [0, ["confirm"]],
  [1, ["back"]],
  [2, ["secondary"]],
  [3, ["favorite"]],
  [4, ["previousSection"]],
  [5, ["nextSection"]],
  [9, ["menu"]],
];

const STICK_THRESHOLD = 0.5;
export const CONTROLLER_REPEAT_DELAY_MS = 200;

/** Translate keyboard equivalents into the same semantic actions as a controller. */
export function controllerActionForKey(key: string): ControllerAction | null {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
    case " ":
      return "confirm";
    case "Escape":
      return "back";
    case "F1":
      return "menu";
    case "[":
    case "PageUp":
      return "previousSection";
    case "]":
    case "PageDown":
      return "nextSection";
    case "x":
    case "X":
      return "secondary";
    case "y":
    case "Y":
      return "favorite";
    default:
      return null;
  }
}

function readDirection(snapshot: GamepadSnapshot): Direction | null {
  for (const [index, direction] of DIRECTION_BUTTONS) {
    if (snapshot.buttons[index]) return direction;
  }

  const [x, y] = snapshot.axes;
  if (y < -STICK_THRESHOLD) return "up";
  if (y > STICK_THRESHOLD) return "down";
  if (x < -STICK_THRESHOLD) return "left";
  if (x > STICK_THRESHOLD) return "right";
  return null;
}

/**
 * Convert one standard-mapped Gamepad frame into semantic actions.
 *
 * Button actions are edge-triggered. Direction is emitted immediately when it
 * changes and then at a fixed repeat cadence while held. Keeping this pure
 * makes the timing and repeat contract testable without a browser RAF loop.
 */
export function controllerActionsForGamepad(
  current: GamepadSnapshot,
  previous: GamepadSnapshot | null,
  elapsedSinceDirection: number,
): ControllerAction[] {
  const actions: ControllerAction[] = [];
  for (const [index, mappedActions] of BUTTON_ACTIONS) {
    if (current.buttons[index] && !previous?.buttons[index]) {
      actions.push(...mappedActions);
    }
  }

  const direction = readDirection(current);
  const previousDirection = previous ? readDirection(previous) : null;
  if (
    direction &&
    (direction !== previousDirection ||
      elapsedSinceDirection >= CONTROLLER_REPEAT_DELAY_MS)
  ) {
    actions.push(direction);
  }

  return actions;
}

export function gamepadSnapshot(pad: Gamepad): GamepadSnapshot {
  const axes: [number, number] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
  return {
    buttons: pad.buttons.map((button) => button.pressed),
    axes,
  };
}
