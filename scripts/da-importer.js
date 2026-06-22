/**
 * Dungeon Alchemist → Foundry v14 native Levels importer.
 *
 * Why this module exists:
 * Dungeon Alchemist exports multi-floor maps as sibling pairs of one media file
 * (image or video) + `.json` (one pair per floor). Foundry v14 natively supports
 * multi-floor scenes through
 * `scene.levels[]`. This module bridges the two formats so the user gets a single
 * Scene with one Level per exported floor, populated with walls/doors/lights.
 *
 * Level binding strategy:
 * Both BaseWall and BaseAmbientLight expose a `levels` field of type
 * `SceneLevelsSetField` — a Set of Level `_id`s the document belongs to.
 * We emit `levels: [levelId]` per document, with the id taken from the
 * matching Scene Level we build below.
 */

import { FLOOR_HEIGHT } from "./constants.js";

const FLOOR_RE = /-_(\d+)$/;

/**
 * Background media accepted alongside each floor's `.json`. Foundry can use any
 * of these as a Scene Level `background.src`; the VIDEO_EXTS render as animated
 * textures, the IMAGE_EXTS as static backgrounds.
 */
const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];
const VIDEO_EXTS = ["webm", "mp4", "m4v"];
const MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

/**
 * Preference order when a single floor ships more than one media file (e.g. a
 * `.jpg` and a `.webp`, or a still image alongside an animated video). Earlier =
 * preferred: animated video wins outright, then the most efficient still formats.
 */
const MEDIA_PRIORITY = ["webm", "mp4", "m4v", "webp", "png", "jpeg", "jpg"];

/**
 * Whether a path points to a video Foundry renders as an animated texture
 * (rather than a static image). Lets the dialog choose a <video> over an <img>
 * for a floor's thumbnail.
 *
 * @param {string} path  File path or URL (trailing query/hash tolerated).
 * @returns {boolean}
 */
export function isVideoPath(path) {
  const clean = String(path).split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  const ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
  return VIDEO_EXTS.includes(ext);
}

/**
 * Convert an arbitrary filename stem to strict kebab-case.
 * Replaces accented/special characters with ASCII equivalents,
 * then collapses any non-alphanumeric run into a single hyphen.
 *
 * @param {string} name  Raw filename stem (no extension).
 * @returns {string}     Normalized kebab-case stem.
 */
function _toKebab(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Ensure a unique subdirectory exists under `worlds/<worldId>/da-imported/`.
 * If `baseName` is taken, appends an incrementing integer suffix
 * (tavern → tavern1 → tavern2 …) until a free slot is found.
 *
 * Probes existence via FilePicker.browse(): success → exists; throw → absent.
 *
 * @param {string} baseName  Kebab-case map name.
 * @returns {Promise<string>} Full path of the created directory.
 */
async function _ensureUniqueSubfolder(baseName) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const root = `worlds/${game.world.id}/da-imported`;

  try {
    await FP.createDirectory("data", root, {});
  } catch (_) { /* already exists — safe to ignore */ }

  let candidate = baseName;
  let n = 0;
  while (true) {
    const testPath = `${root}/${candidate}`;
    let exists = false;
    try {
      await FP.browse("data", testPath);
      exists = true;
    } catch (_) {
      exists = false;
    }
    if (!exists) {
      await FP.createDirectory("data", testPath, {});
      return testPath;
    }
    n += 1;
    candidate = `${baseName}${n}`;
  }
}

/**
 * Download a remote media file (image or video) via fetch and upload it into
 * `destFolder` using FilePicker.upload().
 *
 * @param {string} srcUrl      Original media URL (from FilePicker.browse).
 * @param {string} destFolder  Target path, e.g. "worlds/x/da-imported/tavern".
 * @param {string} kebabStem   Kebab-case filename stem (no extension).
 * @param {string} ext         Lowercase file extension without dot.
 * @returns {Promise<string>}  The new path of the uploaded file.
 */
async function _copyMedia(srcUrl, destFolder, kebabStem, ext) {
  const FP = foundry.applications.apps.FilePicker.implementation;

  const response = await fetch(srcUrl);
  if (!response.ok) throw new Error(`Failed to fetch media ${srcUrl}: HTTP ${response.status}`);
  const blob = await response.blob();

  const filename = `${kebabStem}.${ext}`;
  const file = new File([blob], filename, { type: blob.type });

  const result = await FP.upload("data", destFolder, file, {});
  return result.path;
}

