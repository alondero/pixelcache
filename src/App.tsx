import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog";
import GamesView from "./GamesView";
import PlaylistsView from "./PlaylistsView";
import DecksView from "./DecksView";
import MediaView from "./MediaView";
import OnboardingWizard from "./OnboardingWizard";
import { isFirstRun } from "./onboarding";
import { useTabListKeys } from "./useTabListKeys";
import "./App.css";

type CatalogStatus =
  | { kind: "loading" }
  | { kind: "loaded"; catalog: Catalog }
  | { kind: "error"; message: string };

/** The top-level screens the user can switch between. */
type Tab = "games" | "playlists" | "media" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "games", label: "Games" },
  { id: "playlists", label: "Playlists" },
  { id: "media", label: "Media" },
  { id: "settings", label: "Settings" },
];

function App() {
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({
    kind: "loading",
  });
  const [activeTab, setActiveTab] = useState<Tab>("games");
  // Whether the first-run setup wizard is showing. Decided once when the
  // catalog loads (an empty catalog means a fresh install — see `isFirstRun`)
  // and then held as state, so the wizard doesn't unmount mid-flow the moment
  // a scan makes the catalog non-empty. Re-openable from the empty library.
  const [onboarding, setOnboarding] = useState(false);

  // The top-level view switcher is a WAI-ARIA tablist: arrow keys rove between
  // the tabs with selection following focus.
  const selectedTabIndex = TABS.findIndex((tab) => tab.id === activeTab);
  const { registerTabRef, onKeyDown } = useTabListKeys(
    TABS.length,
    selectedTabIndex,
    (index) => setActiveTab(TABS[index].id),
  );

  useEffect(() => {
    let cancelled = false;
    invoke<Catalog>("load_catalog")
      .then((catalog) => {
        if (cancelled) return;
        setCatalogStatus({ kind: "loaded", catalog });
        setOnboarding(isFirstRun(catalog));
      })
      .catch((error) => {
        if (!cancelled)
          setCatalogStatus({ kind: "error", message: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalog =
    catalogStatus.kind === "loaded" ? catalogStatus.catalog : null;

  return (
    <main className="app">
      <div className="glass-card">
        <h1 className="title">Pixelcache</h1>
        <p className="subtitle">Lightweight cross-platform game launcher</p>

        {catalog && onboarding && (
          <OnboardingWizard
            catalog={catalog}
            onCatalogChange={(next) =>
              setCatalogStatus({ kind: "loaded", catalog: next })
            }
            onFinish={() => setOnboarding(false)}
            onSkip={() => setOnboarding(false)}
          />
        )}

        {!onboarding && (
          <nav
            className="view-tabs"
            role="tablist"
            aria-label="Views"
            onKeyDown={onKeyDown}
          >
            {TABS.map((tab, index) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`view-tab-${tab.id}`}
                  aria-controls={`view-panel-${tab.id}`}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  ref={registerTabRef(index)}
                  className={`view-tab${isActive ? " is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        )}

        {catalog && !onboarding && (
          <div
            role="tabpanel"
            id={`view-panel-${activeTab}`}
            aria-labelledby={`view-tab-${activeTab}`}
          >
            {activeTab === "games" && (
              <GamesView
                catalog={catalog}
                onCatalogChange={(next) =>
                  setCatalogStatus({ kind: "loaded", catalog: next })
                }
                onOpenSetup={() => setOnboarding(true)}
              />
            )}
            {activeTab === "playlists" && <PlaylistsView catalog={catalog} />}
            {activeTab === "media" && (
              <MediaView
                catalog={catalog}
                onCatalogChange={(next) =>
                  setCatalogStatus({ kind: "loaded", catalog: next })
                }
              />
            )}
            {activeTab === "settings" && (
              <DecksView
                catalog={catalog}
                onCatalogChange={(next) =>
                  setCatalogStatus({ kind: "loaded", catalog: next })
                }
              />
            )}
          </div>
        )}
        {catalogStatus.kind === "error" && (
          <p className="status" role="alert">
            Failed to load catalog: {catalogStatus.message}
          </p>
        )}
      </div>
    </main>
  );
}

export default App;
