/**
 * elevation.js — Elevation data fetching and contour extraction
 *
 * Browser replacement for Python's py3dep + scipy + cv2 approach.
 *
 * Strategy:
 *   1. Sample a 50×50 grid of (lat, lon) points across the bounding box
 *   2. Batch POST to Open-Topo-Data API (max 100 pts/req → 25 requests)
 *      Endpoint: https://api.opentopodata.org/v1/ned10m
 *      Dataset: ned10m = USGS National Elevation Dataset 1/3 arc-second (~10m)
 *      Coverage: Continental US only (same limitation as py3dep 3DEP)
 *   3. Bilinear-interpolate sparse grid → full pixel-density grid
 *   4. Use d3-contour (window.d3 from CDN) for marching squares contour extraction
 *   5. Return contour ring arrays in pixel coordinates
 *
 * For uphill tick marks, port Python getContourTicks():
 *   For each tick position along a contour, sample elevation ±4px perpendicularly,
 *   determine uphill direction, return position + unit vector.
 *
 * TODO (Phase 7): Implement all functions below.
 *
 * Open-Topo-Data docs: https://www.opentopodata.org/
 * d3-contour docs:     https://d3js.org/d3-contour
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TOPO_API = 'https://api.opentopodata.org/v1/ned10m';
const GRID_SIZE = 50;          // Sample a 50×50 grid (2500 points total)
const BATCH_SIZE = 100;        // Open-Topo-Data max points per request
const GAUSSIAN_SIGMA = 3.0;    // Blur before contour extraction (matches Python)

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch elevation grid for a bounding box.
 * Combines grid sampling, API calls, and interpolation.
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {function} [onProgress]  — optional (pct) => void callback (0–100)
 * @returns {Promise<{
 *   grid: Float32Array,   — elevation in meters, shape [gridH][gridW] flattened
 *   gridW: number,
 *   gridH: number,
 *   latmin: number, latmax: number,
 *   lonmin: number, lonmax: number,
 * }>}
 */
export async function fetchElevationGrid(bbox, onProgress = null) {
  // TODO (Phase 7): Implement
  //
  // 1. Generate 50×50 sample grid:
  //    for r in 0..GRID_SIZE:
  //      for c in 0..GRID_SIZE:
  //        lat = bbox.latmin + (r / (GRID_SIZE-1)) * (bbox.latmax - bbox.latmin)
  //        lon = bbox.lonmin + (c / (GRID_SIZE-1)) * (bbox.lonmax - bbox.lonmin)
  //
  // 2. Batch into groups of 100, POST each batch to Open-Topo-Data
  //    Body: { "locations": "lat1,lon1|lat2,lon2|..." }
  //    Response: { "results": [{ "elevation": meters }, ...] }
  //
  // 3. Fill any null elevations with mean of non-null values
  //
  // 4. Bilinear interpolate: scipy RegularGridInterpolator equivalent
  //    Use the built 50×50 grid as source, expand to target image pixel size
  //    (or keep at GRID_SIZE for contour extraction — d3-contour works on any grid)
  //
  // 5. Apply Gaussian blur (simulate scipy.ndimage.gaussian_filter sigma=3)

  throw new Error('fetchElevationGrid not yet implemented (Phase 7)');
}

/**
 * Extract contour line arrays from an elevation grid using d3-contour.
 * Equivalent to Python: getContourArrays(elev_img, interval_m)
 *
 * d3-contour uses the marching squares algorithm — cleaner than cv2.findContours.
 *
 * @param {Float32Array} grid    — elevation values (flattened row-major)
 * @param {number} gridW
 * @param {number} gridH
 * @param {number} intervalM    — contour interval in meters (default 2.0)
 * @returns {Array<Array<[number, number]>>}  contour polylines in grid coordinates
 */
export function extractContours(grid, gridW, gridH, intervalM = 2.0) {
  // TODO (Phase 7): Implement using window.d3.contours()
  //
  // const minElev = Math.min(...validValues);
  // const maxElev = Math.max(...validValues);
  // const firstLevel = Math.ceil(minElev / intervalM) * intervalM;
  // const thresholds = d3.range(firstLevel, maxElev + intervalM, intervalM);
  //
  // const contoursGen = d3.contours()
  //   .size([gridW, gridH])
  //   .thresholds(thresholds);
  //
  // const contourFeatures = contoursGen(Array.from(grid));
  // Each feature is a GeoJSON MultiPolygon — extract coordinates as polylines.
  //
  // Filter: skip contours with fewer than 10 points (matches Python).

  throw new Error('extractContours not yet implemented (Phase 7)');
}

/**
 * Convert contour grid coordinates to image pixel coordinates.
 * Required because contours are extracted on the GRID_SIZE×GRID_SIZE grid
 * but need to be drawn on the full image canvas.
 *
 * @param {Array<Array<[number, number]>>} contours   — in grid coords
 * @param {number} gridW
 * @param {number} gridH
 * @param {number} imageW
 * @param {number} imageH
 * @returns {Array<Array<[number, number]>>}  in image pixel coords
 */
