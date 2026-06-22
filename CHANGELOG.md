# 0.0.6

## [Changed]
- **Removed the blue accent** throughout the importer in favour of a warm amber accent. The active tab is now clearly highlighted (amber underline + tinted background) and the tab hover effect is more visible.
- Renamed the Levels-tab **"Show advanced columns"** checkbox to an **"Advanced Options"** toggle, moved out of the way to sit beside the intro text (instead of between the text and the level rows).
- The **Advanced Options** state is now **persisted per browser** — leave it on (or off) and it stays that way the next time you open the dialog.
- The advanced-columns help is now a high-contrast hover **tooltip** on a **?** icon (no longer an inline panel folded into the dialog), with a non-blue icon colour.
- The **#** drag handle now shows a grip icon so the drag-to-reorder affordance is obvious; the number still works as a drag handle too.
- The Levels-tab column headers and their cell contents (`#`, Bottom, Top, Roof, Start, Visible) are now centre-aligned over each column; the **Name** column stays left-aligned.

# 0.0.5

## [Changed]
- Renamed the importer sidebar button from **"DA Level Importer"** to **"Dungeon Alchemist Importer"**, and the region tool button from **"DA Add Stairs / Elevator"** to **"DA Stairs"**.
- The **"DA Edit Levels"** and **"DA Stairs"** buttons now sit side by side on one row beneath the full-width importer button, instead of stacked vertically.

# 0.0.4

- https://github.com/brunocalado/da-level-importer/pull/1

