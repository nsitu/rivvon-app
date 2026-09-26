# Rivvon button conventions

Ordinary actions use the PrimeVue `Button` component. Shared classes in
`src/components/shared/buttonPrimitives.css` provide the cross-site heights,
radii, focus ring, icon-action surface, segmented surface, tool-panel surface,
and action-row spacing. Component styles should add only behavior-specific
visuals, such as a destructive color or a media overlay position.

## Intentional native controls

Not every native `<button>` is an ordinary action. These controls remain native
because their semantics or interaction model is specialized:

- `BottomToolbar.vue`: toolbar/menu triggers are a separate chrome system and
  remain outside the ordinary panel-button migration.
- `ColorPickerPopover.vue`: the Reka UI `PopoverTrigger as-child` contract
  requires the trigger element to remain the child control.
- `TextureCreator.vue`: PrimeVue Stepper headers use `asChild` and
  `a11yAttrs.header` for their step semantics.
- `AudioCreator.vue`: waveform markers are keyboard- and pointer-driven
  slider controls, not generic actions.
- `TextureSettingsControls.vue`: gradient-map handles are draggable stop
  controls; the adjacent add/remove actions are ordinary PrimeVue buttons.
- `EmojiPickerPanel.vue`: emoji cells are a custom selectable grid with
  sprite-specific layout and focus behavior.
- `DrawingBrowser.vue` and `TextureBrowser.vue`/`VideoGalleryView.vue`:
  collection tabs use native tab semantics with the shared segmented visual
  treatment.
- `DrawingBrowser.vue`: drawing preview cards preserve custom image-card
  activation and layout semantics.
- `AppHeader.vue`: context-title segments are inline breadcrumb-like
  navigation; their native element preserves text-flow behavior.

When adding a new native button, document why it belongs in this list. If it is
an ordinary submit, confirmation, navigation, retry, delete, or icon action,
use PrimeVue `Button` and the shared primitives instead.
