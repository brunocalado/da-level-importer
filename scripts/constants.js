/** The module's unique identifier — matches the `id` field in module.json. */
export const MODULE_ID = "da-level-importer";

/**
 * Default elevation span per floor, in Foundry level units.
 * Shared between the importer and the dialog so both compute identical defaults.
 */
export const FLOOR_HEIGHT = 10;

/**
 * Client-scoped setting key remembering the importer dialog's last-used
 * selections (door texture/sound, scene colors, copy toggle) across opens.
 */
export const SETTING_IMPORTER_DEFAULTS = "importerDefaults";

/**
 * Floor media at or above this size (bytes) is flagged in the Levels tab.
 * Foundry recommends keeping animated maps under ~50 MB.
 */
export const MEDIA_SIZE_WARN_BYTES = 50 * 1024 * 1024;

/**
 * Movement actions pre-selected in the multi-level region dialog.
 *
 * The core `changeLevel` behavior reads an empty set as "any movement action may
 * take the stairs", which lets a flying or teleporting token use a staircase.
 * Stairs almost always mean walking, so the dialog seeds this instead — the GM
 * can still clear it to restore the native "anything goes" behavior.
 */
export const DEFAULT_REGION_MOVEMENT_ACTIONS = ["walk"];
