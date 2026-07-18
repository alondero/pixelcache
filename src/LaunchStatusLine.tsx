import type { ReactNode } from "react";
import type { LaunchStatus } from "./launch";

interface LaunchStatusLineProps {
  /** The launch state to narrate (only `launched`/`error` produce text). */
  status: LaunchStatus;
  /**
   * Extra status text to render in the same live region — `GamesView` appends
   * its Vault-scan result here so launch and scan share one `role="status"`
   * paragraph (a single polite live region avoids two competing announcements).
   */
  children?: ReactNode;
}

/**
 * The shared launched/error status line rendered beneath every view that can
 * spawn a process (`GamesView`, `PlaylistsView`). A polite `aria-live` region
 * so a controller user hears the outcome without the launch stealing focus.
 */
function LaunchStatusLine({ status, children }: LaunchStatusLineProps) {
  return (
    <p className="status" role="status" aria-live="polite">
      {status.kind === "launched" &&
        `Launched ${status.result.program} (pid ${status.result.pid})`}
      {status.kind === "error" && `Launch failed: ${status.message}`}
      {children}
    </p>
  );
}

export default LaunchStatusLine;
