import type { PresetId } from "./presets";

export interface PresetPickerProps {
  onSelect: (preset: PresetId) => void;
  disabled?: boolean;
}

// FR2.8 (S): quick run (tier-0 cells only) vs. full run (everything runnable). There's no
// tri-state "custom" button — checking/unchecking a cell by hand after picking a preset just
// is the custom state, so it doesn't need its own affordance here.
export function PresetPicker({ onSelect, disabled = false }: PresetPickerProps) {
  return (
    <div className="preset-picker" role="group" aria-label="Run presets">
      <button type="button" disabled={disabled} onClick={() => onSelect("quick")}>
        Quick run
      </button>
      <button type="button" disabled={disabled} onClick={() => onSelect("full")}>
        Full run
      </button>
    </div>
  );
}
