/**
 * Pure Deck logic for the Decks settings screen (Phase 2 — launch
 * configuration).
 *
 * Kept free of React and Tauri (like `gamesFilter.ts` / `gridNavigation.ts`) so
 * the selection, grouping, preview, and validation rules are unit-testable in
 * isolation; `DecksView` is the thin layer that owns component state and invokes
 * the backend commands. The `selectDeck` rule here mirrors the Rust
 * `select_deck` (`src-tauri/src/launch.rs`) so the frontend can preview which
 * Deck a Release would launch under.
 */
import type { Catalog, Deck, DeckKind, Release } from "./catalog";

/** Argument tokens replaced with the ROM path at launch (mirrors the backend). */
export const ROM_PLACEHOLDERS = ["{rom}", "{file}"] as const;

/** Human-readable labels for the deck-kind selector, in display order. */
export const DECK_KINDS: { value: DeckKind; label: string }[] = [
  { value: "emulator", label: "Emulator" },
  { value: "directLaunch", label: "Direct launch" },
];

/** The launch kind of a deck, defaulting to `emulator` when unset. */
export function deckKind(deck: Deck): DeckKind {
  return deck.kind ?? "emulator";
}

/** Whether a deck is its platform's default (defaulting to `false` when unset). */
export function isDefaultDeck(deck: Deck): boolean {
  return deck.default ?? false;
}

/** Whether any of `args` carries a `{rom}` / `{file}` placeholder. */
export function hasRomPlaceholder(args: string[]): boolean {
  return args.some((arg) =>
    ROM_PLACEHOLDERS.some((token) => arg.includes(token)),
  );
}

/**
 * Select the Deck a Release launches under, mirroring the Rust `select_deck`.
 *
 * Precedence: an explicit `overrideId`, then the Release's stored `deckId`, then
 * the platform's `default` Deck, then simply the first Deck for the platform.
 * Returns `null` when nothing matches (an unknown override id, or a platform with
 * no Deck) — the caller decides how to surface that.
 */
export function selectDeck(
  catalog: Catalog,
  release: Release,
  overrideId?: string,
): Deck | null {
  const id = overrideId ?? release.deckId;
  if (id) {
    return catalog.decks.find((deck) => deck.id === id) ?? null;
  }
  const platformDecks = catalog.decks.filter(
    (deck) => deck.platform === release.platform,
  );
  return platformDecks.find(isDefaultDeck) ?? platformDecks[0] ?? null;
}

/** A platform and its Decks, default first — one section of the settings list. */
export interface PlatformDecks {
  platform: string;
  decks: Deck[];
}

/**
 * Group `decks` by platform for the settings list: platforms sorted
 * alphabetically, and within each platform the default Deck first (then original
 * order). Never mutates the input.
 */