export function scaleContoursToImage(contours, gridW, gridH, imageW, imageH) {
  const scaleX = imageW / gridW;
  const scaleY = imageH / gridH;
  return contours.map(line =>
    line.map(([x, y]) => [x * scaleX, y * scaleY])
  );
}

/**
 * Calculate uphill tick mark positions and directions along contour lines.
 * Equivalent to Python: getContourTicks(contour_arrays, elev_img, tick_spacing)
 *
 * For each tick:
 *   1. Compute tangent vector from nearby points
 *   2. Rotate 90° to get perpendicular
 *   3. Sample elevation ±4px in each perpendicular direction
 *   4. Determine uphill direction (higher elevation side)
 *   5. Return { position: [x,y], direction: [dx,dy] } (unit vector uphill)
 *
 * @param {Array<Array<[number, number]>>} contours  — in image pixel coords
 * @param {Float32Array} elevGrid  — image-resolution elevation grid
 * @param {number} gridW
 * @param {number} gridH
 * @param {number} tickSpacing  — place a tick every N points (default 50)
 * @returns {Array<{ position: [number, number], direction: [number, number] }>}
 */
export function getContourTicks(contours, elevGrid, gridW, gridH, tickSpacing = 50) {
  // TODO (Phase 7): Implement
  throw new Error('getContourTicks not yet implemented (Phase 7)');
}

/**
 * Draw uphill tick marks on a canvas context.
 * Equivalent to Python: drawContourTicks()
 * Each tick is a small filled triangle pointing uphill.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ position, direction }>} ticks
 * @param {string} color
 * @param {number} tickLength  — pixels (default 12)
 */
export function drawContourTicks(ctx, ticks, color, tickLength = 12) {
  // TODO (Phase 7): Implement
  // Draw filled triangles: tip = position + direction*tickLength
  //                        base = position ± perpendicular*(tickLength*0.4)
  ctx.fillStyle = color;
  for (const { position, direction } of ticks) {
    const [x, y] = position;
    const [dx, dy] = direction;
    // Perpendicular vector
    const px = -dy, py = dx;
    const halfBase = tickLength * 0.4;

    ctx.beginPath();
    ctx.moveTo(x + dx * tickLength, y + dy * tickLength); // tip
    ctx.lineTo(x + px * halfBase,   y + py * halfBase);   // base left
    ctx.lineTo(x - px * halfBase,   y - py * halfBase);   // base right
    ctx.closePath();
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST a batch of locations to Open-Topo-Data and return elevation values.
 *
 * @param {Array<{lat: number, lon: number}>} locations
 * @returns {Promise<Array<number|null>>}  elevation in meters (null if no data)
 */
async function fetchElevationBatch(locations) {
  const locationStr = locations.map(({ lat, lon }) => `${lat},${lon}`).join('|');
  const resp = await fetch(TOPO_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: locationStr }),
  });
  if (!resp.ok) throw new Error(`Open-Topo-Data error: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status !== 'OK') throw new Error(`Open-Topo-Data: ${data.error || data.status}`);
  return data.results.map(r => r.elevation);
}

/**
 * Apply a simple box blur approximation to a 2D grid.
 * Full Gaussian blur not critical here; a few box blur passes approximate it.
 * Equivalent to Python: scipy.ndimage.gaussian_filter(sigma=3)
 *
 * @param {Float32Array} grid
 * @param {number} w
 * @param {number} h
 * @param {number} radius  — blur radius in pixels
 * @returns {Float32Array}
 */
function boxBlur(grid, w, h, radius) {
  // Simple horizontal + vertical box blur (separable)
  const buf = new Float32Array(grid.length);
  const out = new Float32Array(grid.length);
  const r = Math.round(radius);
  const diam = r * 2 + 1;

  // Horizontal pass
  for (let row = 0; row < h; row++) {
    let sum = 0, count = 0;
    for (let col = 0; col < w; col++) {
      sum += grid[row * w + col]; count++;
      if (col >= r) { sum -= grid[row * w + (col - r)]; count = Math.min(count, diam); }
      const start = Math.max(0, col - r);
      const end   = Math.min(w - 1, col + r);
      buf[row * w + col] = sum / (end - start + 1);
    }
  }

  // Vertical pass
  for (let col = 0; col < w; col++) {
    let sum = 0;
    for (let row = 0; row < h; row++) {
      sum += buf[row * w + col];
      if (row >= r) sum -= buf[(row - r) * w + col];
      const start = Math.max(0, row - r);
      const end   = Math.min(h - 1, row + r);
      out[row * w + col] = sum / (end - start + 1);
    }
  }

  return out;
}
