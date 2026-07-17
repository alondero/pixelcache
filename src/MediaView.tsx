import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog, Media } from "./catalog";
import { primaryReleaseTitle } from "./catalogView";
import ArtworkScraper from "./ArtworkScraper";
import {
  MEDIA_SLOTS,
  type MediaDraft,
  draftFromMedia,
  isMediaEmpty,
  mediaFromDraft,
  mediaSrc,
  previewSource,
  resolveMedia,
} from "./media";

interface MediaViewProps {
  catalog: Catalog;
  /** Called with the catalog returned by `save_media` so the whole app refreshes. */
  onCatalogChange: (catalog: Catalog) => void;
}

type SaveStatus =
  { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

/** What a media assignment is being edited for: a Release, or a Game's fallback. */
type Target =
  | { kind: "release"; id: string; title: string }
  | { kind: "game"; id: string; title: string };

/** The count of assigned slots in a media object, for the row summary. */
function slotCount(media?: Media): number {
  return MEDIA_SLOTS.filter(({ slot }) => media?.[slot]).length;
}

/**
 * The "Media" screen: assign artwork (cover, video, logo, marquee, screenshot,
 * box art, fanart) to each Release, or to a Game as a fallback its Releases
 * inherit. Persists the whole assignment through the `save_media` command, which
 * returns the updated Catalog so the rest of the app refreshes — mirroring how
 * `DecksView` treats `save_decks`.
 *
 * Media files live in the Vault (or bundled resources) and are served over the
 * `pixelcache-media://` protocol; this screen only edits the catalog's *paths*.
 */
function MediaView({ catalog, onCatalogChange }: MediaViewProps) {
  const games = catalog.games;
  const [selectedGameId, setSelectedGameId] = useState<string>(
    games[0]?.id ?? "",
  );
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  const selectedGame =
    games.find((g) => g.id === selectedGameId) ?? games[0] ?? null;

  const releases = useMemo(
    () =>
      selectedGame
        ? catalog.releases.filter((r) => r.gameId === selectedGame.id)
        : [],
    [catalog.releases, selectedGame],
  );

  function startEdit(next: Target, media?: Media) {
    setSaveStatus({ kind: "idle" });
    setTarget(next);
    setDraft(draftFromMedia(media));
  }

  function cancelEdit() {
    setTarget(null);
    setDraft(null);
  }

  async function save() {
    if (!target || !draft) return;
    const media = mediaFromDraft(draft);
    setSaveStatus({ kind: "saving" });
    try {
      const args =
        target.kind === "release"
          ? { releaseId: target.id, releaseMedia: media ?? null }
          : { gameId: target.id, gameMedia: media ?? null };
      const updated = await invoke<Catalog>("save_media", args);
      onCatalogChange(updated);
      setSaveStatus({ kind: "idle" });
      setTarget(null);
      setDraft(null);
    } catch (error) {
      setSaveStatus({ kind: "error", message: String(error) });
    }
  }

  const isSaving = saveStatus.kind === "saving";

  return (
    <section className="media-view" aria-label="Media settings">
      <p className="decks-lead">
        Assign artwork to each Release, or to a Game so all its Releases inherit
        it. Paths resolve against the Release&rsquo;s Vault (or bundled media)
        and are served over the media protocol.
      </p>

      <ArtworkScraper catalog={catalog} onCatalogChange={onCatalogChange} />

      {games.length === 0 && (
        <p className="status" role="status">
          No games yet. Scan a Vault to populate your library, then assign media
          here.
        </p>
      )}

      {games.length > 0 && (
        <label className="media-game-picker">
          <span className="filter-label">Game</span>
          <select
            className="filter-select"
            value={selectedGame?.id ?? ""}
            onChange={(e) => {
              setSelectedGameId(e.target.value);
              cancelEdit();
            }}
            aria-label="Game"
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {primaryReleaseTitle(catalog, game)}
              </option>
            ))}
          </select>
        </label>
      )}

      {draft && target && (
        <form
          className="deck-editor media-editor"
          aria-label={`Edit media for ${target.title}`}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h3 className="media-editor-title">
            {target.kind === "game"
              ? `Game fallback — ${target.title}`
              : target.title}
          </h3>
          <div className="deck-editor-grid media-editor-grid">
            {MEDIA_SLOTS.map(({ slot, label }) => (
              <label className="deck-field" key={slot}>
                <span className="filter-label">{label}</span>
                <input
                  className="search-input"
                  value={draft[slot]}
                  placeholder={`e.g. ${selectedGame?.id ?? "game"}/${slot}.webp`}
                  onChange={(e) =>
                    setDraft({ ...draft, [slot]: e.target.value })
                  }
                  aria-label={label}
                />
              </label>
            ))}
          </div>
          <div className="deck-editor-actions">
            <button type="submit" className="launch-button" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save media"}
            </button>
            <button
              type="button"
              className="launch-button secondary"
              onClick={cancelEdit}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {selectedGame && (
        <ul className="media-list">
          <MediaRow
            label={`${primaryReleaseTitle(catalog, selectedGame)} (game fallback)`}
            media={selectedGame.media}
            editing={target?.kind === "game" && target.id === selectedGame.id}
            disabled={draft !== null}
            onEdit={() =>
              startEdit(
                {
                  kind: "game",
                  id: selectedGame.id,
                  title: primaryReleaseTitle(catalog, selectedGame),
                },
                selectedGame.media,
              )
            }
          />
          {releases.map((release) => {
            const resolved = resolveMedia(release.media, selectedGame.media);
            const preview = previewSource(resolved);
            return (
              <MediaRow
                key={release.id}
                label={release.title}
                meta={[release.region, release.platform, release.releaseType]
                  .filter(Boolean)
                  .join(" · ")}
                media={release.media}
                thumb={
                  preview
                    ? { src: mediaSrc(release.id, preview.slot) }
                    : undefined
                }
                editing={target?.kind === "release" && target.id === release.id}
                disabled={draft !== null}
                onEdit={() =>
                  startEdit(
                    { kind: "release", id: release.id, title: release.title },
                    release.media,
                  )
                }
              />
            );
          })}
        </ul>
      )}

      <p className="status" role="status" aria-live="polite">
        {saveStatus.kind === "error" && `Save failed: ${saveStatus.message}`}
      </p>
    </section>
  );
}

interface MediaRowProps {
  label: string;
  meta?: string;
  media?: Media;
  thumb?: { src: string };
  editing: boolean;
  disabled: boolean;
  onEdit: () => void;
}

/** One assignable target (a Release or a Game fallback) in the media list. */
function MediaRow({
  label,
  meta,
  media,
  thumb,
  editing,
  disabled,
  onEdit,
}: MediaRowProps) {
  const count = slotCount(media);
  return (
    <li className={`deck-row media-row${editing ? " is-editing" : ""}`}>
      <div className="media-row-info">
        {thumb ? (
          <img className="media-row-thumb" src={thumb.src} alt="" aria-hidden />
        ) : (
          <span className="media-row-thumb media-row-thumb-empty" aria-hidden />
        )}
        <span className="deck-row-info">
          <span className="deck-row-name">
            {label}
            {media && !isMediaEmpty(media) && (
              <span className="deck-badge">
                {count} slot{count === 1 ? "" : "s"}
              </span>
            )}
          </span>
          {meta && <span className="release-row-meta">{meta}</span>}
        </span>
      </div>
      <div className="deck-row-actions">
        <button
          type="button"
          className="deck-action"
          onClick={onEdit}
          disabled={disabled}
        >
          {editing ? "Editing…" : "Edit media"}
        </button>
      </div>
    </li>
  );
}

export default MediaView;
