/**
 * renderer.js — Canvas-based hole rendering engine
 *
 * Ports the Python drawing functions from hyformulas.py to the HTML Canvas API.
 * All drawing happens on an OffscreenCanvas (or regular Canvas in environments
 * that don't support OffscreenCanvas) and returns an ImageBitmap or dataURL.
 *
 * Functions to implement (Phase 3–5):
 *
 *   renderHole(opts)       — full hole image (replaces the first pass in Python)
 *   renderGreenInset(opts) — green close-up (replaces second pass in Python)
 *   drawPolygons(ctx, arrays, color) — cv2.fillPoly equivalent
 *   drawPolylines(ctx, arrays, color, lineWidth) — cv2.polylines equivalent
 *   drawTrees(ctx, trees, color, radius) — circle + X symbol
 *   drawText(ctx, text, x, y, size, color) — with white background rect
 *   drawArcDistances(ctx, ...) — 50-yard elliptical arc rings
 *   drawCarryDistances(ctx, ...) — tee-to-hazard distance labels
 *   drawGreenDistances(ctx, ...) — feature-to-green distance labels
 *   drawGreenGrid(ctx, ...) — 3-yard grid for green inset
 *
 * Drawing Z-order (matches Python):
 *   1. Fill canvas with rough (background) color
 *   2. Draw woods / trees
 *   3. Draw water hazards
 *   4. Draw fairways
 *   5. Draw tee boxes
 *   6. Draw green
 *   7. Draw sand traps
 *   8. Draw individual trees (circle+X)
 *   9. Draw topography contours (semi-transparent)
 *  10. Draw uphill tick marks
 *  11. Draw distance annotations
 *  12. Draw arc distance rings
 *
 * Phases 3–5 are implemented. Phase 7 (elevation contours) is next.
 */

import {
  wayToPixels,
  rotatePoints, rotatePointsList,
  translateFeatures,
  getRotateAngle, getMidpointAngle,
  filterFeatures,
  distToLine,
  getYardsPerPixel, getCanvasDimensions,
} from './coords.js';

// iPadOS 13+ reports as "Macintosh" in UA, so also check maxTouchPoints.
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
const MAX_CANVAS_PX = IS_MOBILE ? 3000 : 6000;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the full hole image.
 * Equivalent to the first pass of Python generateYardageBook().
 *
 * @param {object} opts
 * @param {object}   opts.holeWay        — Overpass way with resolved node coords
 * @param {object}   opts.features       — from categorizeFeatures() in osm.js
 * @param {object|null} opts.elevationGrid — from fetchElevationGrid() in elevation.js
 * @param {{ latmin, lonmin, latmax, lonmax }} opts.bbox
 * @param {object}   opts.colors         — AppState.colors (hex strings)
 * @param {object}   opts.options        — AppState.options
 * @param {number}   opts.holeNum
 * @param {number}   opts.par
 * @returns {Promise<HTMLCanvasElement>}  canvas ready for toDataURL / jsPDF addImage
 */
