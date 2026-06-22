/**
 * Multi-Level Region Adder helpers.
 *
 * Why this module exists:
 * Foundry v14 native Scene Levels expose Region documents that may be bound to
 * one or many levels via the `levels: string[]` field. Pairing that with a
 * `changeLevel` Region Behavior gives a single shape that acts as a transit
 * point across several floors (stairs, ladders, elevators). This module wraps
 * the small amount of bookkeeping needed to build that payload from a click
 * position and a set of target level IDs, mirroring the structure observed in
 * the reference scene `fvtt-Scene-teste-region-level-64LHWi9sQ5kbkNt7.json`.
 */

/** Guards against two concurrent canvas placements double-binding listeners. */
let _pickInProgress = false;

/**
 * Return the active scene's levels sorted by their bottom elevation ascending.
 * Bottom-most floor first, top-most last — so caller indices correspond to
 * "going up = +1, going down = -1" semantics.
 *
 * @param {Scene} scene
 * @returns {object[]} Array of level data objects (plain or document-like).
 */
export function getSceneLevels(scene) {
  if (!scene) return [];
  const collection = scene.levels;
  // v14 may expose either a Collection (with .contents) or a plain array
  // depending on whether the scene was hydrated as a Document.
  // Prefer the Collection's .contents; the array fallback reads .values() so a
  // bare Map yields level objects, not [key, value] entry tuples.
  const levels = collection?.contents
    ? collection.contents.slice()
    : Array.from(collection?.values?.() ?? collection ?? []);
  levels.sort((a, b) => (a.elevation?.bottom ?? 0) - (b.elevation?.bottom ?? 0));
  return levels;
}

/**
 * Best-effort detection of the level the user is currently viewing.
 * Foundry v14 surfaces the active level through several candidate properties
 * depending on the canvas pipeline state — we probe each in order and fall
 * back to `scene.initialLevel` then to the bottom-most level.
 *
 * @param {Scene} scene
 * @returns {string|null} Level `_id`, or null if the scene has no levels.
 */
export function getCurrentLevelId(scene) {
  if (!scene) return null;
  const levels = getSceneLevels(scene);
  const validIds = new Set(levels.map((l) => l._id));
  const candidates = [
    canvas?.scene?.activeLevel?._id,
    canvas?.environment?.activeLevel?._id,
    canvas?.activeLevel?._id,
    game.user?.activeLevel,
    scene.initialLevel
  ];
  // Only accept a candidate that is actually a level on this scene; a stale/initial
  // id (e.g. a deleted level) would otherwise mislead the starting-level dropdown.
  for (const c of candidates) {
    if (typeof c === "string" && validIds.has(c)) return c;
  }
  return levels[0]?._id ?? null;
}

/**
 * Let the user place a region by clicking or dragging on the canvas, resolving
 * with a normalized world-space rectangle `{x, y, width, height}` (top-left
 * origin, positive dimensions). A plain click (drag travel under the
 * screen-pixel threshold) yields a 1-grid-square rectangle centered on the
 * press point; a drag yields the swept rectangle. Pressing Escape rejects with
 * `"cancelled"`.
 *
 * Implementation notes:
 * - Listeners are attached in capture phase so they pre-empt Foundry's own
 *   canvas pointer handlers (avoiding token selection / pan). `mousemove` and
 *   `mouseup` live on `document` so a release outside the canvas still resolves.
 * - The live preview is a `PIXI.Graphics` added to `canvas.controls`, whose
 *   children are in world coordinates (matching `canvas.mousePosition`); it is
 *   non-interactive (`eventMode = "none"`) and destroyed by the single
 *   idempotent `cleanup()` run on every exit path (commit, Escape, error).
 * - v14 uses PIXI v7, so the preview uses the immediate-mode Graphics API
 *   (`beginFill`/`drawRect`/`endFill`/`clear`).
 *
 * @returns {Promise<{x:number, y:number, width:number, height:number}>}
 */
