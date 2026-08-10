import { useControllerActions, useController } from "./ControllerProvider";
import { useGridFocus } from "./useGridFocus";

interface QuickMenuProps {
  onClose: () => void;
  onOpenSetup: () => void;
  onOpenSettings: () => void;
}

/** The small Start-menu overlay used for player-facing actions. */
function QuickMenu({ onClose, onOpenSetup, onOpenSettings }: QuickMenuProps) {
  const { playMode, fullscreen, setPlayMode, toggleFullscreen } =
    useController();
  const options = [
    {
      label: playMode ? "Exit Play Mode" : "Enter Play Mode",
      description: "Use the larger ten-foot library layout",
      onSelect: () => setPlayMode(!playMode),
    },
    {
      label: fullscreen ? "Exit Fullscreen" : "Enter Fullscreen",
      description: "Toggle the display-sized launcher view",
      onSelect: () => void toggleFullscreen(),
    },
    {
      label: "Manage Decks",
      description: "Configure emulators and launch arguments",
      onSelect: onOpenSettings,
    },
    {
      label: "Library Setup",
      description: "Add or rescan platform Vaults",
      onSelect: onOpenSetup,
    },
    {
      label: "Close Menu",
      description: "Return to the current focus",
      onSelect: onClose,
    },
  ];

  const { containerRef, focusedIndex, registerItemRef, focusItem } =
    useGridFocus({
      itemCount: options.length,
      itemWidth: 10_000,
      onBack: onClose,
    });

  useControllerActions({
    onAction: (action) => {
      if (action === "menu") {
        onClose();
        return true;
      }
      return false;
    },
  });

  return (
    <div className="quick-menu-backdrop" role="presentation">
      <section
        className="quick-menu"
        role="dialog"
        aria-label="Quick menu"
        ref={containerRef as React.RefObject<HTMLElement>}
      >
        <p className="quick-menu-kicker">Pixelcache</p>
        <h2 className="quick-menu-title">Quick menu</h2>
        <div className="quick-menu-list">
          {options.map((option, index) => (
            <button
              key={option.label}
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
        <p className="quick-menu-hint">A Select · B Back · Start Close</p>
      </section>
    </div>
  );
}

export default QuickMenu;