## [Added]
- **Animated map support**: floors exported as video — `.webm` (plus `.mp4` / `.m4v`) — are now accepted alongside images (`.jpg`, `.jpeg`, `.png`, `.webp`) and become animated Scene Level backgrounds. The Levels tab previews video floors with a muted, looping player (the row thumbnail sits paused on its first frame; the enlarged hover preview animates).
- **Edit an existing scene's levels** — `DA.EditLevels()` and a new **"DA Edit Levels"** sidebar button. Open it on the scene you're viewing to rename levels, change bottom/top elevations, reorder them (drag the **#**), and adjust Roof / Start / Visible, then **Apply Changes**. Edits are written in place by level id, so all walls, lights, and regions stay bound — no re-linking. *(Edits existing levels only; adding/removing levels is not yet supported, and reordering restacks elevations to the default ladder.)*
- **Drag-to-reorder floors**: drag a row by its **#** handle to change the stacking order. Bottom/Top elevations restack automatically, while each floor's Name, Roof, Start, and Visible settings travel with it (each floor has a stable internal id, so edits survive reordering and re-renders).
- **Basic / Advanced Levels view**: the Levels tab defaults to a Basic view (`#`, preview, Name, Bottom, Top); a **"Show advanced columns"** toggle reveals Roof / Start / Visible, with an ⓘ icon opening a help panel that explains when each is useful.
- **Names pre-filled from the original filename** (shown on the thumbnail tooltip alongside the file size), and an explanatory hover tooltip on every Levels-tab column header (via Foundry's tooltip system).
- **Roof auto-detection**: a floor whose filename contains "roof" is auto-detected and pre-marked as Roof (with a notification listing which).
- **Drag-to-draw region placement**: when placing a stair/elevator region (`DA.AddRegion()`) you can drag on the canvas to draw the region's footprint with a live preview; a plain click still drops the default one-grid-square region.
- **Sidebar buttons** for the stair/elevator tool (**"DA Add Stairs / Elevator"**) and the level editor (**"DA Edit Levels"**), injected next to the importer button — so neither tool requires typing a console command.
- **Persisted dialog defaults**: the importer remembers your last-used door texture, door sound, background color, grid opacity, and Copy Media toggle per browser (a hidden client-scoped setting) and restores them on open.
- **Large-media warning** in the Levels tab: floors whose media exceeds Foundry's ~50 MB recommendation for animated maps get an amber outline + size tooltip and a one-line summary notification. Sizes are probed via a `HEAD` request for local sources (`data`/`public`) only.
- **Elevation validation**: import is blocked with a clear message when any level's bottom is ≥ its top.
- **Mixed-folder detection**: import warns when the selected folder appears to contain more than one map (multiple distinct base names), which would otherwise merge unrelated floors into one scene.
- Broken or undecodable floor media now shows a hatched placeholder (plus a console warning) instead of a blank thumbnail box.
- Unpaired files (a `.json` with no media, or media with no `.json`) are now logged to the console instead of being silently dropped.
- New shared constants in `scripts/constants.js`: `SETTING_IMPORTER_DEFAULTS` and `MEDIA_SIZE_WARN_BYTES`.

## [Changed]
- Renamed the **"Copy Images to World"** toggle to **"Copy Media to World"** — it already handled video files.
- When a floor ships more than one media file (e.g. both `.jpg` and `.webp`), the importer now picks **deterministically** by a priority order (video > webp > png > jpg) instead of depending on the order files are listed.
- Lights are now stamped at their level's **resolved** bottom elevation (honoring per-level overrides) instead of a recomputed default.
- The bottom floor's Roof toggle is disabled — a floor with nothing below it can't be a roof; a roof dragged to the bottom clears automatically.

## [Fixed]
- **v14 schema**: removed `offsetX` / `offsetY` / `rotation` from each level's `textures` block — these were removed from Foundry's `TextureData` in v14.354 and would fail schema validation.
- **v14 schema**: wall **movement** restriction no longer emits the invalid value `10`. Foundry's `WALL_MOVEMENT_TYPES` defines only `NONE` (0) and `NORMAL` (20), so movement now maps to `0`/`20`, while sight/sound keep the `0`/`10`/`20` (none/limited/normal) mapping.
- **v14 schema**: region rectangle shapes no longer carry the invalid `anchorX` / `anchorY` / `gridBased` fields (not part of v14's `RectangleShapeData`), and the region width/height are guarded to be strictly positive.
- The **ⓘ info icon** now opens a readable help panel when clicked (Foundry suppresses plain `title` tooltips, so the old hover tooltip didn't appear).
- Levels-tab edits are captured continuously into a per-floor state store, so a Name / elevation / Roof / Visible edit survives a full dialog re-render instead of silently reverting to defaults.
- The oversized-media warning lists floors by filename (stable) instead of an index that could go stale after a reorder.
- Enlarged hover previews no longer orphan on screen if the list rebuilds mid-hover.
- The stairs tool's "current level" detection now validates the level still exists on the scene.

# 0.0.3

## [Added]
- **Initial Level toggle** in the Levels tab: each row now has a star button (`★`/`☆`) in the new "Start" column. Only one level can be marked as initial at a time — clicking a star deactivates all others. The selected level is written to `initialLevel` on the created scene, controlling which floor is shown on first load. Defaults to level 0.

## [Added]
- **Visible Levels** column in the Levels tab: each level row now has a compact dropdown button (`— ▾` / `N ▾`) listing all other levels as checkboxes. Any levels checked will be included in that level's `visibility.levels` array on import, controlling which other floors are simultaneously visible when that level is active.
- Visible Levels and Is Roof work together: if both are configured, their results are merged (deduplicated) into a single `visibility.levels` array.
- **Levels tab** in the importer dialog: after selecting a folder, a new "Levels" tab is populated with one row per detected floor — thumbnail, editable name, and editable bottom/top elevation inputs.
- **Uniform floor height** field at the top of the Levels tab: changing this value recalculates all individual bottom/top inputs automatically, making it easy to set the same height for every level.
- `scripts/constants.js` with `MODULE_ID` and `FLOOR_HEIGHT` as shared module-wide constants.
- Per-level **Is Roof** toggle in the Levels tab: any level (except the first) can be flagged as a roof. The toggle carries a tooltip with the behavior description. Replaces the former global "Last Level is Roof" toggle.

## [Changed]
- Importer dialog width increased from 480 px to 620 px to accommodate the new Visible Levels column.

## [Fixed]
- Removed Foundry's default orange focus outline and glow from buttons inside the importer and region-adder dialogs; buttons elsewhere in the VTT are unaffected.

## [Removed]
- Global "Last Level is Roof" toggle from the Scene Defaults tab; superseded by the per-level roof toggle in the Levels tab.

# 0.0.2

## [Fixed]
- Level elevation ranges no longer overlap at boundaries: each floor above ground now starts at `i * FLOOR_HEIGHT + 1` (e.g., 0–10, 11–20, 21–30) instead of sharing the same value with the floor below.



## [Added]
- "Last Level is Roof" toggle (off by default): when enabled, the last imported level's `visibility.levels` is set to the id of the level directly below it, causing it to render only when that floor is active.

- Scenes directory sidebar button "DA Level Importer" injected below the search bar via the `renderSceneDirectory` hook for quick one-click access to `DA.Importer()`.
- Tabbed importer dialog: "Scene Defaults" and "Doors" tabs for organized settings.
- Door texture selector with 25 Foundry canvas door options; includes real-time preview with hover tooltip showing enlarged image.
- Door sound selector with 21 Foundry door sound options; includes play preview button to audition sounds before import.
- Automatic door texture and sound application: when importing, any wall with `door=1` receives the selected texture (with swing animation) and sound key.
- Multi-level region creation tool `DA.AddRegion()`: opens a dialog to configure a staircase/elevator transit region spanning multiple consecutive levels. User selects a starting level, specifies how many levels above and below should also have the region, then clicks on canvas to place. Single region document bound to all target levels with native `changeLevel` behavior.


