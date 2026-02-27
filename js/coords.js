/**
 * coords.js — Coordinate transforms, rotation math, and distance calculations
 *
 * Ports the following Python functions from hyformulas.py:
 *   translateWaytoNP      → wayToPixels()
 *   translateNodestoNP    → nodesToPixels()
 *   getRotateAngle        → getRotateAngle()
 *   rotateArray           → rotatePoints()
 *   rotateArrayList       → rotatePointsList()
 *   adjustRotatedFeatures → translateFeatures()
 *   filterArrayList       → filterFeatures()
 *   distToLine            → distToLine()
 *   getLatDegreeDistance  → getLatYardsPerDegree()
 *   getLonDegreeDistance  → getLonYardsPerDegree()
 *   getHoleMinMax         → getHoleBbox()
 *
 * Coordinate convention (preserved from Python):
 *   - Image array: rows = longitude-based, cols = latitude-based
 *   - After wayToPixels swap: arrays are in (col, row) = (lat-based, lon-based)
 *   - This matches canvas 2D convention: point = [x, y] = [col, row]
 *
 * TODO (Phase 3): Implement all functions below.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Earth distance constants
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371.0;
const KM_TO_YARDS = 1093.613;

// ─────────────────────────────────────────────────────────────────────────────
// Geo → Pixel Transforms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an array of {lat, lon} nodes to pixel coordinates.
 * Equivalent to Python: translateWaytoNP(way, hole_minlat, ...)
 *
 * Returns Float32Array of interleaved [x0,y0, x1,y1, ...] pairs,
 * or a convenience array of [x, y] pairs depending on usage.
 *
 * Coordinate swap: after normalization, x = col = latitude-based,
 *   y = row = longitude-based. This matches canvas drawPath() convention.
 *
 * @param {Array<{lat, lon}>} nodes
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox  — hole bounding box
 * @param {number} width   — canvas width in pixels
 * @param {number} height  — canvas height in pixels
 * @returns {Array<[number, number]>}  array of [x, y] pixel pairs
 */
export function wayToPixels(nodes, bbox, width, height) {
  // TODO (Phase 3): Implement
  // Python equivalent:
  //   yfactor = ((lat - hole_minlat) / (hole_maxlat - hole_minlat)) * y_dim
  //   xfactor = ((lon - hole_minlon) / (hole_maxlon - hole_minlon)) * x_dim
  //   nds = [[xfactor, yfactor], ...]
  //   nds[:,[0,1]] = nds[:,[1,0]]   ← the key swap
  //
  // Note: In the Python code, x_dim = height (lon-based rows),
  //   y_dim = width (lat-based cols). Then the swap gives (col, row) = (x, y).
  throw new Error('wayToPixels not yet implemented (Phase 3)');
}

/**
 * Convert individual tree nodes {lat, lon} to pixel [x, y] pairs.
 * Equivalent to Python: translateNodestoNP(nodes, ...)
 *
 * @param {Array<{lat, lon}>} nodes
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {number} width
 * @param {number} height
 * @returns {Array<[number, number]>}
 */
