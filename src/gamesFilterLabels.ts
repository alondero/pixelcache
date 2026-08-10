import type { ReleaseType } from "./catalog";
import type { SortKey } from "./gamesFilter";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "title-asc", label: "Title A–Z" },
  { value: "title-desc", label: "Title Z–A" },
  { value: "releases-desc", label: "Most releases" },
  { value: "last-played", label: "Recently played" },
  { value: "most-played", label: "Most played" },
];

export function releaseTypeLabel(type: ReleaseType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
