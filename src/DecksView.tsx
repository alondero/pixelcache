import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog, Deck, DeckKind } from "./catalog";
import type { LaunchResult } from "./launch";
import {
  DECK_KINDS,
  blankDeck,
  decksByPlatform,
  deckKind,
  formatArguments,
  isDefaultDeck,
  makeDefault,
  parseArguments,
  previewCommand,
  removeDeck,
  upsertDeck,
  validateDeck,
  validateDecks,
} from "./decks";

interface DecksViewProps {
  catalog: Catalog;
  /** Called with the catalog returned by `save_decks` so the whole app refreshes. */
  onCatalogChange: (catalog: Catalog) => void;
}

type SaveStatus =
  { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

type TestStatus =
  | { kind: "idle" }
  | { kind: "testing"; deckId: string }
  | { kind: "launched"; result: LaunchResult }
  | { kind: "error"; message: string };

/** The editable form state for one Deck (arguments held as raw text while typing). */
interface DeckDraft {
  /** The deck id being edited, so a renamed deck drops its old entry on save. */
  originalId: string | null;
  id: string;
  platform: string;
  executablePath: string;
  argsText: string;
  kind: DeckKind;
  isDefault: boolean;
}

function draftFor(deck: Deck, isNew: boolean): DeckDraft {
  return {
    originalId: isNew ? null : deck.id,
    id: deck.id,
    platform: deck.platform,
    executablePath: deck.executablePath,
    argsText: formatArguments(deck.arguments),
    kind: deckKind(deck),
    isDefault: isDefaultDeck(deck),
  };
}

function deckFrom(draft: DeckDraft): Deck {
  return {
    id: draft.id.trim(),
    platform: draft.platform.trim(),
    executablePath: draft.executablePath.trim(),
    arguments: parseArguments(draft.argsText),
    kind: draft.kind,
    default: draft.isDefault,
  };
}

/**
 * The "Settings" screen: configure the Decks (emulators / direct launchers) that
 * run each platform's Releases. Lists Decks grouped by platform and supports
 * add / edit / delete / make-default / test-launch, persisting the whole set via
 * the `save_decks` command (which returns the updated Catalog so the rest of the
 * app refreshes).
 *
 * Deck edits are applied straight through the backend rather than batched, so the
 * loaded Catalog stays the single source of truth (mirroring how `GamesView`
 * treats a rescan). The inline form's `DeckDraft` is the only local state.
 */
function DecksView({ catalog, onCatalogChange }: DecksViewProps) {
  const [draft, setDraft] = useState<DeckDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: "idle" });

  const groups = decksByPlatform(catalog.decks);
  const existingIds = catalog.decks.map((deck) => deck.id);

  function startAdd() {
    setFormError(null);
    setDraft(draftFor(blankDeck(existingIds), true));
  }

  function startEdit(deck: Deck) {
    setFormError(null);
    setDraft(draftFor(deck, false));
  }

  function cancelEdit() {
    setDraft(null);
    setFormError(null);
  }

  async function persist(decks: Deck[]) {
    setSaveStatus({ kind: "saving" });
    try {
      const updated = await invoke<Catalog>("save_decks", { decks });
      onCatalogChange(updated);
      setSaveStatus({ kind: "idle" });
      return true;
    } catch (error) {
      setSaveStatus({ kind: "error", message: String(error) });
      return false;
    }
  }

  async function applyDraft() {
    if (!draft) return;
    const deck = deckFrom(draft);

    const problem = validateDeck(deck);
    if (problem) {
      setFormError(problem);
      return;
    }

    // A renamed deck drops its old entry before the new one is inserted.
    const base =
      draft.originalId && draft.originalId !== deck.id
        ? removeDeck(catalog.decks, draft.originalId)
        : catalog.decks;
    const next = upsertDeck(base, deck);

    const setProblem = validateDecks(next);
    if (setProblem) {
      setFormError(setProblem);
      return;
    }

    if (await persist(next)) {
      setDraft(null);
      setFormError(null);
    }
  }

  async function deleteDeck(id: string) {
    await persist(removeDeck(catalog.decks, id));
    if (draft?.originalId === id) setDraft(null);
  }

  async function setDefault(id: string) {
    await persist(makeDefault(catalog.decks, id));
  }

  async function testDeck(deck: Deck) {
    setTestStatus({ kind: "testing", deckId: deck.id });
    try {
      const result = await invoke<LaunchResult>("test_launch_deck", { deck });
      setTestStatus({ kind: "launched", result });
    } catch (error) {
      setTestStatus({ kind: "error", message: String(error) });
    }
  }

  const isSaving = saveStatus.kind === "saving";

  return (
    <section className="decks-view" aria-label="Deck settings">
      <div className="decks-intro">
        <p className="decks-lead">
          Decks tell Pixelcache how to run each platform&rsquo;s games — an
          emulator command, or a direct launch of the file itself. Use{" "}
          <code>{"{rom}"}</code> in the arguments to place the game path, or
          leave it out to append the path last.
        </p>
        <button
          type="button"
          className="launch-button secondary decks-add"
          onClick={startAdd}
          disabled={draft !== null}
        >
          + Add deck
        </button>
      </div>

      {draft && (
        <form
          className="deck-editor"
          aria-label={draft.originalId ? "Edit deck" : "Add deck"}
          onSubmit={(event) => {
            event.preventDefault();
            void applyDraft();
          }}
        >
          <div className="deck-editor-grid">
            <label className="deck-field">
              <span className="filter-label">Deck id</span>
              <input
                className="search-input"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                aria-label="Deck id"
              />
            </label>

            <label className="deck-field">
              <span className="filter-label">Platform</span>
              <input
                className="search-input"
                value={draft.platform}
                placeholder="e.g. snes"
                onChange={(e) =>
                  setDraft({ ...draft, platform: e.target.value })
                }
                aria-label="Platform"
              />
            </label>

            <label className="deck-field">
              <span className="filter-label">Kind</span>
              <select
                className="filter-select"
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as DeckKind })
                }
                aria-label="Kind"
              >
                {DECK_KINDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {draft.kind === "emulator" && (
              <label className="deck-field">
                <span className="filter-label">Executable</span>
                <input
                  className="search-input"
                  value={draft.executablePath}
                  placeholder="e.g. retroarch"
                  onChange={(e) =>
                    setDraft({ ...draft, executablePath: e.target.value })
                  }
                  aria-label="Executable"
                />
              </label>
            )}

            <label className="deck-field deck-field-wide">
              <span className="filter-label">Arguments</span>
              <input
                className="search-input"
                value={draft.argsText}
                placeholder={'e.g. -L core.so "{rom}"'}
                onChange={(e) =>
                  setDraft({ ...draft, argsText: e.target.value })
                }
                aria-label="Arguments"
              />
            </label>

            <label className="deck-field deck-field-check">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) =>
                  setDraft({ ...draft, isDefault: e.target.checked })
                }
              />
              <span>Default for this platform</span>
            </label>
          </div>

          <p className="deck-preview" aria-label="Command preview">
            <span className="deck-preview-label">Runs:</span>{" "}
            <code>{previewCommand(deckFrom(draft))}</code>
          </p>

          {formError && (
            <p className="status deck-form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="deck-editor-actions">
            <button
              type="submit"
              className="launch-button decks-apply"
              disabled={isSaving}
            >
              {isSaving
                ? "Saving…"
                : draft.originalId
                  ? "Save deck"
                  : "Add deck"}
            </button>
            <button
              type="button"
              className="launch-button secondary"
              onClick={() => void testDeck(deckFrom(draft))}
              disabled={draft.kind === "directLaunch"}
              title={
                draft.kind === "directLaunch"
                  ? "Direct-launch decks have no emulator to test"
                  : "Launch the emulator to check it works"
              }
            >
              Test launch
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

      {catalog.decks.length === 0 && !draft && (
        <p className="status" role="status">
          No decks configured yet. Scan a Vault to seed a default deck per
          platform, or add one above.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.platform} className="deck-group">
          <h3 className="deck-group-title">{group.platform}</h3>
          <ul className="deck-list">
            {group.decks.map((deck) => (
              <li key={deck.id} className="deck-row">
                <div className="deck-row-info">
                  <span className="deck-row-name">
                    {deck.id}
                    {isDefaultDeck(deck) && (
                      <span className="deck-badge">default</span>
                    )}
                    {deckKind(deck) === "directLaunch" && (
                      <span className="deck-badge deck-badge-alt">direct</span>
                    )}
                  </span>
                  <code className="deck-row-cmd">{previewCommand(deck)}</code>
                </div>
                <div className="deck-row-actions">
                  {!isDefaultDeck(deck) && (
                    <button
                      type="button"
                      className="deck-action"
                      onClick={() => void setDefault(deck.id)}
                      disabled={isSaving}
                    >
                      Make default
                    </button>
                  )}
                  {deckKind(deck) === "emulator" && (
                    <button
                      type="button"
                      className="deck-action"
                      onClick={() => void testDeck(deck)}
                      disabled={testStatus.kind === "testing"}
                    >
                      {testStatus.kind === "testing" &&
                      testStatus.deckId === deck.id
                        ? "Testing…"
                        : "Test"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="deck-action"
                    onClick={() => void startEdit(deck)}
                    disabled={draft !== null}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="deck-action deck-action-danger"
                    onClick={() => void deleteDeck(deck.id)}
                    disabled={isSaving}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="status" role="status" aria-live="polite">
        {saveStatus.kind === "error" && `Save failed: ${saveStatus.message}`}
        {testStatus.kind === "launched" &&
          `Test launched ${testStatus.result.program} (pid ${testStatus.result.pid})`}
        {testStatus.kind === "error" && `Test failed: ${testStatus.message}`}
      </p>
    </section>
  );
}

export default DecksView;
