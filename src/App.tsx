import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

/** Shape returned by the Rust `launch_test_game` command on success. */
interface LaunchResult {
  program: string;
  pid: number;
}

type Status =
  | { kind: "idle" }
  | { kind: "launching" }
  | { kind: "launched"; result: LaunchResult }
  | { kind: "error"; message: string };

function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function launchTestGame() {
    setStatus({ kind: "launching" });
    try {
      const result = await invoke<LaunchResult>("launch_test_game");
      setStatus({ kind: "launched", result });
    } catch (error) {
      setStatus({ kind: "error", message: String(error) });
    }
  }

  return (
    <main className="app">
      <div className="glass-card">
        <h1 className="title">Pixelcache</h1>
        <p className="subtitle">Lightweight cross-platform game launcher</p>

        <button
          type="button"
          className="launch-button"
          onClick={launchTestGame}
          disabled={status.kind === "launching"}
        >
          {status.kind === "launching" ? "Launching…" : "Launch Test Game"}
        </button>

        <p className="status" role="status" aria-live="polite">
          {status.kind === "launched" &&
            `Launched ${status.result.program} (pid ${status.result.pid})`}
          {status.kind === "error" && `Launch failed: ${status.message}`}
        </p>
      </div>
    </main>
  );
}

export default App;
