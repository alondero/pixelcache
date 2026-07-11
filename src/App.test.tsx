import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// The Tauri IPC bridge is unavailable in jsdom, so we mock `invoke` and assert
// that the UI wires the button to the correct Rust command and reacts to its
// success/failure — without needing a running Tauri backend.
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("App", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the Launch Test Game button", () => {
    render(<App />);
    expect(
      screen.getByRole("button", { name: /launch test game/i }),
    ).toBeInTheDocument();
  });

  it("invokes the launch_test_game command when clicked", async () => {
    invoke.mockResolvedValue({ program: "notepad.exe", pid: 4242 });
    render(<App />);

    await userEvent.click(
      screen.getByRole("button", { name: /launch test game/i }),
    );

    expect(invoke).toHaveBeenCalledWith("launch_test_game");
  });

  it("shows the launched process details on success", async () => {
    invoke.mockResolvedValue({ program: "notepad.exe", pid: 4242 });
    render(<App />);

    await userEvent.click(
      screen.getByRole("button", { name: /launch test game/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /launched notepad\.exe \(pid 4242\)/i,
    );
  });

  it("surfaces an error message when the launch fails", async () => {
    invoke.mockRejectedValue("emulator not found");
    render(<App />);

    await userEvent.click(
      screen.getByRole("button", { name: /launch test game/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /launch failed: emulator not found/i,
    );
  });
});
