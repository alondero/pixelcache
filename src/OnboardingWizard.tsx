import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ArtworkScraper from "./ArtworkScraper";
import type { Catalog, Deck } from "./catalog";
import type { LaunchResult } from "./launch";
import {
  PLATFORM_OPTIONS,
  WIZARD_STEPS,
  buildVaults,
  draftsReady,
  emptyVaultDraft,
  platformLabel,
  scanSummary,
  stepIndex,
  type VaultDraft,
  type WizardStep,
} from "./onboarding";

interface OnboardingWizardProps {
  catalog: Catalog;
  /** Called with each freshly persisted Catalog (scan, deck save, artwork). */
  onCatalogChange: (catalog: Catalog) => void;
  /** The wizard completed; `App` returns to the library. */
  onFinish: () => void;
  /** The player chose to explore on their own instead. */
  onSkip: () => void;
}

type ScanState =
  { kind: "idle" } | { kind: "scanning" } | { kind: "error"; message: string };

type TestState =
  | { kind: "idle" }
  | { kind: "testing"; deckId: string }
  | { kind: "launched"; deckId: string; result: LaunchResult }
  | { kind: "error"; deckId: string; message: string };

/**
 * The first-run setup journey, replacing the old bundled demo catalog: pick the
 * folders where games (and optionally box art) live, scan them into the
 * Catalog, confirm the auto-seeded Decks actually launch, and optionally fetch
 * missing artwork — each step persisting through the same commands the
 * settings screens use, so finishing the wizard *is* a configured app.
 *
 * Mouse/keyboard driven like the Decks settings screen (a form, not a grid),
 * so it deliberately runs no gamepad focus loop — `App` mounts it *instead of*
 * the tabbed views, so no other focus loop is polling either.
 */