/**
 * Import a Dungeon Alchemist folder as a single v14 Scene with Levels.
 *
 * @param {object} params
 * @param {string} params.source                         FilePicker source (e.g. "data", "public").
 * @param {string} params.path                           Folder path inside that source.
 * @param {string} [params.backgroundColor="#000000"]   Scene background fill color.
 * @param {number} [params.gridAlpha=0]                 Grid overlay opacity (0–1).
 * @param {Array<{name?:string,bottom?:number,top?:number,isRoof?:boolean,visibleLevels?:number[]}>} [params.levelOverrides]
 *   Per-floor overrides for name, elevation, roof behavior, and explicit visible-level indices.
 * @returns {Promise<Scene|null>}                        The created Scene, or null on abort.
 */
export async function importFolder({ source, path, backgroundColor = "#000000", gridAlpha = 0, copyImages = false, doorTexture = "", doorSound = "", levelOverrides = [], initialLevelIndex = 0 }) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;

  let listing;
  try {
    listing = await FilePicker.browse(source, path);
  } catch (err) {
    ui.notifications.error(`DA Importer: cannot browse "${path}" (${err.message})`);
    return null;
  }

  const pairs = collectFloorPairs(listing.files);
  console.log(`[DA Importer] found ${pairs.length} floor pair(s):`, pairs.map((p) => p.stem));
  if (pairs.length === 0) {
    ui.notifications.warn("DA Importer: no Dungeon Alchemist floor pairs (image/video + .json) found in folder.");
    return null;
  }

  // Heuristic: a folder should hold a single map. If the stems resolve to more
  // than one base-name, warn (but proceed) — floors from different maps would
  // otherwise be silently merged into one scene.
  const mapStems = distinctMapStems(pairs);
  if (mapStems.length > 1) {
    ui.notifications.warn(`DA Importer: this folder appears to contain ${mapStems.length} maps (${mapStems.join(", ")}). Each folder should hold only one map; floors from different maps will be mixed into one scene.`);
  }

  let floors;
  try {
    floors = await Promise.all(pairs.map(async (p) => {
      const res = await fetch(p.json);
      if (!res.ok) throw new Error(`${p.json}: HTTP ${res.status}`);
      return { ...p, data: await res.json() };
    }));
  } catch (err) {
    ui.notifications.error(`DA Importer: failed to load JSON (${err.message})`);
    return null;
  }

  // ── Optional: copy media to the world folder ───────────────────────────────
  // Why: by default, the imported Scene references each floor's media at its
  // original FilePicker location. When copyImages is enabled the files are copied
  // into worlds/<id>/da-imported/<map>/ and renamed to kebab-case, so the world
  // becomes self-contained and portable.
  if (copyImages) {
    const rawStem = _commonStem(pairs);
    const kebabBase = _toKebab(rawStem || "da-map");
    let destFolder;
    try {
      destFolder = await _ensureUniqueSubfolder(kebabBase);
    } catch (err) {
      ui.notifications.error(`DA Importer: could not create destination folder (${err.message})`);
      return null;
    }

    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      const originalUrl = f.media;
      const origFilename = decodeURIComponent(originalUrl.split("/").pop());
      const dotIdx = origFilename.lastIndexOf(".");
      const ext = dotIdx >= 0 ? origFilename.slice(dotIdx + 1).toLowerCase() : "jpg";
      const kebabFilename = _toKebab(f.stem);
      try {
        // floors[i] is a shallow copy of pairs[i] (see the Promise.all above),
        // so we mutate floors[i].media directly — that is the reference used
        // when building levels[] below.
        f.media = await _copyMedia(originalUrl, destFolder, kebabFilename, ext);
      } catch (err) {
        ui.notifications.error(`DA Importer: failed to copy media "${origFilename}" (${err.message})`);
        return null;
      }
    }
    console.log(`[DA Importer] media copied to "${destFolder}"`);
  }
  // ────────────────────────────────────────────────────────────────────────────

  const first = floors[0].data;
  const stem = _commonStem(pairs);

  const levels = floors.map((f, i) => {
    const ov = levelOverrides[i];
    const name = ov?.name?.trim() || `Floor ${i}`;
    const defaultBottom = i === 0 ? 0 : i * FLOOR_HEIGHT + 1;
    const defaultTop = (i + 1) * FLOOR_HEIGHT;
    const bottom = Number.isFinite(ov?.bottom) ? ov.bottom : defaultBottom;
    const top    = Number.isFinite(ov?.top)    ? ov.top    : defaultTop;
    return {
      _id: foundry.utils.randomID(),
      name,
      elevation: { bottom, top },
      background: {
        src: f.media,
        color: backgroundColor,
        tint: "#ffffff",
        alphaThreshold: 0.75
      },
      foreground: { src: null, tint: "#ffffff", alphaThreshold: 0.75 },
      fog: { src: null, tint: "#ffffff" },
      textures: {
        anchorX: 0.5, anchorY: 0.5,
        fit: "fill", scaleX: 1, scaleY: 1
      },
      visibility: { levels: [] },
      sort: i,
      flags: {}
    };
  });

  // Build visibility.levels for each level by merging the isRoof shortcut
  // (adds the immediately lower level) with any explicit visibleLevels selections.
  // Deduplication ensures a level that appears in both is listed only once.
  levels.forEach((level, i) => {
    const ov = levelOverrides[i];
    const visIds = [];
    if (i > 0 && ov?.isRoof) visIds.push(levels[i - 1]._id);
    for (const j of (ov?.visibleLevels ?? [])) {
      const id = levels[j]?._id;
      if (id && !visIds.includes(id)) visIds.push(id);
    }
    level.visibility.levels = visIds;
  });

  const walls = [];
  const lights = [];
  floors.forEach((f, i) => {
    const levelId = levels[i]._id;
    // Stamp lights at the level's resolved bottom (which honors per-level
    // overrides), not a recomputed i * FLOOR_HEIGHT that ignores them.
    const elevation = levels[i].elevation.bottom;
    for (const w of (f.data.walls ?? [])) walls.push(_mapWall(w, levelId, doorTexture, doorSound));
    for (const l of (f.data.lights ?? [])) lights.push(_mapLight(l, levelId, elevation));
  });
  console.log(`[DA Importer] built ${levels.length} levels, ${walls.length} walls, ${lights.length} lights`);

  const sceneData = {
    name: stem || "Dungeon Alchemist Map",
    width: first.width,
    height: first.height,
    padding: first.padding ?? 0.25,
    background: { color: backgroundColor },
    grid: {
      type: 1,
      size: first.grid,
      style: "solidLines",
      thickness: 1,
      color: first.gridColor ?? "#000000",
      alpha: gridAlpha,
      distance: first.gridDistance ?? 5,
      units: first.gridUnits ?? "ft"
    },
    tokenVision: true,
    fog: { mode: 1, colors: { explored: null, unexplored: null } },
    environment: {
      darknessLevel: first.darkness ?? 0,
      darknessLock: false,
      globalLight: {
        enabled: !!first.globalLight,
        alpha: 0.5, bright: false, color: null, coloration: 1,
        luminosity: 0, saturation: 0, contrast: 0, shadows: 0,
        darkness: { min: 0, max: 1 }
      },
      cycle: true,
      base: { hue: 0, intensity: 0, luminosity: 0, saturation: 0, shadows: 0 },
      dark: { hue: 0, intensity: 0, luminosity: -0.25, saturation: 0, shadows: 0 }
    },
    levels,
    initialLevel: (levels[initialLevelIndex] ?? levels[0])._id,
    walls,
    lights
  };

  console.log("[DA Importer] scene payload:", sceneData);

  let scene;
  try {
    scene = await Scene.create(sceneData);
  } catch (err) {
    ui.notifications.error(`DA Importer: Scene.create failed (${err.message})`);
    console.error(err);
    return null;
  }
  if (!scene) {
    ui.notifications.error("DA Importer: Scene.create returned no document — check the console for validation errors.");
    return null;
  }

  const createdLevels = scene.levels?.size ?? scene.levels?.length ?? 0;
  const createdWalls = scene.walls?.size ?? 0;
  const createdLights = scene.lights?.size ?? 0;
  console.log(`[DA Importer] scene created: ${createdLevels} levels, ${createdWalls} walls, ${createdLights} lights`);
  ui.notifications.info(`DA Importer: created "${scene.name}" — ${createdLevels} level(s), ${createdWalls} wall(s), ${createdLights} light(s).`);
  return scene;
}

