import type { ReleaseType } from "./catalog";
import { releaseTypeLabel, SORT_OPTIONS } from "./gamesFilterLabels";
import { ANY, type FilterState, type SortKey } from "./gamesFilter";
import { useGridFocus } from "./useGridFocus";

interface FilterDrawerProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  platforms: string[];
  releaseTypes: ReleaseType[];
  onClose: () => void;
}

/** Controller-operated filter surface. Search stays a normal text input. */
function FilterDrawer({
  filter,
  onChange,
  platforms,
  releaseTypes,
  onClose,
}: FilterDrawerProps) {
  const options = [
    {
      label:
        filter.platform === ANY
          ? "All platforms"
          : `Platform: ${filter.platform}`,
      description: "Choose the platform to show",
      onSelect: () => onChange({ ...filter, platform: ANY }),
    },
    ...platforms.map((platform) => ({
      label: platform,
      description: "Platform filter",
      onSelect: () => onChange({ ...filter, platform }),
    })),
    {
      label:
        filter.releaseType === ANY
          ? "All release types"
          : `Type: ${releaseTypeLabel(filter.releaseType as ReleaseType)}`,
      description: "Choose the kind of Release to show",
      onSelect: () => onChange({ ...filter, releaseType: ANY }),
    },
    ...releaseTypes.map((releaseType) => ({
      label: releaseTypeLabel(releaseType),
      description: "Release type filter",
      onSelect: () => onChange({ ...filter, releaseType }),
    })),
    ...SORT_OPTIONS.map((sort) => ({
      label: `Sort: ${sort.label}`,
      description: "Change the library order",
      onSelect: () => onChange({ ...filter, sort: sort.value as SortKey }),
    })),
    {
      label: filter.favoritesOnly ? "Show all games" : "Favorites only",
      description: "Toggle the favorites filter",
      onSelect: () =>
        onChange({ ...filter, favoritesOnly: !filter.favoritesOnly }),
    },
    {
      label: "Close filter menu",
      description: "Return to the library",
      onSelect: onClose,
    },
  ];

  const { containerRef, focusedIndex, registerItemRef, focusItem } =
    useGridFocus({
      itemCount: options.length,
      itemWidth: 10_000,
      onBack: onClose,
    });

  return (
    <div className="filter-drawer-backdrop" role="presentation">
      <section
        className="filter-drawer"
        role="dialog"
        aria-label="Controller filters"
        ref={containerRef as React.RefObject<HTMLElement>}
      >
        <p className="quick-menu-kicker">Library</p>
        <h2 className="quick-menu-title">Filters</h2>
        <p className="filter-drawer-query">
          Search remains available from the keyboard search box.
        </p>
        <div className="filter-drawer-list">
          {options.map((option, index) => (
            <button
              key={`${option.label}-${index}`}
              type="button"
              className={`quick-menu-item${focusedIndex === index ? " is-focused" : ""}`}
              ref={registerItemRef(index)}
              tabIndex={focusedIndex === index ? 0 : -1}
              onFocus={() => focusItem(index)}
              onClick={option.onSelect}
            >
              <span className="quick-menu-item-label">{option.label}</span>
              <span className="quick-menu-item-description">
                {option.description}
              </span>
            </button>
          ))}
        </div>
        <p className="quick-menu-hint">A Choose · B Back</p>
      </section>
    </div>
  );
}

export default FilterDrawer;
