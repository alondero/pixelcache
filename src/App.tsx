import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog";
import GamesView from "./GamesView";
import PlaylistsView from "./PlaylistsView";
import "./App.css";

type CatalogStatus =
  | { kind: "loading" }
  | { kind: "loaded"; catalog: Catalog }
  | { kind: "error"; message: string };

/** The top-level screens the user can switch between. */
type Tab = "games" | "playlists";

const TABS: { id: Tab; label: string }[] = [
  { id: "games", label: "Games" },
  { id: "playlists", label: "Playlists" },
];

function App() {
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({
    kind: "loading",
  });
  const [activeTab, setActiveTab] = useState<Tab>("games");

  useEffect(() => {
    let cancelled = false;
    invoke<Catalog>("load_catalog")
      .then((catalog) => {
        if (!cancelled) setCatalogStatus({ kind: "loaded", catalog });
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

        <nav className="view-tabs" role="tablist" aria-label="Views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`view-tab${activeTab === tab.id ? " is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {catalog && activeTab === "games" && <GamesView catalog={catalog} />}
        {catalog && activeTab === "playlists" && (
          <PlaylistsView catalog={catalog} />
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
