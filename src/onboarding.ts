/**
 * Pure logic for the first-run onboarding wizard.
 *
 * Kept free of React and Tauri (like `gamesFilter.ts` / `decks.ts`) so the
 * first-run rule, the vault-draft validation, and the step machine are
 * unit-testable in isolation; `OnboardingWizard.tsx` is the thin layer that
 * renders and invokes commands.
 */
import type { Catalog, Vault } from "./catalog";

/**
 * Whether this catalog is a fresh install: nothing scanned, nothing configured.
 * The backend returns an *empty* catalog when no `catalog.json` exists yet (the
 * bundled demo catalog is gone), so emptiness is the first-run signal `App`
 * keys the wizard off. A configured Vault counts as "set up" even before any
 * games are found, so a user with an empty ROM folder isn't trapped in setup.
 */
export function isFirstRun(catalog: Catalog): boolean {
  return (
    catalog.games.length === 0 &&
    catalog.releases.length === 0 &&
    (catalog.vaults ?? []).length === 0
  );
}

/** A platform the wizard offers, with the human name shown in the picker. */
export interface PlatformOption {
  id: string;
  label: string;
}

/**
 * The platforms the Import Scanner knows extensions for (mirrors
 * `default_extensions_for_platform` in `src-tauri/src/scanner.rs`), with
 * display names. Ordered roughly by era/popularity so common picks are near
 * the top of the select.
 */
export const PLATFORM_OPTIONS: PlatformOption[] = [
  { id: "snes", label: "Super Nintendo (SNES)" },
  { id: "nes", label: "NES / Famicom" },
  { id: "n64", label: "Nintendo 64" },
  { id: "gamecube", label: "Nintendo GameCube" },
  { id: "wii", label: "Nintendo Wii" },
  { id: "gb", label: "Game Boy" },
  { id: "gbc", label: "Game Boy Color" },
  { id: "gba", label: "Game Boy Advance" },
  { id: "ps1", label: "PlayStation" },
  { id: "ps2", label: "PlayStation 2" },
  { id: "psp", label: "PlayStation Portable" },
  { id: "genesis", label: "Sega Genesis / Mega Drive" },
  { id: "sms", label: "Sega Master System" },
  { id: "gamegear", label: "Sega Game Gear" },
  { id: "segacd", label: "Sega CD" },
  { id: "saturn", label: "Sega Saturn" },
  { id: "dreamcast", label: "Sega Dreamcast" },
  { id: "pcengine", label: "PC Engine / TurboGrafx-16" },
  { id: "pcenginecd", label: "PC Engine CD" },
  { id: "atari2600", label: "Atari 2600" },
  { id: "wonderswan", label: "WonderSwan" },
  { id: "neogeopocket", label: "Neo Geo Pocket" },
  { id: "3do", label: "3DO" },
];

/** The display name for a platform id, falling back to the raw id. */
export function platformLabel(id: string): string {
  return PLATFORM_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

/**
 * The editable form state for one Vault being added in the wizard. `mediaPath`
 * is the optional companion art folder; empty string means "not set".
 */
export interface VaultDraft {
  platform: string;
  path: string;
  mediaPath: string;
}

/** A blank draft for the "add a platform" row. */
export function emptyVaultDraft(): VaultDraft {
  return { platform: "", path: "", mediaPath: "" };
}

/** The first problem with a draft, or `null` when it is scannable. */
export function draftProblem(draft: VaultDraft): string | null {
  if (!draft.platform.trim()) return "Choose a platform.";
  if (!draft.path.trim()) return "Choose the folder where the games live.";
  return null;
}

/** Whether the whole set of drafts is ready to scan. */
export function draftsReady(drafts: VaultDraft[]): boolean {
  return drafts.length > 0 && drafts.every((d) => draftProblem(d) === null);
}

/**
 * A stable Vault id for a platform (`snes-vault`), suffixed to stay unique
 * when the same platform is added twice (`snes-vault-2`, …).
 */
export function vaultIdFor(platform: string, taken: string[]): string {
  const base = `${platform}-vault`;
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Turn the wizard's drafts into the Vaults passed to `scan_vault`. Paths are
 * trimmed; `mediaPath` is included only when set so the serialized Vault
 * matches the Rust side's absent-not-empty convention.
 */
export function buildVaults(drafts: VaultDraft[]): Vault[] {
  const taken: string[] = [];
  return drafts.map((draft) => {
    const platform = draft.platform.trim();
    const id = vaultIdFor(platform, taken);
    taken.push(id);
    const vault: Vault = { id, platform, path: draft.path.trim() };
    const mediaPath = draft.mediaPath.trim();
    if (mediaPath) vault.mediaPath = mediaPath;
    return vault;
  });
}

/** The wizard's screens, in order, with the labels shown on the progress rail. */
export const WIZARD_STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "vaults", label: "Your games" },
  { id: "decks", label: "Emulators" },
  { id: "artwork", label: "Artwork" },
  { id: "done", label: "Ready" },
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number]["id"];

/** Position of a step on the progress rail. */
export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.id === step);
}

/** A plain-English result line for the scan the wizard just ran. */
export function scanSummary(catalog: Catalog): string {
  const games = catalog.games.length;
  if (games === 0) return "No games found in those folders yet";
  const platforms = new Set(catalog.releases.map((r) => r.platform)).size;
  const gamesPart = games === 1 ? "1 game" : `${games} games`;
  const platformsPart =
    platforms === 1 ? "on 1 platform" : `across ${platforms} platforms`;
  return `Found ${gamesPart} ${platformsPart}`;
}
