import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

async function bootstrap() {
  // In a plain browser (`npm run dev`) there is no Rust bridge, so `invoke`
  // would reject and the UI would show only error states. Install the browser
  // mocks first; the guard keeps them out of production builds and the real
  // desktop WebView (which defines __TAURI_INTERNALS__).
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installBrowserMocks } = await import("./dev/mockTauri");
    installBrowserMocks();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
