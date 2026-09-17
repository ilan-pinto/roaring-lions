// packages/app/src/ui/settings-keymap.ts
/**
 * Task 5's Controls section: one row per rebindable action, mounted into the
 * settings table. A type stub for now, so `settings-panel.ts` can depend on
 * the SHAPE without depending on the implementation -- `SettingsDeps.keymap`
 * is `null` until Task 5 fills this in, and `settingsPanel` renders no
 * Controls section at all when it is.
 */
export interface KeymapDeps {
  mount(table: HTMLElement): void;
}