export async function renderHole({ holeWay, features, elevationGrid, bbox, colors, options, holeNum, par }) {
  // ── 1. Canvas dimensions ────────────────────────────────────────────────────
  const { width, height } = getCanvasDimensions(bbox, MAX_CANVAS_PX);
  const ypp = getYardsPerPixel(bbox, width, height);
  const cx = width / 2, cy = height / 2;

  // ── 2. Convert all features to pixel coordinates ────────────────────────────
  const toPixels = (nodeArrays) =>
    nodeArrays.map(nodes => wayToPixels(nodes, bbox, width, height));

  const holePixels = wayToPixels(holeWay.nodes, bbox, width, height);
  let pixFairways  = toPixels(features.fairways);
  let pixTeeBoxes  = toPixels(features.teeBoxes);
  let pixWater     = toPixels(features.waterHazards);
  let pixSand      = toPixels(features.sandTraps);
  let pixWoods     = toPixels(features.woods);
  let pixTrees     = features.trees.map(n => wayToPixels([n], bbox, width, height)[0]);
  let pixGreen     = features.green ? wayToPixels(features.green, bbox, width, height) : null;
  let pixAllGreens = toPixels(features.allGreens || []);

  // ── 3. Compute rotation angle ───────────────────────────────────────────────
  const angle = getRotateAngle(holePixels);

  // ── 4. Rotate everything around original canvas center ─────────────────────
  const rotHole    = rotatePoints(holePixels, cx, cy, angle);
  pixFairways      = rotatePointsList(pixFairways, cx, cy, angle);
  pixTeeBoxes      = rotatePointsList(pixTeeBoxes, cx, cy, angle);
  pixWater         = rotatePointsList(pixWater,    cx, cy, angle);
  pixSand          = rotatePointsList(pixSand,     cx, cy, angle);
  pixWoods         = rotatePointsList(pixWoods,    cx, cy, angle);
  pixTrees         = rotatePoints(pixTrees, cx, cy, angle);
  pixAllGreens     = rotatePointsList(pixAllGreens, cx, cy, angle);
  const rotGreen   = pixGreen ? [rotatePoints(pixGreen, cx, cy, angle)] : [];

  // ── 5. New canvas size that contains the rotated content ───────────────────
  // Python: getNewImage computes xmin/ymin from rotated corners.
  // Here offsetX/Y = -xmin/-ymin (same as Python's translation offset).
  const { newWidth, newHeight, offsetX, offsetY } = getRotatedCanvasSize(width, height, angle);

  // ── 6. Translate into new coordinate space (subtract -offset = add offset) ─
  const adj = (arrays) => translateFeatures(arrays, -offsetX, -offsetY);

  pixFairways  = adj(pixFairways);
  pixTeeBoxes  = adj(pixTeeBoxes);
  pixWater     = adj(pixWater);
  pixSand      = adj(pixSand);
  pixWoods     = adj(pixWoods);
  pixTrees     = pixTrees.map(([x, y]) => [x + offsetX, y + offsetY]);
  pixAllGreens = adj(pixAllGreens);
  const adjGreen = adj(rotGreen);
  const adjHole  = translateFeatures([rotHole], -offsetX, -offsetY)[0];

  // ── 7. Filter features to this hole ────────────────────────────────────────
  const drawAll = !!options.drawAllFeatures;
  const fBase = {
    filterYards: options.holeWidth,
    shortFactor: options.shortFilter,
    medFactor:   (options.shortFilter + 1) / 2,
    drawAllFeatures: drawAll,
  };
  pixFairways = filterFeatures(adjHole, pixFairways, ypp, par, { ...fBase, isFairway: true });
  pixTeeBoxes = filterFeatures(adjHole, pixTeeBoxes, ypp, par, { ...fBase, isTeeBox: true });
  pixSand     = filterFeatures(adjHole, pixSand,     ypp, par, fBase);
  pixWoods    = filterFeatures(adjHole, pixWoods,    ypp, par, { filterYards: null });
  pixWater    = filterFeatures(adjHole, pixWater,    ypp, par, { filterYards: null });
  // Trees wrapped as single-point arrays for filtering, then unwrapped
  const filteredTreeArrays = filterFeatures(adjHole, pixTrees.map(p => [p]), ypp, par, { filterYards: 25, drawAllFeatures: drawAll });
  pixTrees = filteredTreeArrays.map(a => a[0]);
  // Extra greens: only shown in drawAllFeatures mode, filtered to the hole bbox by centroid
  if (drawAll) {
    pixAllGreens = filterFeatures(adjHole, pixAllGreens, ypp, par, { filterYards: fBase.filterYards, drawAllFeatures: true });
  }

  // ── 8. Draw on rotated canvas ───────────────────────────────────────────────
  const { canvas: rotCanvas, ctx } = createCanvas(newWidth, newHeight);
  ctx.fillStyle = colors.rough;
  ctx.fillRect(0, 0, newWidth, newHeight);

  // Z-order matches Python: woods → water → fairway → tee → green → sand → trees → contours
  drawPolygons(ctx, pixWoods,    colors.trees);    // woods use tree color
  drawPolygons(ctx, pixWater,    colors.water);
  drawPolygons(ctx, pixFairways, colors.fairway);
  drawPolygons(ctx, pixTeeBoxes, colors.teeBox);
  if (drawAll && pixAllGreens.length) drawPolygons(ctx, pixAllGreens, colors.green);
  if (adjGreen.length) drawPolygons(ctx, adjGreen, colors.green);
  drawPolygons(ctx, pixSand,     colors.sand);
  if (options.includeTrees) {
    // Tree radius scaled to ~5 yards in canvas-pixel space so it stays proportional
    // when the canvas covers a full course (large ypp) vs. a single hole (small ypp).
    drawTrees(ctx, pixTrees, colors.trees, Math.max(5, Math.round(5 / ypp)));
  }
  // Contours deferred to Phase 7

  // ── 8.5. Distance annotations ───────────────────────────────────────────────
  // Font size based on yards-per-pixel so labels stay proportional whether the
  // canvas covers one hole or an entire course.  Target: ~3 yards tall.
  const fontSize = Math.max(11, Math.round(3.5 / ypp));
  const textColor = colors.text;
  const effectivePar = par ?? 4;
  const showBg = options.textBackground !== false;

  if (effectivePar === 3) {
    // Par 3: show distances from tee boxes to green
    _drawGreenDistancesMin(ctx, adjHole, pixTeeBoxes, ypp, fontSize, textColor, options.inMeters, 1, showBg);
  } else {
    // Carry distances (tee → hazard)
    const { right: r1, left: l1 } = drawCarryDistances(ctx, adjHole, pixTeeBoxes, pixSand,  ypp, fontSize, textColor, options.inMeters, showBg);
    const { right: r2, left: l2 } = drawCarryDistances(ctx, adjHole, pixTeeBoxes, pixWater, ypp, fontSize, textColor, options.inMeters, showBg);
    const totalRight = r1 + r2;
    const totalLeft  = l1 + l2;
    drawExtraCarries(ctx, adjHole, pixTeeBoxes, totalRight, totalLeft, ypp, fontSize, textColor, options.inMeters, showBg);

    // Green distances (feature → green center)
    _drawGreenDistancesMin(ctx, adjHole, pixSand,      ypp, fontSize, textColor, options.inMeters, 0, showBg);
    _drawGreenDistancesMin(ctx, adjHole, pixWater,     ypp, fontSize, textColor, options.inMeters, 0, showBg);
    _drawGreenDistancesMax(ctx, adjHole, pixFairways,  ypp, fontSize, textColor, options.inMeters, showBg);
    if (options.includeTrees) {
      _drawGreenDistancesTree(ctx, adjHole, pixTrees, ypp, fontSize, textColor, options.inMeters, showBg);
    }

    // 50-yard arc rings
    drawArcDistances(ctx, adjHole, ypp, 50, fontSize, textColor, options.inMeters, showBg);
  }

  // ── 9. Compute crop bounds from feature extents ────────────────────────────
  // When drawAllFeatures is on, fairways use polygon-overlap filtering so they can
  // include features from adjacent holes — exclude them from bounds to keep the
  // crop the same as normal mode. Tee boxes, sand, and green use centroid filtering
  // and stay tightly scoped to this hole in both modes.
  const boundsArrays = drawAll
    ? [...pixTeeBoxes, ...pixSand, ...adjGreen]
    : [...pixFairways, ...pixTeeBoxes, ...pixSand, ...adjGreen];
  const bounds = _getArraysBounds(boundsArrays);
  const teeMaxY = _getArraysMaxY(pixTeeBoxes) ??
                  _getArraysMaxY([adjHole]) ??
                  newHeight;

  // Fallback when no features were found at all
  const bMinX = bounds?.minX ?? 0;
  const bMinY = bounds?.minY ?? 0;
  const bMaxX = bounds?.maxX ?? newWidth;

  const pad20 = 20 / ypp;
  const pad10 = 10 / ypp;
  const pad5  =  5 / ypp;

  let lbx = Math.max(0,        Math.round(bMinX  - pad20));
  let lby = Math.max(0,        Math.round(bMinY  - pad5 - 100));
  let ubx = Math.min(newWidth,  Math.round(bMaxX  + pad20 + 100));
  let uby = Math.min(newHeight, Math.round(teeMaxY + pad10 + 100));

  let cropW = ubx - lbx;
  let cropH = uby - lby;

  // Sanity guard
  if (cropW <= 0 || cropH <= 0) {
    lbx = 0; lby = 0; ubx = newWidth; uby = newHeight;
    cropW = newWidth; cropH = newHeight;
  }

  // ── 10. Pad / crop to 2.83:1 (height:width) portrait aspect ratio ──────────
  let finalW, finalH;
  if (cropH / cropW > 2.83) {
    finalH = cropH;
    finalW = Math.ceil(cropH / 2.83);
  } else {
    finalW = cropW;
    finalH = Math.ceil(2.83 * cropW);
  }

  const { canvas: outCanvas, ctx: outCtx } = createCanvas(finalW, finalH);
  outCtx.fillStyle = colors.rough;
  outCtx.fillRect(0, 0, finalW, finalH);

  const destX = Math.round((finalW - cropW) / 2);
  const destY = Math.round((finalH - cropH) / 2);
  outCtx.drawImage(rotCanvas, lbx, lby, cropW, cropH, destX, destY, cropW, cropH);
  rotCanvas.width = 1; rotCanvas.height = 1;  // release backing store

  return outCanvas;
}

