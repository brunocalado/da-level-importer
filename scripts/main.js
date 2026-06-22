import { DAImporterDialog } from "./importer-dialog.js";
import { DARegionAdderDialog } from "./region-adder-dialog.js";
import { MODULE_ID, SETTING_IMPORTER_DEFAULTS } from "./constants.js";

Hooks.once("init", () => {
  // Per-client memory of the importer dialog's last-used selections (door
  // texture/sound, scene colors, copy toggle). Hidden from the Settings UI.
  game.settings.register(MODULE_ID, SETTING_IMPORTER_DEFAULTS, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.modules.get(MODULE_ID).api = {
    Importer: () => new DAImporterDialog().render(true),
    EditLevels: () => {
      const scene = canvas.scene;
      if (!scene) { ui.notifications.warn("DA: open a scene before editing its levels."); return; }
      const count = scene.levels?.size ?? scene.levels?.length ?? 0;
      if (!count) { ui.notifications.warn("DA: the current scene has no Levels to edit."); return; }
      new DAImporterDialog({ mode: "edit", scene }).render(true);
    },
    AddRegion: () => new DARegionAdderDialog().render(true)
  };
});

Hooks.once("ready", () => {
  window.DA = game.modules.get(MODULE_ID).api;
});

/**
 * Injects the DA Level Importer and Add Stairs/Region buttons into the Scenes
 * directory header. Fires on every render of SceneDirectory.
 *
 * @param {SceneDirectory} _app
 * @param {HTMLElement} html
 */
Hooks.on("renderSceneDirectory", (_app, html) => {
  if (html.querySelector(".da-importer-sidebar-btn")) return;

  const header = html.querySelector(".directory-header");
  if (!header) return;

  const api = game.modules.get(MODULE_ID).api;

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "da-importer-sidebar-btn";
  importBtn.innerHTML = '<i class="fas fa-file-import"></i> DA Level Importer';
  importBtn.addEventListener("click", () => api.Importer());

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "da-edit-sidebar-btn";
  editBtn.innerHTML = '<i class="fas fa-pen-to-square"></i> DA Edit Levels';
  editBtn.dataset.tooltip = "Edit the levels of the scene you're viewing";
  editBtn.addEventListener("click", () => api.EditLevels());

  const regionBtn = document.createElement("button");
  regionBtn.type = "button";
  regionBtn.className = "da-region-sidebar-btn";
  regionBtn.innerHTML = '<i class="fas fa-stairs"></i> DA Add Stairs / Elevator';
  regionBtn.dataset.tooltip = "Place a multi-level stair/elevator region on the scene you're viewing";
  regionBtn.addEventListener("click", () => api.AddRegion());

  // Insert after the native action buttons (Create Scene / Create Folder) so the
  // buttons sit between those and the search bar, regardless of v14's markup.
  const actionButtons = header.querySelector(".action-buttons") ?? header.querySelector(".header-actions");
  const anchor = actionButtons ? actionButtons.nextSibling : null;
  header.insertBefore(importBtn, anchor);
  header.insertBefore(editBtn, anchor);
  header.insertBefore(regionBtn, anchor);
});
