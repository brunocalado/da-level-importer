import {
  getSceneLevels,
  getCurrentLevelId,
  pickCanvasRectangle,
  createMultiLevelRegion
} from "./region-adder.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Dialog for `DA.AddRegion()` — guides the user through:
 *   1. picking a starting level (auto-detected, overridable)
 *   2. choosing how many levels above / below should also receive the region
 *   3. clicking on the canvas to place a multi-level transit region
 *
 * Triggered programmatically via the module API (`game.modules.get("da-level-importer").api.AddRegion()`)
 * or globally as `DA.AddRegion()`. Lifecycle: `_prepareContext` → `_onRender`.
 */
export class DARegionAdderDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "da-region-adder",
    tag: "form",
    classes: ["da-region-adder"],
    form: {
      closeOnSubmit: false
    },
    window: {
      title: "Add Multi-Level Region",
      resizable: false
    },
    position: {
      width: 420,
      height: "auto"
    },
    actions: {
      pickLocation: DARegionAdderDialog.#onPickLocation
    }
  };

  static PARTS = {
    form: {
      template: "modules/da-level-importer/templates/region-adder.hbs"
    }
  };

  /**
   * Provide the data the template needs: scene metadata, sorted level list,
   * and per-level "selected" flag for the Starting Level dropdown.
   * Triggered by the ApplicationV2 lifecycle stage `_prepareContext`.
   *
   * @param {foundry.applications.api.ApplicationV2.RenderOptions} _options
   * @returns {Promise<object>}
   * @override
   */
  async _prepareContext(_options) {
    const scene = canvas.scene;
    if (!scene) return { hasScene: false };

    const levels = getSceneLevels(scene);
    if (levels.length === 0) return { hasScene: false };

    const currentId = getCurrentLevelId(scene);
    const currentIdx = Math.max(0, levels.findIndex((l) => l._id === currentId));
    const selectedId = levels[currentIdx]._id;

    return {
      hasScene: true,
      sceneName: scene.name,
      levelCount: levels.length,
      maxUp: levels.length - currentIdx - 1,
      maxDown: currentIdx,
      levels: levels.map((l) => ({
        _id: l._id,
        label: this.#formatLevelLabel(l),
        selected: l._id === selectedId
      }))
    };
  }

  /**
   * Wire up dropdown / number-input change listeners and seed the live preview.
   * Triggered by the ApplicationV2 lifecycle stage `_onRender` after each render.
   *
   * @param {foundry.applications.api.ApplicationV2.RenderContext} _context
   * @param {foundry.applications.api.ApplicationV2.RenderOptions} _options
   * @override
   */
  _onRender(_context, _options) {
    const select = this.element.querySelector("select[name='startingLevelId']");
    const upInput = this.element.querySelector("input[name='upCount']");
    const downInput = this.element.querySelector("input[name='downCount']");
    if (!select || !upInput || !downInput) return;

    select.addEventListener("change", () => {
      this.#updateLimits();
      this.#refreshPreview();
    });
    upInput.addEventListener("input", () => this.#refreshPreview());
    downInput.addEventListener("input", () => this.#refreshPreview());

    this.#refreshPreview();
  }

  /**
   * Format a level for the dropdown / preview list. Includes elevation range so
   * the GM can disambiguate similarly-named levels.
   *
   * @param {object} level
   * @returns {string}
   */
  #formatLevelLabel(level) {
    const bottom = level.elevation?.bottom ?? 0;
    const top = level.elevation?.top ?? 0;
    return `${level.name} (elev ${bottom}–${top})`;
  }

  /**
   * Recompute the up/down number-input maxima after the starting level changes,
   * clamping the current values so the user can never select a level outside
   * the scene's bounds.
   */
  #updateLimits() {
    const select = this.element.querySelector("select[name='startingLevelId']");
    const upInput = this.element.querySelector("input[name='upCount']");
    const downInput = this.element.querySelector("input[name='downCount']");
    if (!select || !upInput || !downInput) return;

    const levels = getSceneLevels(canvas.scene);
    const idx = levels.findIndex((l) => l._id === select.value);
    if (idx < 0) return;

    const maxUp = levels.length - idx - 1;
    const maxDown = idx;
    upInput.max = String(maxUp);
    downInput.max = String(maxDown);
    if ((parseInt(upInput.value, 10) || 0) > maxUp) upInput.value = String(maxUp);
    if ((parseInt(downInput.value, 10) || 0) > maxDown) downInput.value = String(maxDown);
  }

  /**
   * Re-render the preview list of levels the region will be bound to,
   * driven by the current dropdown / counter state.
   */
  #refreshPreview() {
    const list = this.element.querySelector(".da-region-target-list");
    if (!list) return;
    const ids = this.#computeTargetLevelIds();
    const levels = getSceneLevels(canvas.scene);
    list.innerHTML = "";
    for (const id of ids) {
      const level = levels.find((l) => l._id === id);
      if (!level) continue;
      const li = document.createElement("li");
      li.textContent = this.#formatLevelLabel(level);
      list.appendChild(li);
    }
  }

  /**
   * Read the current form state and resolve the contiguous range of target
   * level ids: [starting - downCount … starting + upCount], inclusive,
   * sorted ascending by elevation.
   *
   * @returns {string[]}
   */
  #computeTargetLevelIds() {
    const select = this.element.querySelector("select[name='startingLevelId']");
    const upInput = this.element.querySelector("input[name='upCount']");
    const downInput = this.element.querySelector("input[name='downCount']");
    if (!select || !upInput || !downInput) return [];

    const levels = getSceneLevels(canvas.scene);
    const idx = levels.findIndex((l) => l._id === select.value);
    if (idx < 0) return [];

    const up = Math.max(0, parseInt(upInput.value, 10) || 0);
    const down = Math.max(0, parseInt(downInput.value, 10) || 0);
    const fromIdx = Math.max(0, idx - down);
    const toIdx = Math.min(levels.length - 1, idx + up);

    const ids = [];
    for (let i = fromIdx; i <= toIdx; i++) ids.push(levels[i]._id);
    return ids;
  }

  /**
   * Action handler for the "Pick Location" button. Closes the dialog, awaits
   * the next canvas click, then creates the multi-level region. Pressing
   * Escape during pick aborts cleanly with a notification.
   *
   * Bound by ApplicationV2 via the static `actions.pickLocation` map; `this`
   * is the dialog instance.
   *
   * @this {DARegionAdderDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} _target
   */
  static async #onPickLocation(_event, _target) {
    const scene = canvas.scene;
    if (!scene) {
      ui.notifications.warn("DA Region: no active scene.");
      return;
    }
    const levelIds = this.#computeTargetLevelIds();
    if (levelIds.length === 0) {
      ui.notifications.warn("DA Region: select at least one target level.");
      return;
    }

    await this.close();
    ui.notifications.info("Click to drop a region, or drag to draw its footprint. Press Escape to cancel.");

    let rect;
    try {
      rect = await pickCanvasRectangle();
    } catch (err) {
      ui.notifications.info("DA Region: placement cancelled.");
      return;
    }

    try {
      await createMultiLevelRegion({ scene, x: rect.x, y: rect.y, width: rect.width, height: rect.height, levelIds });
      ui.notifications.info(`DA Region: created across ${levelIds.length} level(s).`);
    } catch (err) {
      ui.notifications.error(`DA Region: failed to create (${err.message})`);
      console.error(err);
    }
  }
}
