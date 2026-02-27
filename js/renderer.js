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
 * TODO (Phase 3): Implement renderHole, renderGreenInset, and all draw* helpers.
 */

import { rotatePoints, rotatePointsList, translateFeatures, getRotateAngle, getYardsPerPixel, getCanvasDimensions } from './coords.js';

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
  // TODO (Phase 3): Implement full rendering pipeline:
  //
  // 1. getCanvasDimensions(bbox) → { width, height }
  // 2. Create OffscreenCanvas (fallback: document.createElement('canvas'))
  // 3. wayToPixels(holeWay.nodes, bbox, w, h) → holePixels
  // 4. Convert all feature arrays to pixels via wayToPixels
  // 5. getRotateAngle(holePixels) → angleDeg
  // 6. rotatePointsList(allFeatures, w/2, h/2, angleDeg)
  // 7. getNewCanvasSize(w, h, angleDeg) → { newW, newH, offsetX, offsetY }
  // 8. translateFeatures(rotatedFeatures, offsetX, offsetY)
  // 9. filterFeatures(...) per feature type
  // 10. Fill canvas with rough color
  // 11. Draw all features in Z-order
  // 12. Draw contours if elevationGrid provided
  // 13. Draw distance annotations
  // 14. Crop to 2.83:1 aspect ratio (landscape legal)
  //
  // Return the canvas element.

  throw new Error('renderHole not yet implemented (Phase 3)');
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
  // TODO (Phase 5): Implement green inset rendering
  throw new Error('renderGreenInset not yet implemented (Phase 5)');
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
 * Draw a text label with a white background rectangle.
 * Equivalent to Python's cv2.putText with background rectangle.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} fontSize  — pixels
 * @param {string} color     — hex text color
 * @param {'left'|'center'|'right'} align
 */
export function drawLabel(ctx, text, x, y, fontSize, color, align = 'center') {
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const metrics = ctx.measureText(text);
  const padX = 4, padY = 3;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;
  const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const by = y - h / 2;

  // White background
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(bx, by, w, h);

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
export function drawGreenGrid(ctx, greenCenter, yardsPerPixel, gridRangeYards = 18) {
  // TODO (Phase 5): Implement
  // Python draws lines every 3 yards across ~30×39 yard area
  // Center dot at green center
  throw new Error('drawGreenGrid not yet implemented (Phase 5)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance Annotations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw carry distance labels from tee boxes to hazards.
 * Equivalent to Python: drawCarryDistances()
 *
 * Carries shown: 185–325 yards. Labels placed left/right of feature.
 * Avoids crowding: skips if within 20 yards of previous carry.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline  — rotated hole pixels
 * @param {Array<Array<[number, number]>>} teeBoxes
 * @param {Array<Array<[number, number]>>} carries   — features to measure to
 * @param {number} yardsPerPixel
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} inMeters
 */
export function drawCarryDistances(ctx, holeCenterline, teeBoxes, carries, yardsPerPixel, fontSize, textColor, inMeters) {
  // TODO (Phase 4): Implement
  // Port Python drawCarryDistances()
  throw new Error('drawCarryDistances not yet implemented (Phase 4)');
}

/**
 * Draw feature-to-green distance labels.
 * Equivalent to Python: drawGreenDistancesMin() / drawGreenDistancesMax()
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline
 * @param {[number, number]} greenCenter
 * @param {Array<Array<[number, number]>>} features
 * @param {number} yardsPerPixel
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} inMeters
 */
export function drawGreenDistances(ctx, holeCenterline, greenCenter, features, yardsPerPixel, fontSize, textColor, inMeters) {
  // TODO (Phase 4): Implement
  // Port Python drawGreenDistancesMin() / drawGreenDistancesMax()
  throw new Error('drawGreenDistances not yet implemented (Phase 4)');
}

/**
 * Draw 50-yard arc distance rings from the green.
 * Equivalent to Python: drawFarGreenDistances()
 *
 * Draws elliptical arcs every 50 yards from green center.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number, number]>} holeCenterline
 * @param {number} yardsPerPixel
 * @param {number} drawDist   — maximum distance to draw arcs
 * @param {number} fontSize
 * @param {string} textColor
 * @param {boolean} inMeters
 */
export function drawArcDistances(ctx, holeCenterline, yardsPerPixel, drawDist, fontSize, textColor, inMeters) {
  // TODO (Phase 4): Implement
  // Port Python drawFarGreenDistances()
  // cv2.ellipse → canvas arc with appropriate scaling
  throw new Error('drawArcDistances not yet implemented (Phase 4)');
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
 *
 * @param {string} hex
 * @param {number} factor  — 0–1
 * @returns {string}  hex color string
 */
function darkenColor(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  const d = (c) => Math.max(0, Math.round(c * factor));
  return `rgb(${d(r)}, ${d(g)}, ${d(b)})`;
}