function OnboardingWizard({
  catalog,
  onCatalogChange,
  onFinish,
  onSkip,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>("welcome");
  const [drafts, setDrafts] = useState<VaultDraft[]>([emptyVaultDraft()]);
  const [scan, setScan] = useState<ScanState>({ kind: "idle" });
  // The decks step edits executables keyed by deck id, seeded lazily from the
  // scanned catalog so a re-visit keeps the player's corrections.
  const [executables, setExecutables] = useState<Record<string, string>>({});
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [savingDecks, setSavingDecks] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);

  function updateDraft(index: number, patch: Partial<VaultDraft>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  async function pickFolder(index: number, field: "path" | "mediaPath") {
    const picked = await open({
      directory: true,
      title:
        field === "path"
          ? "Choose the folder where the games live"
          : "Choose the folder where the box art lives",
    });
    if (typeof picked === "string" && picked) {
      updateDraft(index, { [field]: picked });
    }
  }

  async function runScan() {
    setScan({ kind: "scanning" });
    try {
      const scanned = await invoke<Catalog>("scan_vault", {
        vaults: buildVaults(drafts),
      });
      onCatalogChange(scanned);
      setExecutables(
        Object.fromEntries(
          scanned.decks.map((deck) => [deck.id, deck.executablePath]),
        ),
      );
      setScan({ kind: "idle" });
      setStep("decks");
    } catch (error) {
      setScan({ kind: "error", message: String(error) });
    }
  }

  /** The decks with the wizard's executable edits applied. */
  function editedDecks(): Deck[] {
    return catalog.decks.map((deck) => ({
      ...deck,
      executablePath: (executables[deck.id] ?? deck.executablePath).trim(),
    }));
  }

  async function testDeck(deck: Deck) {
    setTest({ kind: "testing", deckId: deck.id });
    try {
      const result = await invoke<LaunchResult>("test_launch_deck", { deck });
      setTest({ kind: "launched", deckId: deck.id, result });
    } catch (error) {
      setTest({ kind: "error", deckId: deck.id, message: String(error) });
    }
  }

  async function saveDecksAndContinue() {
    setSavingDecks(true);
    setDeckError(null);
    try {
      const updated = await invoke<Catalog>("save_decks", {
        decks: editedDecks(),
      });
      onCatalogChange(updated);
      setStep("artwork");
    } catch (error) {
      setDeckError(String(error));
    } finally {
      setSavingDecks(false);
    }
  }

  const scanning = scan.kind === "scanning";

  return (
    <section className="onboarding" aria-label="First-run setup">
      <ol className="onboarding-rail" aria-label="Setup progress">
        {WIZARD_STEPS.map((s) => {
          const state =
            stepIndex(s.id) < stepIndex(step)
              ? "done"
              : s.id === step
                ? "current"
                : "todo";
          return (
            <li
              key={s.id}
              className={`onboarding-rail-step is-${state}`}
              aria-current={s.id === step ? "step" : undefined}
            >
              {s.label}
            </li>
          );
        })}
      </ol>

      <div className="onboarding-step" key={step}>
        {step === "welcome" && (
          <>
            <h2 className="onboarding-title">Welcome to Pixelcache</h2>
            <p className="onboarding-lead">
              Your games, your emulators, one place. Point Pixelcache at the
              folders where your games live and it builds the library for you —
              covers, playlists, and controller-friendly browsing included.
            </p>
            <ul className="onboarding-perks">
              <li>
                <strong>Scan, don&rsquo;t type.</strong> Regional releases,
                revisions, and hacks are grouped under one card automatically.
              </li>
              <li>
                <strong>Bring your art, or fetch it.</strong> Use a box-art
                folder you already have, or pull covers from the libretro
                library in one click.
              </li>
              <li>
                <strong>Launch for real.</strong> Each platform gets an emulator
                Deck you can test before you ever leave setup.
              </li>
            </ul>
            <div className="onboarding-actions">
              <button
                type="button"
                className="launch-button"
                onClick={() => setStep("vaults")}
              >
                Set up my library
              </button>
              <button
                type="button"
                className="launch-button secondary"
                onClick={onSkip}
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {step === "vaults" && (
          <>
            <h2 className="onboarding-title">Where do your games live?</h2>
            <p className="onboarding-lead">
              Each platform&rsquo;s games sit in their own folder — a{" "}
              <em>Vault</em>. Pick the folder, and optionally a second folder of
              box art named after the games; matching covers are picked up
              automatically.
            </p>

            {drafts.map((draft, index) => (
              <fieldset key={index} className="onboarding-vault">
                <div className="deck-editor-grid">
                  <label className="deck-field">
                    <span className="filter-label">Platform</span>
                    <select
                      className="filter-select"
                      value={draft.platform}
                      aria-label="Platform"
                      onChange={(e) =>
                        updateDraft(index, { platform: e.target.value })
                      }
                    >
                      <option value="">Choose a platform…</option>
                      {PLATFORM_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="deck-field deck-field-wide">
                    <span className="filter-label">Games folder</span>
                    <span className="onboarding-folder">
                      <input
                        className="search-input"
                        value={draft.path}
                        placeholder="e.g. D:\Games\SNES"
                        aria-label="Games folder"
                        onChange={(e) =>
                          updateDraft(index, { path: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="launch-button secondary onboarding-browse"
                        onClick={() => void pickFolder(index, "path")}
                      >
                        Choose games folder…
                      </button>
                    </span>
                  </label>

                  <label className="deck-field deck-field-wide">
                    <span className="filter-label">
                      Box art folder <em>(optional)</em>
                    </span>
                    <span className="onboarding-folder">
                      <input
                        className="search-input"
                        value={draft.mediaPath}
                        placeholder="A folder of covers named after the games"
                        aria-label="Box art folder"
                        onChange={(e) =>
                          updateDraft(index, { mediaPath: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="launch-button secondary onboarding-browse"
                        onClick={() => void pickFolder(index, "mediaPath")}
                      >
                        Choose art folder…
                      </button>
                    </span>
                  </label>
                </div>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    className="deck-action deck-action-danger onboarding-remove"
                    onClick={() =>
                      setDrafts((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </fieldset>
            ))}

            <button
              type="button"
              className="launch-button secondary"
              onClick={() =>
                setDrafts((current) => [...current, emptyVaultDraft()])
              }
            >
              + Add another platform
            </button>

            {scan.kind === "error" && (
              <p className="status deck-form-error" role="alert">
                Scan failed: {scan.message}
              </p>
            )}

            <div className="onboarding-actions">
              <button
                type="button"
                className="launch-button"
                onClick={() => void runScan()}
                disabled={!draftsReady(drafts) || scanning}
              >
                {scanning ? "Scanning…" : "Scan for games"}
              </button>
              <button
                type="button"
                className="launch-button secondary"
                onClick={() => setStep("welcome")}
                disabled={scanning}
              >
                Back
              </button>
            </div>
          </>
        )}

        {step === "decks" && (
          <>
            <h2 className="onboarding-title">{scanSummary(catalog)}</h2>
            <p className="onboarding-lead">
              Each platform launches through a <em>Deck</em> — an emulator
              command. Pixelcache suggested one per platform; check it points at
              an emulator you actually have, and give it a test launch.
            </p>

            <ul className="deck-list onboarding-decks">
              {catalog.decks.map((deck) => (
                <li key={deck.id} className="deck-row">
                  <div className="deck-row-info">
                    <span className="deck-row-name">
                      {platformLabel(deck.platform)}
                    </span>
                    <label className="deck-field deck-field-wide">
                      <span className="filter-label">Emulator command</span>
                      <input
                        className="search-input"
                        aria-label="Emulator command"
                        value={executables[deck.id] ?? deck.executablePath}
                        placeholder="e.g. retroarch, or a full path"
                        onChange={(e) =>
                          setExecutables((current) => ({
                            ...current,
                            [deck.id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    {test.kind === "launched" && test.deckId === deck.id && (
                      <p className="status" role="status">
                        Launched {test.result.program} (pid {test.result.pid}) —
                        looking good!
                      </p>
                    )}
                    {test.kind === "error" && test.deckId === deck.id && (
                      <p className="status deck-form-error" role="alert">
                        Test failed: {test.message}
                      </p>
                    )}
                  </div>
                  <div className="deck-row-actions">
                    <button
                      type="button"
                      className="deck-action"
                      onClick={() =>
                        void testDeck(
                          editedDecks().find((d) => d.id === deck.id) ?? deck,
                        )
                      }
                      disabled={test.kind === "testing"}
                    >
                      {test.kind === "testing" && test.deckId === deck.id
                        ? "Testing…"
                        : "Test launch"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {deckError && (
              <p className="status deck-form-error" role="alert">
                Save failed: {deckError}
              </p>
            )}

            <div className="onboarding-actions">
              <button
                type="button"
                className="launch-button"
                onClick={() => void saveDecksAndContinue()}
                disabled={savingDecks}
              >
                {savingDecks ? "Saving…" : "Save & continue"}
              </button>
              <button
                type="button"
                className="launch-button secondary"
                onClick={() => setStep("vaults")}
                disabled={savingDecks}
              >
                Back
              </button>
            </div>
          </>
        )}

        {step === "artwork" && (
          <>
            <h2 className="onboarding-title">Add some artwork</h2>
            <p className="onboarding-lead">
              Covers make the library feel like a shelf, not a spreadsheet. Any
              art folder you chose is already matched up — for whatever is still
              missing, fetch covers from the libretro thumbnails library (needs
              an internet connection). You can always do this later from the
              Media tab.
            </p>
            <ArtworkScraper
              catalog={catalog}
              onCatalogChange={onCatalogChange}
            />
            <div className="onboarding-actions">
              <button
                type="button"
                className="launch-button"
                onClick={() => setStep("done")}
              >
                Continue
              </button>
              <button
                type="button"
                className="launch-button secondary"
                onClick={() => setStep("decks")}
              >
                Back
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2 className="onboarding-title">You&rsquo;re all set ✦</h2>
            <p className="onboarding-lead">
              {scanSummary(catalog)}. Browse with mouse, keyboard, or a
              controller — favorites, playlists, and rescanning all live in the
              tabs above the library. Have fun!
            </p>
            <div className="onboarding-actions">
              <button
                type="button"
                className="launch-button"
                onClick={onFinish}
              >
                Start browsing
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default OnboardingWizard;