export function nodesToPixels(nodes, bbox, width, height) {
  // TODO (Phase 3): Same as wayToPixels but for single-point nodes
  throw new Error('nodesToPixels not yet implemented (Phase 3)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the rotation angle (degrees) to orient a hole bottom-to-top.
 * Equivalent to Python: getRotateAngle(hole_way_nodes)
 *
 * Uses inverse cosine of vertical component of the tee→green vector.
 * Adjusts quadrant based on relative position of green vs tee.
 *
 * @param {Array<[number, number]>} holePixels  — pixel coords of hole centerline
 * @returns {number}  rotation angle in degrees
 */
export function getRotateAngle(holePixels) {
  // TODO (Phase 3): Implement
  // Python:
  //   tee = hole_way_nodes[0], green = hole_way_nodes[-1]
  //   dx = green_x - tee_x, dy = green_y - tee_y
  //   dist = sqrt(dx² + dy²)
  //   theta = degrees(acos(dy / dist))
  //   Adjust for quadrant:
  //     green right, below tee  → 180 - theta
  //     green left,  below tee  → 180 + theta
  //     green left,  above tee  → 360 - theta
  //     green right, above tee  → theta
  throw new Error('getRotateAngle not yet implemented (Phase 3)');
}

/**
 * Rotate a set of [x, y] pixel points around a center point.
 * Equivalent to Python: rotateArray(image, array, angle) using Rotate2D()
 *
 * Uses standard 2D rotation matrix:
 *   x' = (x - cx) * cos(θ) - (y - cy) * sin(θ) + cx
 *   y' = (x - cx) * sin(θ) + (y - cy) * cos(θ) + cy
 *
 * @param {Array<[number, number]>} points
 * @param {number} cx   — center x (usually image_width / 2)
 * @param {number} cy   — center y (usually image_height / 2)
 * @param {number} angleDeg
 * @returns {Array<[number, number]>}
 */
export function rotatePoints(points, cx, cy, angleDeg) {
  // TODO (Phase 3): Implement
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [
      dx * cos - dy * sin + cx,
      dx * sin + dy * cos + cy,
    ];
  });
}

/**
 * Rotate multiple feature arrays.
 * Equivalent to Python: rotateArrayList(arrays, image, angle)
 *
 * @param {Array<Array<[number, number]>>} featureArrays
 * @param {number} cx
 * @param {number} cy
 * @param {number} angleDeg
 * @returns {Array<Array<[number, number]>>}
 */
export function rotatePointsList(featureArrays, cx, cy, angleDeg) {
  return featureArrays.map(pts => rotatePoints(pts, cx, cy, angleDeg));
}

/**
 * Apply a translation offset to all feature arrays after rotation.
 * Equivalent to Python: adjustRotatedFeatures(feature_list, ymin, xmin)
 *
 * @param {Array<Array<[number, number]>>} featureArrays
 * @param {number} dx   — horizontal offset (subtract to shift into view)
 * @param {number} dy   — vertical offset
 * @returns {Array<Array<[number, number]>>}
 */