/**
 * Pair `.json` files with sibling image/video files and sort by the `-_NN` suffix.
 * Exported so the importer dialog can inspect the pairs before the full import.
 *
 * @param {string[]} files  Full URLs returned by FilePicker.browse().
 * @returns {{stem:string, index:number, json:string, media:string}[]}
 */
export function collectFloorPairs(files) {
  const byStem = new Map();
  for (const f of files) {
    const base = decodeURIComponent(f.split("/").pop());
    const dot = base.lastIndexOf(".");
    if (dot < 0) continue;
    const stem = base.slice(0, dot);
    const ext = base.slice(dot + 1).toLowerCase();
    if (ext !== "json" && !MEDIA_EXTS.includes(ext)) continue;
    if (!byStem.has(stem)) byStem.set(stem, {});
    const entry = byStem.get(stem);
    if (ext === "json") {
      entry.json = f;
    } else {
      // One media file per floor. When several are present, keep the
      // highest-priority extension (lower MEDIA_PRIORITY index) so the choice is
      // deterministic regardless of the order FilePicker returns files in.
      const rank = MEDIA_PRIORITY.indexOf(ext);
      const curRank = entry.imgExt ? MEDIA_PRIORITY.indexOf(entry.imgExt) : Infinity;
      if (rank < curRank) {
        entry.img = f;
        entry.imgExt = ext;
      }
    }
  }

  const pairs = [];
  const orphans = [];
  for (const [stem, entry] of byStem) {
    if (!entry.json || !entry.img) {
      orphans.push(`${stem} — ${entry.json ? "JSON with no image/video" : "image/video with no JSON"}`);
      continue;
    }
    const m = stem.match(FLOOR_RE);
    pairs.push({
      stem,
      index: m ? parseInt(m[1], 10) : 0,
      json: entry.json,
      media: entry.img
    });
  }
  if (orphans.length) {
    console.warn(`[DA Importer] skipped ${orphans.length} unpaired file(s):`, orphans);
  }
  pairs.sort((a, b) => a.index - b.index || a.stem.localeCompare(b.stem));
  return pairs;
}