export function pickCanvasRectangle() {
  return new Promise((resolve, reject) => {
    if (_pickInProgress) {
      reject(new Error("A region placement is already in progress."));
      return;
    }
    const view = canvas.app?.view ?? canvas.app?.canvas;
    if (!view) {
      reject(new Error("Canvas view is not available."));
      return;
    }

    const gridSize = canvas.scene?.grid?.size ?? 100;
    const DRAG_THRESHOLD_PX = 8;     // screen-pixel travel below which a drag is a click
    const MIN_WORLD = gridSize / 4;  // floor for a dragged dimension (schema requires > 0)

    let startWorld = null;   // {x,y} world coords at mousedown
    let startScreen = null;  // {x,y} screen coords at mousedown
    let preview = null;      // PIXI.Graphics live preview (null if controls layer absent)
    let done = false;

    const drawPreview = (a, b) => {
      if (!preview) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      preview.clear();
      preview.lineStyle(2, 0xb0cc28, 1);
      preview.beginFill(0xb0cc28, 0.15);
      preview.drawRect(x, y, w, h);
      preview.endFill();
    };

    /** @param {MouseEvent} event */
    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      startScreen = { x: event.clientX, y: event.clientY };
      const p = canvas.mousePosition;
      startWorld = { x: p.x, y: p.y };
      if (canvas.controls) {
        preview = new PIXI.Graphics();
        preview.eventMode = "none";
        canvas.controls.addChild(preview);
      }
    };

    const onMouseMove = () => {
      if (!startWorld) return;
      drawPreview(startWorld, canvas.mousePosition);
    };

    /** @param {MouseEvent} event */
    const onMouseUp = (event) => {
      if (event.button !== 0 || !startWorld) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const p = canvas.mousePosition;
      const dragPx = Math.hypot(event.clientX - startScreen.x, event.clientY - startScreen.y);

      let rect;
      if (dragPx < DRAG_THRESHOLD_PX) {
        // Treat as a click: a 1-grid-square region centered on the press point.
        rect = { x: startWorld.x - gridSize / 2, y: startWorld.y - gridSize / 2, width: gridSize, height: gridSize };
      } else {
        const x = Math.min(startWorld.x, p.x);
        const y = Math.min(startWorld.y, p.y);
        const w = Math.max(Math.abs(p.x - startWorld.x), MIN_WORLD);
        const h = Math.max(Math.abs(p.y - startWorld.y), MIN_WORLD);
        rect = { x, y, width: w, height: h };
      }
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
        cleanup();
        reject(new Error("Invalid placement coordinates."));
        return;
      }
      cleanup();
      resolve(rect);
    };

    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      reject(new Error("cancelled"));
    };

    const cleanup = () => {
      if (done) return;   // idempotent — safe to call from any exit path
      done = true;
      _pickInProgress = false;
      view.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("da-region-picking");
      if (preview) {
        preview.parent?.removeChild(preview);
        preview.destroy();
        preview = null;
      }
    };

    _pickInProgress = true;
    view.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("da-region-picking");
  });
}

/**
 * Create a single multi-level Region on the given Scene at the given world
 * coordinates, bound to every level in `levelIds` and carrying a default
 * `changeLevel` behavior. The shape is a 1-grid-square rectangle centered on
 * the click.
 *
 * Why one region (not many): Foundry's Region.levels field is a Set of level
 * ids — one document is enough to make the shape appear on every requested
 * floor, and the `changeLevel` behavior lets the user pick a destination at
 * runtime from that set.
 *
 * @param {object} params
 * @param {Scene} params.scene
 * @param {number} params.x        World X. Top-left of the rect when width/height
 *                                 are given; otherwise the center of the fallback square.
 * @param {number} params.y        World Y (see `x`).
 * @param {number} [params.width]  Rectangle width (world units, > 0). Omit for a 1-grid square.
 * @param {number} [params.height] Rectangle height (world units, > 0). Omit for a 1-grid square.
 * @param {string[]} params.levelIds  Level _ids the region must appear on.
 * @param {string} [params.name]   Region name; defaults to "Multi-Level Region".
 * @returns {Promise<RegionDocument>}
 */
export async function createMultiLevelRegion({ scene, x, y, width, height, levelIds, name = "Multi-Level Region" }) {
  if (!scene) throw new Error("No scene provided.");
  if (!Array.isArray(levelIds) || levelIds.length === 0) {
    throw new Error("levelIds must be a non-empty array.");
  }

  const gridSize = scene.grid?.size ?? 100;
  const levels = getSceneLevels(scene).filter((l) => levelIds.includes(l._id));
  if (levels.length === 0) {
    throw new Error("None of the provided level ids exist on the scene.");
  }

  // Resolve the rectangle. An explicit positive width/height is used as-is
  // (x,y = top-left); otherwise fall back to a 1-grid square centered on (x,y).
  // v14 RectangleShapeData requires strictly positive width/height, so guard it.
  const hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const rect = hasSize
    ? { x, y, width, height }
    : { x: x - gridSize / 2, y: y - gridSize / 2, width: gridSize, height: gridSize };
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new Error("Region rectangle has invalid dimensions.");
  }

  const minBottom = Math.min(...levels.map((l) => l.elevation?.bottom ?? 0));
  const maxTop = Math.max(...levels.map((l) => l.elevation?.top ?? 10));

  const regionData = {
    name,
    color: "#b0cc28",
    elevation: { bottom: minBottom, top: maxTop },
    levels: levelIds,
    visibility: 2,
    highlightMode: "shapes",
    displayMeasurements: false,
    hidden: false,
    shapes: [
      {
        type: "rectangle",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        hole: false,
        rotation: 0
      }
    ],
    behaviors: [
      {
        name: "Change Level",
        type: "changeLevel",
        system: {},
        disabled: false,
        flags: {}
      }
    ]
  };

  const created = await scene.createEmbeddedDocuments("Region", [regionData]);
  return created[0];
}
