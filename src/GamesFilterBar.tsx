import type { ReleaseType } from "./catalog";
import { ANY, type FilterState, type SortKey } from "./gamesFilter";

interface GamesFilterBarProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  /** Platform options derived from the catalog (only platforms actually present). */
  platforms: string[];
  /** Release-type options derived from the catalog, in canonical order. */
  releaseTypes: ReleaseType[];
  /** How many Game cards the current filter matches. */
  resultCount: number;
  /** How many Game cards exist in total (unfiltered). */
  totalCount: number;
}

/** Human-readable labels for each sort order. */
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "title-asc", label: "Title A–Z" },
  { value: "title-desc", label: "Title Z–A" },
  { value: "releases-desc", label: "Most releases" },
  { value: "last-played", label: "Recently played" },
  { value: "most-played", label: "Most played" },
];

/** Title-case a release type for display ("retail" → "Retail"). */
function releaseTypeLabel(type: ReleaseType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * The Games screen toolbar: a live search box plus platform, release-type, and
 * sort controls. Purely presentational — it holds no state, emitting a whole new
 * [`FilterState`] on every change so `GamesView` remains the single source of
 * truth (and can adapt the roving-focus item count to the filtered result).
 *
 * These controls sit outside the grid's roving focus on purpose: `useGridFocus`
 * only claims arrow keys while one of *its* registered items is focused, so
 * arrow keys inside the search box move the text cursor as usual.
 */
function GamesFilterBar({
  filter,
  onChange,
  platforms,
  releaseTypes,
  resultCount,
  totalCount,
}: GamesFilterBarProps) {
  return (
    <div className="games-toolbar">
      <input
        type="search"
        className="search-input"
        placeholder="Search games…"
        aria-label="Search games"
        value={filter.query}
        onChange={(event) => onChange({ ...filter, query: event.target.value })}
      />

      <label className="filter-group">
        <span className="filter-label">Platform</span>
        <select
          className="filter-select"
          value={filter.platform}
          onChange={(event) =>
            onChange({ ...filter, platform: event.target.value })
          }
        >
          <option value={ANY}>All platforms</option>
          {platforms.map((platform) => (
            <option key={platform} value={platform}>
              {platform}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-group">
        <span className="filter-label">Type</span>
        <select
          className="filter-select"
          value={filter.releaseType}
          onChange={(event) =>
            onChange({ ...filter, releaseType: event.target.value })
          }
        >
          <option value={ANY}>All types</option>
          {releaseTypes.map((type) => (
            <option key={type} value={type}>
              {releaseTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-group">
        <span className="filter-label">Sort</span>
        <select
          className="filter-select"
          value={filter.sort}
          onChange={(event) =>
            onChange({ ...filter, sort: event.target.value as SortKey })
          }
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={`favorites-toggle${filter.favoritesOnly ? " is-active" : ""}`}
        aria-pressed={filter.favoritesOnly}
        aria-label="Show favorites only"
        title="Show favorites only"
        onClick={() =>
          onChange({ ...filter, favoritesOnly: !filter.favoritesOnly })
        }
      >
        {filter.favoritesOnly ? "♥" : "♡"} Favorites
      </button>

      <span className="results-count" aria-live="polite">
        {resultCount === totalCount
          ? `${totalCount} game${totalCount === 1 ? "" : "s"}`
          : `${resultCount} of ${totalCount}`}
      </span>
    </div>
  );
}

export default GamesFilterBar;