/**
 * Compute the map name by stripping the `-_NN` suffix shared by all floors.
 *
 * @param {{stem:string}[]} pairs
 * @returns {string}
 */
function _commonStem(pairs) {
  const stems = pairs.map((p) => p.stem.replace(FLOOR_RE, ""));
  return stems[0];
}

/**
 * Distinct map base-names across a set of pairs: each stem has its `-_NN` suffix
 * stripped and is kebab-normalized (so case/accents don't create false
 * positives, and floors with no numeric suffix are still compared). More than
 * one entry means the folder likely mixes multiple maps, which the importer is
 * not designed for — it pairs every media with a sibling JSON and names the
 * scene from the first stem.
 *
 * @param {{stem:string}[]} pairs
 * @returns {string[]} Unique normalized base-names (may be empty).
 */
export function distinctMapStems(pairs) {
  return [...new Set(pairs.map((p) => _toKebab(p.stem.replace(FLOOR_RE, ""))))];
}

/**
 * Translate a DA 0/1/2 restriction flag into a v14 wall SENSE enum
 * (sight/sound/light). DA uses a compact {0:none, 1:normal, 2:limited} scheme;
 * v14 `WALL_SENSE_TYPES` use {NONE:0, LIMITED:10, NORMAL:20, ...}.
 *
 * @param {number} v
 * @returns {number}
 */
function _senseEnum(v) {
  if (v === 2) return 10;
  if (v === 1) return 20;
  return 0;
}

/**
 * Translate a DA 0/1/2 flag into a v14 wall MOVEMENT enum. Movement is binary
 * in v14 — `WALL_MOVEMENT_TYPES` only defines {NONE:0, NORMAL:20} (there is no
 * LIMITED for movement), so any DA "blocking" value (normal or limited) maps to
 * NORMAL and 0 stays NONE. Routing movement through the sense mapping would emit
 * an invalid value of 10.
 *
 * @param {number} v
 * @returns {number}
 */
function _moveEnum(v) {
  return v ? 20 : 0;
}

/**
 * Map a DA wall into a v14 WallDocument source. Level binding uses the
 * `levels` Set field (SceneLevelsSetField) that accepts an array of Level ids.
 * When the wall is a standard door (door=1) and the user configured a texture
 * or sound in the dialog, those are stamped onto the document here.
 *
 * @param {object} daWall
 * @param {string} levelId
 * @param {string} [doorTexture=""]  Path to a door texture webp; empty string = skip.
 * @param {string} [doorSound=""]   Foundry door sound key; empty string = skip.
 * @returns {object}
 */
function _mapWall(daWall, levelId, doorTexture = "", doorSound = "") {
  const wallDoc = {
    c: daWall.c,
    move:  _moveEnum(daWall.move ?? 1),
    sight: _senseEnum(daWall.sense ?? 1),
    sound: _senseEnum(daWall.sound ?? 1),
    door:  daWall.door ?? 0,
    ds: 0,
    levels: [levelId]
  };
  if (daWall.door === 1) {
    if (doorTexture) wallDoc.animation = { texture: doorTexture, type: "swing" };
    if (doorSound)   wallDoc.doorSound  = doorSound;
  }
  return wallDoc;
}

/**
 * Map a DA light into a v14 AmbientLightDocument source. Bound to its floor
 * via the `levels` Set; `elevation` is stamped to the floor bottom as a
 * sensible default so the light also sorts correctly in 3D-aware tooling.
 *
 * @param {object} daLight
 * @param {string} levelId
 * @param {number} elevation
 * @returns {object}
 */
function _mapLight(daLight, levelId, elevation) {
  return {
    x: daLight.x,
    y: daLight.y,
    rotation: 0,
    walls: true,
    vision: false,
    elevation,
    config: {
      dim: daLight.dim,
      bright: daLight.bright,
      color: daLight.tintColor ?? null,
      alpha: daLight.tintAlpha ?? 0.5,
      angle: 360,
      coloration: 1,
      luminosity: 0.5,
      animation: { type: null, speed: 5, intensity: 5, reverse: false }
    },
    levels: [levelId]
  };
}