/**
 * Render the green close-up inset.
 * Equivalent to the second pass of Python generateYardageBook() (green view).
 *
 * Uses a different rotation angle (approach angle, not full-hole angle) and
 * shows a ~30×39 yard area centered on the green with a 3-yard grid.
 *
 * @param {object} opts  — same shape as renderHole opts
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderGreenInset({ holeWay, features, bbox, colors, options, holeNum, par }) {
  // ── 1. Canvas dimensions (same as renderHole) ──────────────────────────────
  const { width, height } = getCanvasDimensions(bbox, MAX_CANVAS_PX);
  const ypp = getYardsPerPixel(bbox, width, height);
  const cx = width / 2, cy = height / 2;

  // ── 2. Convert features to pixel coords ────────────────────────────────────
  const toPixels = (nodeArrays) =>
    nodeArrays.map(nodes => wayToPixels(nodes, bbox, width, height));

  const holePixels = wayToPixels(holeWay.nodes, bbox, width, height);
  let pixFairways  = toPixels(features.fairways);
  let pixTeeBoxes  = toPixels(features.teeBoxes);
  let pixWater     = toPixels(features.waterHazards);
  let pixSand      = toPixels(features.sandTraps);
  let pixWoods     = toPixels(features.woods);
  let pixGreen     = features.green ? wayToPixels(features.green, bbox, width, height) : null;

  // ── 3. Approach angle: second-to-last → last node (front-to-back alignment) ─
  const angle = getMidpointAngle(holePixels);

  // ── 4. Rotate everything around original canvas center ─────────────────────
  const rotHole  = rotatePoints(holePixels, cx, cy, angle);
  pixFairways    = rotatePointsList(pixFairways, cx, cy, angle);
  pixTeeBoxes    = rotatePointsList(pixTeeBoxes, cx, cy, angle);
  pixWater       = rotatePointsList(pixWater,    cx, cy, angle);
  pixSand        = rotatePointsList(pixSand,     cx, cy, angle);
  pixWoods       = rotatePointsList(pixWoods,    cx, cy, angle);
  const rotGreen = pixGreen ? [rotatePoints(pixGreen, cx, cy, angle)] : [];

  // ── 5. New canvas size after rotation ──────────────────────────────────────
  const { newWidth, newHeight, offsetX, offsetY } = getRotatedCanvasSize(width, height, angle);

  // ── 6. Translate into new coordinate space ─────────────────────────────────
  const adj = (arrays) => translateFeatures(arrays, -offsetX, -offsetY);

  pixFairways = adj(pixFairways);
  pixTeeBoxes = adj(pixTeeBoxes);
  pixWater    = adj(pixWater);
  pixSand     = adj(pixSand);
  pixWoods    = adj(pixWoods);
  const adjGreen = adj(rotGreen);
  const adjHole  = translateFeatures([rotHole], -offsetX, -offsetY)[0];

  // ── 7. Filter features ─────────────────────────────────────────────────────
  // Green inset: sand/water/woods are unfiltered (matches Python second pass)
  const drawAll = !!options.drawAllFeatures;
  const fBase = {
    filterYards: options.holeWidth,
    shortFactor: options.shortFilter,
    medFactor:   (options.shortFilter + 1) / 2,
    drawAllFeatures: drawAll,
  };
  pixFairways = filterFeatures(adjHole, pixFairways, ypp, par, { ...fBase, isFairway: true });
  pixTeeBoxes = filterFeatures(adjHole, pixTeeBoxes, ypp, par, { ...fBase, isTeeBox: true });
  pixSand     = filterFeatures(adjHole, pixSand,     ypp, par, { filterYards: null });
  pixWoods    = filterFeatures(adjHole, pixWoods,    ypp, par, { filterYards: null });
  pixWater    = filterFeatures(adjHole, pixWater,    ypp, par, { filterYards: null });

  // ── 8. Draw in grayscale (B&W style, matches Python second pass) ────────────
  const { canvas: rotCanvas, ctx } = createCanvas(newWidth, newHeight);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, newWidth, newHeight);

  // Z-order matches Python: woods → water → fairway → tee → green (+ outline) → sand
  drawPolygons(ctx, pixWoods,    '#B4B4B4');   // (180,180,180)
  drawPolygons(ctx, pixWater,    '#B4B4B4');   // (180,180,180)
  drawPolygons(ctx, pixFairways, '#EBEBEB');   // (235,235,235)
  drawPolygons(ctx, pixTeeBoxes, '#C3C3C3');   // (195,195,195)
  if (adjGreen.length) {
    // Fill white, then draw black outline — equivalent to Python line=2 (fillPoly + polylines)
    drawPolygons(ctx, adjGreen, '#FFFFFF');
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    for (const poly of adjGreen) {
      if (poly.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
  }
  drawPolygons(ctx, pixSand, '#D2D2D2');       // (210,210,210)

  // ── 9. Draw 3-yard grid centered on green, get crop window ─────────────────
  const greenCenter = adjHole[adjHole.length - 1];
  const { xmin, ymin, xmax, ymax, lineThickness } = drawGreenGrid(ctx, greenCenter, ypp);

  // ── 10. Crop to green window and add border ─────────────────────────────────
  const cropX = Math.max(0, xmin);
  const cropY = Math.max(0, ymin);
  const cropW = Math.min(newWidth, xmax) - cropX;
  const cropH = Math.min(newHeight, ymax) - cropY;

  if (cropW <= 0 || cropH <= 0) return rotCanvas;  // fallback: return full canvas

  // Border: 1–2px gray strip all around (cv2.copyMakeBorder equivalent)
  const bw = lineThickness;
  const finalW = cropW + bw * 2;
  const finalH = cropH + bw * 2;

  const { canvas: outCanvas, ctx: outCtx } = createCanvas(finalW, finalH);
  outCtx.fillStyle = '#8C8C8C';    // (140,140,140) border color
  outCtx.fillRect(0, 0, finalW, finalH);
  outCtx.drawImage(rotCanvas, cropX, cropY, cropW, cropH, bw, bw, cropW, cropH);
  rotCanvas.width = 1; rotCanvas.height = 1;  // release backing store

  return outCanvas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing Primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill polygons on a canvas context.
 * Equivalent to Python: drawFeatures() using cv2.fillPoly()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<[number, number]>>} polygons  — array of point arrays
 * @param {string} color   — hex color string
 */