export function decksByPlatform(decks: Deck[]): PlatformDecks[] {
  const byPlatform = new Map<string, Deck[]>();
  for (const deck of decks) {
    const list = byPlatform.get(deck.platform);
    if (list) list.push(deck);
    else byPlatform.set(deck.platform, [deck]);
  }
  return [...byPlatform.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((platform) => ({
      platform,
      decks: [...byPlatform.get(platform)!].sort(
        (a, b) => Number(isDefaultDeck(b)) - Number(isDefaultDeck(a)),
      ),
    }));
}

/** Replace every ROM placeholder token in `arg` with `replacement`. */
function fillPlaceholders(arg: string, replacement: string): string {
  return ROM_PLACEHOLDERS.reduce(
    (out, token) => out.split(token).join(replacement),
    arg,
  );
}

/**
 * A human-readable preview of the command a Deck runs, with `<rom>` standing in
 * for the resolved Release path. Mirrors the backend's argv assembly: an emulator
 * Deck substitutes `{rom}` in place, or appends `<rom>` last when it has no
 * placeholder; a direct-launch Deck runs `<rom>` itself with its own arguments.
 */
export function previewCommand(deck: Deck): string {
  if (deckKind(deck) === "directLaunch") {
    return ["<rom>", ...deck.arguments].join(" ");
  }
  const program = deck.executablePath.trim() || "<emulator>";
  const args = hasRomPlaceholder(deck.arguments)
    ? deck.arguments.map((arg) => fillPlaceholders(arg, "<rom>"))
    : [...deck.arguments, "<rom>"];
  return [program, ...args].join(" ");
}

/** Split a whitespace-separated argument string into individual arguments. */
export function parseArguments(raw: string): string[] {
  return raw.split(/\s+/).filter((part) => part.length > 0);
}

/** Join structured arguments back into a single editable string. */
export function formatArguments(args: string[]): string {
  return args.join(" ");
}

/**
 * Validate a single Deck for saving. Returns an error message, or `null` when the
 * Deck is valid. An emulator Deck needs an executable; a direct-launch Deck does
 * not (the ROM is the program).
 */
export function validateDeck(deck: Deck): string | null {
  if (!deck.id.trim()) return "Deck id is required.";
  if (!deck.platform.trim()) return "Platform is required.";
  if (deckKind(deck) === "emulator" && !deck.executablePath.trim()) {
    return "An emulator deck needs an executable path.";
  }
  return null;
}

/**
 * Validate the whole Deck set before persisting: every Deck individually valid,
 * ids unique, and at most one default per platform. Returns an error message or
 * `null`.
 */
export function validateDecks(decks: Deck[]): string | null {
  const seenIds = new Set<string>();
  const defaultedPlatforms = new Set<string>();
  for (const deck of decks) {
    const problem = validateDeck(deck);
    if (problem) return problem;
    if (seenIds.has(deck.id)) return `Duplicate deck id '${deck.id}'.`;
    seenIds.add(deck.id);
    if (isDefaultDeck(deck)) {
      if (defaultedPlatforms.has(deck.platform)) {
        return `Platform '${deck.platform}' has more than one default deck.`;
      }
      defaultedPlatforms.add(deck.platform);
    }
  }
  return null;
}

/**
 * Insert or replace `deck` in `decks` (matched by id), returning a new array. If
 * `deck` is marked default, any other Deck for the same platform is un-defaulted
 * so a platform keeps a single default. Never mutates the input.
 */
export function upsertDeck(decks: Deck[], deck: Deck): Deck[] {
  const cleared = deck.default
    ? decks.map((existing) =>
        existing.platform === deck.platform && existing.id !== deck.id
          ? { ...existing, default: false }
          : existing,
      )
    : decks;

  const index = cleared.findIndex((existing) => existing.id === deck.id);
  if (index === -1) return [...cleared, deck];
  const next = [...cleared];
  next[index] = deck;
  return next;
}

/** Remove the Deck with `id`, returning a new array. */
export function removeDeck(decks: Deck[], id: string): Deck[] {
  return decks.filter((deck) => deck.id !== id);
}

/**
 * Make the Deck with `id` its platform's default, un-defaulting the platform's
 * other Decks. Returns a new array; a no-op (fresh copy) if `id` is unknown.
 */
export function makeDefault(decks: Deck[], id: string): Deck[] {
  const target = decks.find((deck) => deck.id === id);
  if (!target) return [...decks];
  return decks.map((deck) => {
    if (deck.platform !== target.platform) return deck;
    return { ...deck, default: deck.id === id };
  });
}

/** Turn a suggested id stem into a slug that is safe and stable as a deck id. */
function slugifyId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A fresh blank Deck for the "Add deck" form, with an id that does not clash with
 * `existingIds`. When `platform` is given the id is seeded from it
 * (`snes-2`, …); otherwise a generic `deck` stem is used.
 */
export function blankDeck(existingIds: string[], platform = ""): Deck {
  const stem = slugifyId(platform) || "deck";
  const used = new Set(existingIds);
  let candidate = stem;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${n}`;
    n += 1;
  }
  return {
    id: candidate,
    platform,
    executablePath: "",
    arguments: [],
    kind: "emulator",
    default: false,
  };
}