export function translateFeatures(featureArrays, dx, dy) {
  // TODO (Phase 3): Implement
  return featureArrays.map(pts =>
    pts.map(([x, y]) => [x - dx, y - dy])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Filtering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter a list of feature polygon arrays to keep only those belonging to
 * the current hole (remove features from adjacent holes).
 * Equivalent to Python: filterArrayList(...)
 *
 * Multi-stage filter:
 *   1. Bounding box check (±filterYards, ±30 yds laterally)
 *   2. Centerline perpendicular distance check
 *   3. Aggressive near-tee filter (within 75 yds: shortFactor × filterYards)
 *   4. Par 3 special case: skip near-tee aggressive filter
 *
 * @param {Array<[number, number]>} holeCenterline  — rotated hole pixels
 * @param {Array<Array<[number, number]>>} features — rotated feature arrays
 * @param {number} yardsPerPixel   — ypp: yards per pixel in this image
 * @param {number} par             — hole par (affects filter aggressiveness)
 * @param {object} opts
 * @param {number} opts.filterYards   — base filter width (default 50)
 * @param {number} opts.shortFactor   — multiplier near tee (default 1.5)
 * @param {number} opts.medFactor     — multiplier mid-range
 * @param {boolean} opts.isFairway    — use fairway-specific validation
 * @param {boolean} opts.isTeeBox     — tee box flag
 * @returns {Array<Array<[number, number]>>}  filtered features
 */
export function filterFeatures(holeCenterline, features, yardsPerPixel, par, opts = {}) {
  // TODO (Phase 3): Implement
  // See Python filterArrayList() for full algorithm
  throw new Error('filterFeatures not yet implemented (Phase 3)');
}

/**
 * Calculate the perpendicular distance (in yards) from a point to a line.
 * Equivalent to Python: distToLine(point, line1, line2, ypp)
 *
 * @param {[number, number]} point    — [x, y]
 * @param {[number, number]} lineP1   — [x, y] first endpoint
 * @param {[number, number]} lineP2   — [x, y] second endpoint
 * @param {number} yardsPerPixel
 * @returns {number}  distance in yards
 */
export function distToLine(point, lineP1, lineP2, yardsPerPixel) {
  const [x0, y0] = point;
  const [x1, y1] = lineP1;
  const [x2, y2] = lineP2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) {
    // Degenerate line: return distance to the point
    return Math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2) * yardsPerPixel;
  }

  // Point-to-line distance formula: |a·x0 + b·y0 + c| / sqrt(a²+b²)
  // Line: a(x-x1) + b(y-y1) = 0  where a=dy, b=-dx, c = -(a·x1 + b·y1)
  const a = dy;
  const b = -dx;
  const c = -(a * x1 + b * y1);
  const dist = Math.abs(a * x0 + b * y0 + c) / len;

  return dist * yardsPerPixel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance / Scale Calculations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate yards per degree of latitude at a given bounding box.
 * Equivalent to Python: getLatDegreeDistance(bottom_lat, top_lat)
 *
 * Accounts for latitude-dependent degree length (longer at equator).
 * Equator: ~1 degree lat ≈ 120,925 yards
 * Increases ~13.56 yards/degree north.
 *
 * @param {number} latmin
 * @param {number} latmax
 * @returns {number}  yards per degree of latitude
 */
export function getLatYardsPerDegree(latmin, latmax) {
  // TODO (Phase 3): Port from Python getLatDegreeDistance
  // Python formula (simplified spherical model):
  //   avg_lat = (latmin + latmax) / 2
  //   meters_per_degree = (Math.PI / 180) * EARTH_RADIUS_KM * 1000
  //   yards = meters_per_degree * KM_TO_YARDS / 1000
  throw new Error('getLatYardsPerDegree not yet implemented (Phase 3)');
}

/**
 * Calculate yards per degree of longitude at a given bounding box.
 * Equivalent to Python: getLonDegreeDistance(bottom_lat, top_lat)
 *
 * Longitude degree length shrinks toward poles: multiply by cos(avg_lat).
 *
 * @param {number} latmin
 * @param {number} latmax
 * @returns {number}  yards per degree of longitude
 */
export function getLonYardsPerDegree(latmin, latmax) {
  // TODO (Phase 3): Port from Python getLonDegreeDistance
  throw new Error('getLonYardsPerDegree not yet implemented (Phase 3)');
}

/**
 * Calculate yards per pixel for a given image size and bounding box.
 * Used throughout rendering for distance annotations.
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {number} imageWidth    — pixels
 * @param {number} imageHeight   — pixels
 * @returns {number}  yards per pixel
 */
export function getYardsPerPixel(bbox, imageWidth, imageHeight) {
  // TODO (Phase 3): Implement
  // lonRange in yards / imageHeight  (rows are lon-based)
  throw new Error('getYardsPerPixel not yet implemented (Phase 3)');
}

/**
 * Calculate pixel distance between two [x,y] points.
 *
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {number}
 */
export function pixelDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

/**
 * Calculate the optimal canvas dimensions for a hole, scaled so the
 * longest side = maxPx (default 3000px). Returns { width, height }.
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {number} maxPx   — default 3000
 * @returns {{ width: number, height: number }}
 */
export function getCanvasDimensions(bbox, maxPx = 3000) {
  // TODO (Phase 3): Match Python's sizing logic
  // Python uses x_dim (lon range) and y_dim (lat range), scaled to 3000px
  throw new Error('getCanvasDimensions not yet implemented (Phase 3)');
}