export function drawPolygons(ctx, polygons, color) {
  ctx.fillStyle = color;
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Draw polylines (open paths) on a canvas context.
 * Equivalent to Python: drawContourLines() using cv2.polylines()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<[number, number]>>} polylines
 * @param {string} color
 * @param {number} lineWidth  — default 2
 */
export function drawPolylines(ctx, polylines, color, lineWidth = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of polylines) {
    if (line.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) {
      ctx.lineTo(line[i][0], line[i][1]);
    }
    ctx.stroke();
  }
}

/**
 * Draw individual tree symbols (circle with X pattern).
 * Equivalent to Python: drawTrees()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} positions   — [x, y] pixel pairs
 * @param {string} color
 * @param {number} radius  — circle radius in pixels
 */
export function drawTrees(ctx, positions, color, radius = 8) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;

  for (const [x, y] of positions) {
    // Circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // X pattern (6 lines at 60° intervals like the Python version)
    ctx.strokeStyle = darkenColor(color, 0.6);
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI) / 3;
      const dx = Math.cos(angle) * radius * 0.75;
      const dy = Math.sin(angle) * radius * 0.75;
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
    }
    ctx.strokeStyle = color;
  }
}

/**
 * Draw a text label, optionally with a white background rectangle.
 * Equivalent to Python's cv2.putText with background rectangle.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} fontSize  — pixels
 * @param {string} color     — hex text color
 * @param {'left'|'center'|'right'} align
 * @param {boolean} [showBg=true]  — draw semi-transparent white background behind text
 */
