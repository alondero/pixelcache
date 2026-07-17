/**
 * Pure media logic for Phase 3 — media.
 *
 * Kept free of React and Tauri (like `gamesFilter.ts` / `decks.ts`) so the
 * fallback, preview-selection, URL, and catalog-update rules are unit-testable in
 * isolation; `GameDetailsPanel`, `GameGrid`, and `MediaView` are the thin layers
 * that render or persist. The fallback rule here mirrors the Rust `resolved_slot`
 * (`src-tauri/src/media.rs`) so the frontend previews the same artwork the media
 * protocol would serve.
 */
import type { Catalog, Game, Media, Release } from "./catalog";

/** The URI scheme the backend media protocol is registered under. */
export const MEDIA_SCHEME = "pixelcache-media";

/** The media slots in display order, with labels for the assignment UI. */
export const MEDIA_SLOTS = [
  { slot: "image", label: "Cover image" },
  { slot: "video", label: "Preview video" },
  { slot: "logo", label: "Clear logo" },
  { slot: "marquee", label: "Marquee" },
  { slot: "screenshot", label: "Screenshot" },
  { slot: "boxart", label: "Box art" },
  { slot: "fanart", label: "Fan art" },
] as const;

/** A media slot name — a key of {@link Media}. */
export type MediaSlot = (typeof MEDIA_SLOTS)[number]["slot"];

const SLOT_NAMES: MediaSlot[] = MEDIA_SLOTS.map((s) => s.slot);

/**
 * Merge a Release's media with its Game's, per slot: the Release's own value
 * wins, otherwise the Game's fills in. Mirrors the backend `resolved_slot`.
 * Returns a plain object with only the set slots.
 */
export function resolveMedia(release?: Media, game?: Media): Media {
  const resolved: Media = {};
  for (const slot of SLOT_NAMES) {
    const value = release?.[slot] ?? game?.[slot];
    if (value) resolved[slot] = value;
  }
  return resolved;
}

/**
 * The best still for a resolved media set, ignoring the moving `video` slot.
 * The Continue Playing hero, the games grid, and any other surface that
 * shows a static thumbnail use this so the artwork fallback chain is in one
 * place — and so the hero never tries to autoplay a video where the rest of
 * the grid is still. The slot order (cover, screenshot, boxart, fanart, logo,
 * marquee) matches `previewSource`'s still precedence.
 */
export function stillSource(
  media: Media,
): { kind: "image"; slot: MediaSlot } | null {
  const stillOrder: MediaSlot[] = [
    "image",
    "screenshot",
    "boxart",
    "fanart",
    "logo",
    "marquee",
  ];
  for (const slot of stillOrder) {
    if (media[slot]) return { kind: "image", slot };
  }
  return null;
}

/**
 * The best preview for a resolved media set: the moving `video` if present,
 * otherwise the first available still (cover image, then screenshot, box art,
 * fanart, logo, marquee). Returns `null` when nothing is set. The caller turns
 * the `{ kind, slot }` into a protocol URL via {@link mediaSrc}.
 */
export function previewSource(
  media: Media,
): { kind: "video" | "image"; slot: MediaSlot } | null {
  if (media.video) return { kind: "video", slot: "video" };
  return stillSource(media);
}

/**
 * The URL a WebView `<img>`/`<video>` uses to fetch a Release's media slot over
 * the `pixelcache-media://` protocol; the backend resolves the actual file
 * (applying the game-level fallback). Windows/Android serve custom schemes over
 * `http://<scheme>.localhost/`, every other platform over `<scheme>://localhost/`.
 */
export function mediaSrc(releaseId: string, slot: MediaSlot): string {
  const path = `${encodeURIComponent(releaseId)}/${slot}`;
  return isWindowsLike()
    ? `http://${MEDIA_SCHEME}.localhost/${path}`
    : `${MEDIA_SCHEME}://localhost/${path}`;
}

/** Whether the current WebView serves custom schemes over the `http` host form. */
function isWindowsLike(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Windows|Android/i.test(navigator.userAgent)
  );
}

/** Whether a media object has no slots set (so it can be stored as `undefined`). */
export function isMediaEmpty(media: Media): boolean {
  return SLOT_NAMES.every((slot) => !media[slot]);
}

/** An editable string-per-slot draft, e.g. for the assignment form. */
export type MediaDraft = Record<MediaSlot, string>;

/** A blank draft with every slot empty. */
export function emptyDraft(): MediaDraft {
  return Object.fromEntries(SLOT_NAMES.map((s) => [s, ""])) as MediaDraft;
}

/** Fill a draft from an existing media object (missing slots become empty). */
export function draftFromMedia(media?: Media): MediaDraft {
  const draft = emptyDraft();
  for (const slot of SLOT_NAMES) draft[slot] = media?.[slot] ?? "";
  return draft;
}

/**
 * Build a {@link Media} from a draft, trimming each value and dropping blanks.
 * Returns `undefined` when nothing is set, so a cleared assignment persists as an
 * absent `media` field rather than an empty object.
 */
export function mediaFromDraft(draft: MediaDraft): Media | undefined {
  const media: Media = {};
  for (const slot of SLOT_NAMES) {
    const value = draft[slot]?.trim();
    if (value) media[slot] = value;
  }
  return isMediaEmpty(media) ? undefined : media;
}

/** Replace one Release's media in the catalog, returning a new catalog. */
export function setReleaseMedia(
  catalog: Catalog,
  releaseId: string,
  media: Media | undefined,
): Catalog {
  return {
    ...catalog,
    releases: catalog.releases.map((release) =>
      release.id === releaseId ? withMedia(release, media) : release,
    ),
  };
}

/** Replace one Game's fallback media in the catalog, returning a new catalog. */
export function setGameMedia(
  catalog: Catalog,
  gameId: string,
  media: Media | undefined,
): Catalog {
  return {
    ...catalog,
    games: catalog.games.map((game) =>
      game.id === gameId ? withMedia(game, media) : game,
    ),
  };
}

/** Set (or clear, when `undefined`) the `media` field on a Release or Game. */
function withMedia<T extends Release | Game>(
  entity: T,
  media: Media | undefined,
): T {
  const next = { ...entity };
  if (media) next.media = media;
  else delete next.media;
  return next;
}