export function drawLabel(ctx, text, x, y, fontSize, color, align = 'center', showBg = true) {
  ctx.font = `400 ${fontSize}px sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  if (showBg) {
    const metrics = ctx.measureText(text);
    const padX = 4, padY = 3;
    const w = metrics.width + padX * 2;
    const h = fontSize + padY * 2;
    const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const by = y - h / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(bx, by, w, h);
  }

  // Text
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Draw semi-transparent contour lines with alpha blending.
 * Equivalent to Python's cv2.addWeighted(overlay, 0.5, image, 0.5, ...) approach.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<[number, number]>>} contours
 * @param {string} color
 * @param {number} alpha  — 0–1
 * @param {number} lineWidth
 */
export function drawContours(ctx, contours, color, alpha = 0.5, lineWidth = 2) {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawPolylines(ctx, contours, color, lineWidth);
  ctx.restore();
}

/**
 * Draw the 3-yard green grid for the inset view.
 * Equivalent to Python: getGreenGrid()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number, number]} greenCenter  — [x, y] green center pixel
 * @param {number} yardsPerPixel
 * @param {number} gridRangeYards  — grid extent (default 18 yds each side)
 */
/**
 * Draw the 3-yard grid for the green inset and return crop bounds.
 * Equivalent to Python: getGreenGrid()
 *
 * Draws:
 *   - A 1-yard filled square at the green center
 *   - Vertical lines every 3 yards across the crop window
 *   - Horizontal lines every 3 yards across the crop window
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number, number]} greenCenter  — [x, y] pixel coords of the green center
 * @param {number} ypp                    — yards per pixel
 * @returns {{ xmin, ymin, xmax, ymax, lineThickness }}  crop window + border width
 */
export function drawGreenGrid(ctx, greenCenter, ypp) {
  const [gx, gy] = greenCenter;
  const step = 3 / ypp;   // pixels between grid lines

  // Crop window: ±30 yards horizontally, -30 above / +39 below green center
  const xmin = Math.round(gx - 30 / ypp);
  const xmax = Math.round(gx + 30 / ypp);
  const ymin = Math.round(gy - 30 / ypp);
  const ymax = Math.round(gy + 39 / ypp);

  const w = xmax - xmin;

  // Match Python: thickness=2 when width > 850px, else 1
  const lineThickness = w > 850 ? 2 : 1;

  // Center dot: 1-yard square (±0.5 yards) filled black
  const dotHalf = Math.max(1, Math.round(0.5 / ypp));
  ctx.fillStyle = '#000000';
  ctx.fillRect(
    Math.round(gx) - dotHalf,
    Math.round(gy) - dotHalf,
    dotHalf * 2,
    dotHalf * 2,
  );

  ctx.strokeStyle = '#8C8C8C';   // rgb(140,140,140)
  ctx.lineWidth = lineThickness;

  // Vertical lines — from center rightward (inclusive) then leftward
  let lx = gx;
  while (lx < xmax) {
    ctx.beginPath();
    ctx.moveTo(Math.round(lx), ymin);
    ctx.lineTo(Math.round(lx), ymax);
    ctx.stroke();
    lx += step;
  }
  lx = gx - step;
  while (lx > xmin) {
    ctx.beginPath();
    ctx.moveTo(Math.round(lx), ymin);
    ctx.lineTo(Math.round(lx), ymax);
    ctx.stroke();
    lx -= step;
  }

  // Horizontal lines — from center downward (inclusive) then upward
  let ly = gy;
  while (ly < ymax) {
    ctx.beginPath();
    ctx.moveTo(xmin, Math.round(ly));
    ctx.lineTo(xmax, Math.round(ly));
    ctx.stroke();
    ly += step;
  }
  ly = gy - step;
  while (ly > ymin) {
    ctx.beginPath();
    ctx.moveTo(xmin, Math.round(ly));
    ctx.lineTo(xmax, Math.round(ly));
    ctx.stroke();
    ly -= step;
  }

  return { xmin, ymin, xmax, ymax, lineThickness };
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance Annotations — Private Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract holeOrigin, midpoint, greenCenter from the adjusted hole centerline array.
 * Equivalent to Python: getThreeWaypoints()
 */
function _getThreeWaypoints(holeCenterline) {
  let holeOrigin  = holeCenterline[0];
  let greenCenter = holeCenterline[holeCenterline.length - 1];

  // Guard against near-vertical lines to prevent divide-by-zero in line math
  if (Math.abs(holeOrigin[0] - greenCenter[0]) < 0.00001) {
    greenCenter = [greenCenter[0] + 0.001, greenCenter[1]];
  }

  const midpoint = holeCenterline.length === 2
    ? [(holeOrigin[0] + greenCenter[0]) / 2, (holeOrigin[1] + greenCenter[1]) / 2]
    : holeCenterline[1];

  return { holeOrigin, midpoint, greenCenter };
}

/** Point with smallest y (closest to top = closest to green after rotation). Python: getMaxPoints() */
function _getMinYPoint(polygon) {
  let best = polygon[0];
  for (const p of polygon) { if (p[1] < best[1]) best = p; }
  return best;
}

/** Point with largest y (closest to bottom = closest to tee after rotation). Python: getMinPoints() */
function _getMaxYPoint(polygon) {
  let best = polygon[0];
  for (const p of polygon) { if (p[1] > best[1]) best = p; }
  return best;
}

/** Euclidean pixel distance */
function _pixDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

/** Yard distance between two pixel points */
function _yardDist(a, b, ypp) {
  return _pixDist(a, b) * ypp;
}

/** Convert yards to display units */
function _displayDist(yards, inMeters) {
  return Math.round(inMeters ? yards * 0.9144 : yards);
}

/** Slope and intercept of the line through p1 and p2. Returns {vertical, slope, intercept}. */
function _getLine(p1, p2) {
  const dx = p2[0] - p1[0];
  if (Math.abs(dx) < 1e-10) return { vertical: true, x: p1[0] };
  const slope     = (p2[1] - p1[1]) / dx;
  const intercept = p1[1] - slope * p1[0];
  return { vertical: false, slope, intercept };
}

/**
 * Angle (degrees) from greenCenter toward otherPoint, used for arc rotation.
 * Equivalent to Python: getAngle(green_center, other_point)
 */
function _getAngle(greenCenter, otherPoint) {
  const [x,  y ] = greenCenter;
  const [x2, y2] = otherPoint;
  const bigy   = Math.max(y, y2);
  const smally = Math.min(y, y2);
  const denom  = Math.sqrt((x2 - x) ** 2 + (bigy - smally) ** 2);
  if (denom < 1e-10) return 0;
  let angle = (Math.acos(Math.max(-1, Math.min(1, (bigy - smally) / denom))) * 180) / Math.PI;
  if      (y > y2 && x > x2) angle = 180 - angle;
  else if (y > y2 && x < x2) angle = 180 + angle;
  else if (y < y2 && x < x2) angle = 360 - angle;
  return angle;
}

/**
 * Find the point on segment (midpoint → originPoint) that is `distYards` from greenCenter.
 * Used to find where an arc distance ring intersects the hole centerline.
 * Equivalent to Python: getPointOnOtherLine()
 *
 * Returns [x, y] or null if no valid intersection found.
 */
function _getPointOnOtherLine(originPoint, midpoint, greenCenter, distYards, ypp) {
  const distance = distYards / ypp;           // convert to pixels
  const [x0, y0] = greenCenter;
  const [x1, y1] = midpoint;
  const [x2, y2] = originPoint;

  // Implicit line through (x1,y1) and (x2,y2): A*x + B*y + C = 0
  const A = y2 - y1;
  const B = x1 - x2;
  const C = x2 * y1 - x1 * y2;

  if (Math.abs(B) < 3 && B > -3) return null;

  // Quadratic: intersection of the line with circle(center=greenCenter, r=distance)
  const qa = A ** 2 + B ** 2;
  const qb = 2*A*C + 2*A*B*y0 - 2*(B**2)*x0;
  const qc = C**2 + 2*B*C*y0 - (B**2) * (distance**2 - x0**2 - y0**2);
  const disc = qb**2 - 4*qa*qc;
  if (disc < 0) return null;

  let xInt = (-qb + Math.sqrt(disc)) / (2 * qa);
  let yInt = -((A * xInt + C) / B);

  // Check if intersection lies on the segment; if not, use the other root
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  if (!(xInt > minX && xInt < maxX && yInt > minY && yInt < maxY)) {
    xInt = (-qb - Math.sqrt(disc)) / (2 * qa);
    yInt = -((A * xInt + C) / B);
  }

  return [Math.round(xInt), Math.round(yInt)];
}

/** Draw a filled triangle marker (pointing up) centered on `point`. Python: drawTriangle() */
function _drawTriangle(ctx, [x, y], base, height, color) {
  ctx.fillStyle   = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - height / 2);
  ctx.lineTo(x - base / 2, y + height / 2);
  ctx.lineTo(x + base / 2, y + height / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Draw a distance label below a point. Python: drawDistanceText() */
function _drawDistanceText(ctx, distance, [x, y], fontSize, textColor, showBg = true) {
  const labelY = y + Math.round(fontSize * 0.9);
  drawLabel(ctx, String(distance), x, labelY, fontSize, textColor, 'center', showBg);
}

/** Draw a filled dot. Python: drawMarkerPoints() / cv2.circle() */
function _drawDot(ctx, [x, y], radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw carry distance labels for a single carry point.
 * Equivalent to Python: drawCarry()
 * Returns 1 if this is a "reference quality" carry (useful midrange distance), else 0.
 */
function _drawCarry(ctx, greenCenter, carryPoint, teeBoxPoints, ypp, fontSize, textColor, right, inMeters, showBg = true) {
  if (teeBoxPoints.length === 0) return 0;

  const distYardsList = teeBoxPoints.map(tee => _yardDist(tee, carryPoint, ypp));
  const maxDistYards  = Math.max(...distYardsList);

  // Only show carries in the useful tee-shot range
  if (maxDistYards < 185 || maxDistYards > 325) return 0;

  const distList = distYardsList
    .map(d => _displayDist(d, inMeters))
    .sort((a, b) => a - b);

  // Vertical stacking: one distance per tee color (sorted low→high)
  const lineSpacing = Math.round(fontSize * 1.6);
  const totalH      = lineSpacing * (distList.length - 1);
  const dotR        = Math.max(3, Math.round(1 / ypp));
  const xOff        = Math.round(10 * (fontSize / 30 + 0.1) + 5);

  // Measure label width for left-side placement
  ctx.font = `400 ${fontSize}px sans-serif`;
  const approxW = ctx.measureText(String(distList[distList.length - 1])).width;

  const baseX = right
    ? Math.round(carryPoint[0] + xOff)
    : Math.round(carryPoint[0] - xOff - approxW);
  let y = Math.round(carryPoint[1] - totalH / 2);

  for (const d of distList) {
    const label = String(d);
    const lw = ctx.measureText(label).width;
    const padX = 4, padY = 3;
    if (showBg) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(baseX - padX, y - fontSize / 2 - padY, lw + padX * 2, fontSize + padY * 2);
    }
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, baseX, y);
    y += lineSpacing;
  }

  // Dot at carry point and tee box points
  _drawDot(ctx, carryPoint, dotR, textColor);
  for (const tee of teeBoxPoints) _drawDot(ctx, tee, dotR, textColor);

  // "Reference" carry: within a useful distance window and not right next to green
  const dtg = _yardDist(greenCenter, carryPoint, ypp);
  if (dtg < 40 || maxDistYards < 215 || maxDistYards > 290) return 0;
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance Annotations — Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw carry distance labels from tee boxes to hazards.
 * Equivalent to Python: drawCarryDistances()
 *
 * Labels shown for carries 185–325 yards, placed left or right of feature.
 * Skips if within 20 yards of a previously drawn carry.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline  — adjusted hole centerline pixels
 * @param {Array<Array<[number, number]>>} teeBoxes
 * @param {Array<Array<[number, number]>>} carries   — hazard/feature polygons to measure to
 * @param {number} ypp    — yards per pixel
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} [inMeters=false]
 * @param {boolean} [showBg=true]  — draw white background behind labels
 * @returns {{ right: number, left: number }}  count of "reference" carries drawn on each side
 */
export function drawCarryDistances(ctx, holeCenterline, teeBoxes, carries, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (!carries.length || !teeBoxes.length) return { right: 0, left: 0 };

  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const carryPoints  = carries .map(poly => _getMinYPoint(poly));    // green-side edge
  const teeBoxPoints = teeBoxes.map(poly => _getMaxYPoint(poly));    // tee-side edge

  let rightCarries = 0, leftCarries = 0;
  const drawnCarries = [];

  for (const carry of carryPoints) {
    // Skip if too close to a previously drawn carry
    if (drawnCarries.some(past => _yardDist(carry, past, ypp) < 20)) continue;

    // Check distance from this carry to the hole centerline
    const refA = carry[1] < midpoint[1] ? midpoint   : holeOrigin;
    const refB = carry[1] < midpoint[1] ? greenCenter : midpoint;
    if (distToLine(carry, refA, refB, ypp) > 40) continue;

    // Determine which side of the centerline this carry falls on
    const lineInfo = _getLine(refA, refB);
    let right = true;
    if (!lineInfo.vertical) {
      const xOnLine = (carry[1] - lineInfo.intercept) / lineInfo.slope;
      if (carry[0] < xOnLine) right = false;
    }

    const count = _drawCarry(ctx, greenCenter, carry, teeBoxPoints, ypp, fontSize, textColor, right, inMeters, showBg);
    if (right) rightCarries += count;
    else       leftCarries  += count;
    drawnCarries.push(carry);
  }

  return { right: rightCarries, left: leftCarries };
}

/**
 * Draw a fallback carry when no hazard carries were found.
 * Places a synthetic carry point on the centerline so every hole shows a distance scale.
 * Equivalent to Python: drawExtraCarries()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline
 * @param {Array<Array<[number, number]>>} teeBoxes
 * @param {number} rightCarries  — existing right-side carries
 * @param {number} leftCarries   — existing left-side carries
 * @param {number} ypp
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} [inMeters=false]
 * @param {boolean} [showBg=true]
 */
export function drawExtraCarries(ctx, holeCenterline, teeBoxes, rightCarries, leftCarries, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (rightCarries + leftCarries > 0) return;
  if (!teeBoxes.length) return;

  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const teeBoxPoints  = teeBoxes.map(poly => _getMaxYPoint(poly));
  const holeLenYards  = _yardDist(holeOrigin, greenCenter, ypp);

  // Choose a carry distance proportional to hole length
  let carryY;
  if      (holeLenYards < 380) carryY = greenCenter[1] + ( 95 / ypp);
  else if (holeLenYards < 430) carryY = greenCenter[1] + (145 / ypp);
  else if (holeLenYards < 480) carryY = greenCenter[1] + (195 / ypp);
  else                          carryY = holeOrigin[1]  - (230 / ypp);

  const lineInfo = (midpoint[1] > carryY)
    ? _getLine(midpoint, greenCenter)
    : _getLine(midpoint, holeOrigin);

  if (lineInfo.vertical) return;
  const baseX = (carryY - lineInfo.intercept) / lineInfo.slope;

  // Place carry 20 yards off-center, on the appropriate side
  const goRight = midpoint[0] >= greenCenter[0];
  const carry   = [baseX + (goRight ? 20 : -20) / ypp, carryY];

  _drawCarry(ctx, greenCenter, carry, teeBoxPoints, ypp, fontSize, textColor, goRight, inMeters, showBg);
}

/**
 * Draw distance-to-green labels from the far (tee-side) edge of features.
 * Equivalent to Python: drawGreenDistancesMin()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline
 * @param {Array<Array<[number, number]>>} features
 * @param {number} ypp
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} [inMeters=false]
 * @param {0|1} [par3Tees=0]  — 1 when called for par-3 tee boxes (relaxes max-distance filter)
 */
function _drawGreenDistancesMin(ctx, holeCenterline, features, ypp, fontSize, textColor, inMeters = false, par3Tees = 0, showBg = true) {
  if (!features.length) return;

  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const holeDistYards = _yardDist(holeOrigin, greenCenter, ypp);
  const drawnPoints   = [];
  const base          = Math.max(4, Math.round(2 / ypp));
  const triH          = Math.round((3 / 5) * base);

  for (const poly of features) {
    const point       = _getMaxYPoint(poly);   // tee-side (far) edge
    const distYards   = _yardDist(point, greenCenter, ypp);

    if (distYards < 40 || distYards > 305) continue;
    if (!par3Tees && distYards > 0.75 * holeDistYards) continue;

    if (drawnPoints.some(past => _yardDist(point, past, ypp) < 15)) continue;

    // Check distance from centerline
    const refA = point[1] < midpoint[1] ? midpoint   : holeOrigin;
    const refB = point[1] < midpoint[1] ? greenCenter : midpoint;
    if (distToLine(point, refA, refB, ypp) > 40) continue;

    _drawTriangle(ctx, point, base, triH, textColor);
    _drawDistanceText(ctx, _displayDist(distYards, inMeters), point, fontSize, textColor, showBg);
    drawnPoints.push(point);
  }
}

/**
 * Draw distance-to-green labels from the near (green-side) edge of features.
 * Equivalent to Python: drawGreenDistancesMax()
 */
function _drawGreenDistancesMax(ctx, holeCenterline, features, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (!features.length) return;

  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const holeDistYards = _yardDist(holeOrigin, greenCenter, ypp);
  const base          = Math.max(4, Math.round(2 / ypp));
  const triH          = Math.round((3 / 5) * base);

  for (const poly of features) {
    const point     = _getMinYPoint(poly);   // green-side (near) edge
    const distYards = _yardDist(point, greenCenter, ypp);

    if (distYards < 40 || distYards > 0.75 * holeDistYards) continue;

    const refA = point[1] < midpoint[1] ? midpoint   : holeOrigin;
    const refB = point[1] < midpoint[1] ? greenCenter : midpoint;
    if (distToLine(point, refA, refB, ypp) > 40) continue;

    _drawTriangle(ctx, point, base, triH, textColor);
    _drawDistanceText(ctx, _displayDist(distYards, inMeters), point, fontSize, textColor, showBg);
  }
}

/**
 * Draw distance-to-green labels for individual trees, with a leader line.
 * Equivalent to Python: drawGreenDistancesTree()
 */
function _drawGreenDistancesTree(ctx, holeCenterline, trees, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  if (!trees.length) return;

  const { holeOrigin, midpoint, greenCenter } = _getThreeWaypoints(holeCenterline);
  const holeDistYards = _yardDist(holeOrigin, greenCenter, ypp);
  const drawnPoints   = [];
  const lineLen       = Math.max(20, Math.round(8 / ypp));   // ~8 yards

  for (const point of trees) {
    const distYards = _yardDist(point, greenCenter, ypp);

    if (distYards < 40) continue;
    if (distYards > 0.75 * holeDistYards) continue;

    // Skip if distance is very close to a 50-yard mark (those are shown by arcs)
    const mod50 = distYards % 50;
    if (mod50 < 7 || mod50 > 43) continue;

    if (drawnPoints.some(past => _yardDist(point, past, ypp) < 20)) continue;

    const refA = point[1] < midpoint[1] ? midpoint   : holeOrigin;
    const refB = point[1] < midpoint[1] ? greenCenter : midpoint;
    if (distToLine(point, refA, refB, ypp) > 25) continue;

    // Determine left/right side to place the label
    const lineInfo = _getLine(refA, refB);
    let right = true;
    if (!lineInfo.vertical) {
      const xOnLine = (point[1] - lineInfo.intercept) / lineInfo.slope;
      if (point[0] < xOnLine) right = false;
    }

    // Leader line from tree toward label
    ctx.strokeStyle = textColor;
    ctx.lineWidth   = 1;
    if (right) {
      ctx.beginPath();
      ctx.moveTo(point[0], point[1]);
      ctx.lineTo(point[0] - lineLen, point[1]);
      ctx.stroke();
      drawLabel(ctx, String(_displayDist(distYards, inMeters)),
        point[0] - lineLen - 4, point[1], fontSize, textColor, 'right', showBg);
    } else {
      ctx.beginPath();
      ctx.moveTo(point[0], point[1]);
      ctx.lineTo(point[0] + lineLen, point[1]);
      ctx.stroke();
      drawLabel(ctx, String(_displayDist(distYards, inMeters)),
        point[0] + lineLen + 4, point[1], fontSize, textColor, 'left', showBg);
    }

    drawnPoints.push(point);
  }
}

/**
 * Draw 50-yard arc distance rings from green center outward along the fairway.
 * Handles straight holes and doglegs (up to 4 waypoints).
 * Equivalent to Python: drawGreenDistancesAnyWaypoint() / drawFarGreenDistances()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline
 * @param {number} ypp
 * @param {number} startDist  — first arc distance in yards (typically 50)
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} [inMeters=false]
 * @param {boolean} [showBg=true]
 */
export function drawArcDistances(ctx, holeCenterline, ypp, startDist, fontSize, textColor, inMeters = false, showBg = true) {
  // Arc half-angle (degrees) indexed by yard distance — tighter arcs for longer distances
  const ANGLE_OFFSETS = { 50: 30, 100: 15.2, 150: 9.8, 200: 7.5, 250: 6, 300: 5, 350: 4.6 };

  // Build the ordered list of centerline segments from green outward
  // holeCenterline: [holeOrigin, ...midpoints, greenCenter]
  const pts = holeCenterline;
  if (pts.length < 2) return;

  const greenCenter = pts[pts.length - 1];

  // Cumulative distances from green center to each waypoint
  const segDists = [];   // segDists[i] = yards from green to pts[pts.length-2-i]
  for (let i = pts.length - 2; i >= 0; i--) {
    const prev = i === pts.length - 2 ? greenCenter : pts[i + 1];
    const d    = (segDists.length === 0 ? 0 : segDists[segDists.length - 1])
               + _yardDist(pts[i], prev, ypp);
    segDists.push(d);
  }
  // segDists[k] = yards from green to pts[pts.length-2-k]

  // Total hole length limit — matches Python's hole_length_limit calculation
  const totalLen     = segDists[segDists.length - 1];
  const midpointDist = segDists[0];   // yards from green to first inner waypoint
  const holeLenLimit = Math.min(350, Math.max(midpointDist, Math.max(totalLen * 0.6, totalLen - 200)));

  let drawDist = startDist;

  const drawArc = (drawpoint, pixelDist, offset) => {
    if (!drawpoint) return;
    const angle      = _getAngle(greenCenter, drawpoint);
    const drawnAngle = angle + 90;
    const startRad   = (drawnAngle - offset) * Math.PI / 180;
    const endRad     = (drawnAngle + offset) * Math.PI / 180;

    ctx.strokeStyle = textColor;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(greenCenter[0], greenCenter[1], pixelDist, startRad, endRad);
    ctx.stroke();

    _drawDistanceText(ctx, _displayDist(drawDist, inMeters), drawpoint, fontSize, textColor, showBg);
  };

  // Draw arcs segment by segment, from green outward
  for (let seg = 0; seg < pts.length - 1; seg++) {
    // Segment goes from pts[pts.length-2-seg] to pts[pts.length-1-seg]
    const segStart = pts[pts.length - 2 - seg];
    const segEnd   = pts[pts.length - 1 - seg];
    const segLimit = segDists[seg];           // yards from green to start of this segment

    while (drawDist < segLimit && drawDist <= holeLenLimit) {
      const offset    = ANGLE_OFFSETS[drawDist] ?? 4;
      const pixelDist = Math.round(drawDist / ypp);
      // Reference point: intersection of the arc circle with the current segment
      const drawpoint = _getPointOnOtherLine(segStart, segEnd, greenCenter, drawDist, ypp);
      drawArc(drawpoint, pixelDist, offset);
      drawDist += 50;
    }

    if (drawDist > holeLenLimit) break;
  }
}

/**
 * Draw feature-to-green distance labels (far edge = farthest from green).
 * Thin wrapper used by the public API and generator.
 * Equivalent to Python: drawGreenDistancesMin()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline
 * @param {[number, number]} _greenCenter  — unused; derived from holeCenterline
 * @param {Array<Array<[number, number]>>} features
 * @param {number} ypp
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} [inMeters=false]
 */
export function drawGreenDistances(ctx, holeCenterline, _greenCenter, features, ypp, fontSize, textColor, inMeters = false, showBg = true) {
  _drawGreenDistancesMin(ctx, holeCenterline, features, ypp, fontSize, textColor, inMeters, 0, showBg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a canvas element. Uses OffscreenCanvas if available (better performance),
 * otherwise falls back to a regular Canvas element.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{ canvas, ctx }}
 */
export function createCanvas(width, height) {
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

/**
 * Convert a canvas to a data URL for embedding in jsPDF or an <img>.
 *
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @returns {Promise<string>}  data URL (image/png)
 */
export async function canvasToDataUrl(canvas) {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }
  return canvas.toDataURL('image/png');
}

/**
 * Calculate the rotated bounding box dimensions after rotating by angleDeg.
 * Used to determine the new canvas size after rotation.
 * Equivalent to Python: getNewImage()
 *
 * @param {number} width
 * @param {number} height
 * @param {number} angleDeg
 * @returns {{ newWidth, newHeight, offsetX, offsetY }}
 */
export function getRotatedCanvasSize(width, height, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newWidth  = Math.ceil(width * cos + height * sin);
  const newHeight = Math.ceil(width * sin + height * cos);
  const offsetX = (newWidth  - width)  / 2;
  const offsetY = (newHeight - height) / 2;
  return { newWidth, newHeight, offsetX, offsetY };
}

// ─────────────────────────────────────────────────────────────────────────────
// Color Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a hex color string to [r, g, b] (0-255).
 *
 * @param {string} hex   — e.g. '#34E884' or '34E884'
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Darken a hex color by a factor (0 = black, 1 = original).
 */
function darkenColor(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  const d = (c) => Math.max(0, Math.round(c * factor));
  return `rgb(${d(r)}, ${d(g)}, ${d(b)})`;
}

/**
 * Get min/max x and y across all arrays of [x,y] points.
 * Returns null if arrays is empty.
 *
 * @param {Array<Array<[number, number]>>} arrays
 * @returns {{ minX, minY, maxX, maxY } | null}
 */
function _getArraysBounds(arrays) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const arr of arrays) {
    for (const [x, y] of arr) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      found = true;
    }
  }
  return found ? { minX, minY, maxX, maxY } : null;
}

/**
 * Get the maximum y value across all arrays (used to find tee bottom edge).
 * Returns null if arrays is empty.
 *
 * @param {Array<Array<[number, number]>>} arrays
 * @returns {number | null}
 */
function _getArraysMaxY(arrays) {
  let maxY = -Infinity;
  let found = false;
  for (const arr of arrays) {
    for (const [, y] of arr) {
      if (y > maxY) { maxY = y; found = true; }
    }
  }
  return found ? maxY : null;
}
