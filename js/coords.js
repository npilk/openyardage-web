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
 *
 * Coordinate convention (preserved from Python):
 *   - After wayToPixels: point = [x, y] where
 *     x = (lat - latmin)/(latmax - latmin) * width   (latitude-based, horizontal)
 *     y = (lon - lonmin)/(lonmax - lonmin) * height  (longitude-based, vertical)
 *   - This matches the Python "swap" that converts (lon-col, lat-row) → (lat-x, lon-y)
 *   - Canvas 2D convention: x = column (horizontal), y = row (vertical) ✓
 */

// ─────────────────────────────────────────────────────────────────────────────
// Geo → Pixel Transforms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an array of {lat, lon} nodes to [x, y] pixel coordinates.
 * Equivalent to Python: translateWaytoNP / translateNodestoNP
 *
 * x = lat-normalized * width   (horizontal axis = latitude)
 * y = lon-normalized * height  (vertical axis   = longitude)
 *
 * @param {Array<{lat, lon}>} nodes
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {number} width
 * @param {number} height
 * @returns {Array<[number, number]>}
 */
export function wayToPixels(nodes, bbox, width, height) {
  const latRange = bbox.latmax - bbox.latmin;
  const lonRange = bbox.lonmax - bbox.lonmin;
  return nodes.map(({ lat, lon }) => [
    ((lat - bbox.latmin) / latRange) * width,
    ((lon - bbox.lonmin) / lonRange) * height,
  ]);
}

/**
 * Alias for wayToPixels — used for single-point node lists (e.g. individual trees).
 */
export function nodesToPixels(nodes, bbox, width, height) {
  return wayToPixels(nodes, bbox, width, height);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the rotation angle (degrees) to orient a hole bottom-to-top.
 * Equivalent to Python: getRotateAngle(hole_way_nodes)
 *
 * Uses the tee (first node) and green center (last node).
 * The angle computed places the green at the top of the image.
 *
 * @param {Array<[number, number]>} holePixels  — pixel coords of hole centerline
 * @returns {number}  rotation angle in degrees
 */
export function getRotateAngle(holePixels) {
  return _computeAngle(holePixels[0], holePixels[holePixels.length - 1]);
}

/**
 * Calculate the approach-angle rotation for the green inset view.
 * Equivalent to Python: getMidpointAngle(hole_way_nodes)
 *
 * Uses the second-to-last and last nodes (approach direction to green).
 *
 * @param {Array<[number, number]>} holePixels
 * @returns {number}  rotation angle in degrees
 */
export function getMidpointAngle(holePixels) {
  return _computeAngle(
    holePixels[holePixels.length - 2],
    holePixels[holePixels.length - 1],
  );
}

/**
 * Shared angle computation used by getRotateAngle and getMidpointAngle.
 * Python: getAngle / getRotateAngle logic.
 *
 * Computes the angle needed to rotate the image so that `to` is above `from`.
 *
 * @param {[number, number]} from  — [x, y] origin point (tee)
 * @param {[number, number]} to    — [x, y] destination point (green)
 * @returns {number}  degrees
 */
function _computeAngle([x2, y2], [x, y]) {
  // from = tee = [x2, y2], to = green = [x, y]
  const bigy   = Math.max(y, y2);
  const smally = Math.min(y, y2);

  const numerator   = bigy - smally;
  const denominator = Math.sqrt((x2 - x) ** 2 + (bigy - smally) ** 2);

  if (denominator === 0) return 0;

  let angle = (Math.acos(numerator / denominator) * 180) / Math.PI;

  // Quadrant adjustments — matches Python exactly
  if      (y > y2 && x > x2) angle = 180 - angle;   // green lower-right of tee
  else if (y > y2 && x < x2) angle = 180 + angle;   // green lower-left of tee
  else if (y < y2 && x < x2) angle = 360 - angle;   // green upper-left of tee
  // else: green upper-right — base case, angle unchanged

  return angle;
}

/**
 * Rotate a set of [x, y] pixel points around a center point.
 * Equivalent to Python: Rotate2D / rotateArray
 *
 * Python uses -angle (clockwise in screen coords). Canvas y-axis points down,
 * so clockwise rotation uses positive sin in the standard matrix — we negate
 * the angle to match Python's convention.
 *
 * @param {Array<[number, number]>} points
 * @param {number} cx
 * @param {number} cy
 * @param {number} angleDeg
 * @returns {Array<[number, number]>}
 */
export function rotatePoints(points, cx, cy, angleDeg) {
  const rad = (-angleDeg * Math.PI) / 180;  // negate to match Python's Rotate2D(-angle)
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
 * Equivalent to Python: rotateArrayList
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
 * Python: new_x = x - xmin, new_y = y - ymin
 * Calling translateFeatures(arrays, -offsetX, -offsetY) gives x - (-offsetX) = x + offsetX.
 *
 * @param {Array<Array<[number, number]>>} featureArrays
 * @param {number} dx   — subtract this from each x (pass -offsetX to add offsetX)
 * @param {number} dy   — subtract this from each y
 * @returns {Array<Array<[number, number]>>}
 */
export function translateFeatures(featureArrays, dx, dy) {
  return featureArrays.map(pts =>
    pts.map(([x, y]) => [x - dx, y - dy])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Filtering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter features to keep only those belonging to the current hole.
 * Equivalent to Python: filterArrayList(...)
 *
 * @param {Array<[number, number]>} holeCenterline  — rotated + translated hole pixels
 * @param {Array<Array<[number, number]>>} features
 * @param {number} yardsPerPixel
 * @param {number} par
 * @param {object} [opts]
 * @param {number|null} [opts.filterYards=50]  — null = no filtering, return all
 * @param {number} [opts.shortFactor=1]
 * @param {number} [opts.medFactor=1]
 * @param {boolean} [opts.isFairway=false]
 * @param {boolean} [opts.isTeeBox=false]
 * @param {boolean} [opts.drawAllFeatures=false]  — skip all filtering, return everything
 * @returns {Array<Array<[number, number]>>}
 */
export function filterFeatures(holeCenterline, features, yardsPerPixel, par, opts = {}) {
  const {
    filterYards = 50,
    shortFactor = 1,
    medFactor   = 1,
    isFairway   = false,
    isTeeBox    = false,
    drawAllFeatures = false,
  } = opts;

  // null = skip filtering entirely (used for water hazards, woods)
  if (filterYards === null || filterYards === undefined) return features;

  const { bbXMin, bbYMin, bbXMax, bbYMax } = _createHoleBoundingBox(holeCenterline, yardsPerPixel);

  const green    = holeCenterline[holeCenterline.length - 1];
  const tee      = holeCenterline[0];
  const midpoint = holeCenterline.length > 2 ? holeCenterline[1] : _midpoint(tee, green);

  const par4plus = par === 3 ? 0 : 1;
  // Tee-box filter: push the lower y-bound up to exclude tee boxes near the green
  const teeBoxFilter = isTeeBox ? (90 / yardsPerPixel + par4plus * (140 / yardsPerPixel)) : 0;

  const small = filterYards * shortFactor;
  const med   = filterYards * medFactor;

  return features.filter(array => {
    if (!array || array.length === 0) return false;

    // Centroid of this feature
    const cx = array.reduce((s, p) => s + p[0], 0) / array.length;
    const cy = array.reduce((s, p) => s + p[1], 0) / array.length;

    // drawAllFeatures: include everything within the hole bbox, skipping the
    // distance-to-centerline check. Fairways use full polygon bbox overlap so that
    // large shared fairways (e.g. North Berwick #1/#18) are included even when their
    // centroid falls outside the current hole's X or Y range after rotation.
    if (drawAllFeatures) {
      if (isFairway) {
        const maxX = array.reduce((m, p) => Math.max(m, p[0]), -Infinity);
        const minX = array.reduce((m, p) => Math.min(m, p[0]),  Infinity);
        const maxY = array.reduce((m, p) => Math.max(m, p[1]), -Infinity);
        const minY = array.reduce((m, p) => Math.min(m, p[1]),  Infinity);
        return !(maxX < bbXMin || minX > bbXMax || maxY < bbYMin || minY > bbYMax);
      }
      return cx >= bbXMin && cx <= bbXMax && cy <= bbYMax && cy >= (bbYMin + teeBoxFilter);
    }

    // X bounding box check (normal path)
    if (cx < bbXMin || cx > bbXMax) return false;

    // Fairway: drop any fairway whose centroid is past the green (above it in rotated space).
    // This avoids picking up the fairway of an adjacent hole whose tee is near our green.
    if (isFairway && cy < green[1]) return false;

    // Y bounding box check: for fairways, skip the centroid check — large or shared
    // fairways (e.g. Pacific Dunes #1/#7) often have centroids outside any single
    // hole's bbox. The y-range overlap check below serves as the fairway gate instead.
    if (!isFairway && (cy > bbYMax || cy < (bbYMin + teeBoxFilter))) return false;

    // Fairway y-range overlap check: only filter if the fairway has no y overlap at
    // all with the hole extent (i.e., it lies entirely above the green or below the tee).
    if (isFairway) {
      const maxY = array.reduce((m, p) => Math.max(m, p[1]), -Infinity);
      const minY = array.reduce((m, p) => Math.min(m, p[1]),  Infinity);
      if (maxY < bbYMin || minY > bbYMax) return false;
    }

    // Centerline distance check.
    // For fairways, use the minimum distance from any vertex to the centerline — this
    // handles large/shared fairways whose centroid may be far from the current hole's
    // centerline even though part of the fairway clearly belongs to it.
    // For other features, centroid distance is sufficient.
    let distYards;
    if (isFairway) {
      distYards = array.reduce((best, p) => {
        const d = p[1] < midpoint[1]
          ? distToLine(p, midpoint, green, yardsPerPixel)
          : distToLine(p, midpoint, tee,   yardsPerPixel);
        return Math.min(best, d);
      }, Infinity);
    } else if (cy < midpoint[1]) {
      distYards = distToLine([cx, cy], midpoint, green, yardsPerPixel);
    } else {
      distYards = distToLine([cx, cy], midpoint, tee, yardsPerPixel);
    }

    // Apply tighter filter near the tee (par 3s skip this).
    // Use centroid y for the nearTee/shortRng decision for all features.
    const nearTee  = par !== 3 && (bbYMax - cy) * yardsPerPixel < 75;
    const shortRng = par !== 3 && (bbYMax - cy) * yardsPerPixel < 150;

    if (nearTee)   return distYards < small;
    if (shortRng)  return distYards < med;
    return distYards < filterYards;
  });
}

/**
 * Create a bounding box around the rotated hole centerline for feature filtering.
 * Equivalent to Python: createHoleBoundingBox(rotated_hole_array, ypp)
 *
 * @param {Array<[number, number]>} holePoints
 * @param {number} ypp
 * @returns {{ bbXMin, bbYMin, bbXMax, bbYMax }}
 */
function _createHoleBoundingBox(holePoints, ypp) {
  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of holePoints) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  let bbXMin = minX - 50 / ypp;
  let bbXMax = maxX + 50 / ypp;
  const bbYMin = minY - 30 / ypp;   // 30 yards past green
  const bbYMax = maxY + 10 / ypp;   // 10 yards behind tee

  // Trim if wider than 125 yards, but keep at least 15 yards from centerline
  const xSpread = (bbXMax - bbXMin) * ypp;
  if (xSpread > 125) {
    const trim = (xSpread - 125) / 2 / ypp;
    bbXMin = Math.min(bbXMin + trim, minX - 15 / ypp);
    bbXMax = Math.max(bbXMax - trim, maxX + 15 / ypp);
  }

  return { bbXMin, bbYMin, bbXMax, bbYMax };
}

/** Average of two points */
function _midpoint([x1, y1], [x2, y2]) {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

/**
 * Perpendicular distance (yards) from a point to a line segment.
 * Equivalent to Python: distToLine(point, line1, line2, ypp)
 *
 * @param {[number, number]} point
 * @param {[number, number]} lineP1
 * @param {[number, number]} lineP2
 * @param {number} yardsPerPixel
 * @returns {number}
 */
export function distToLine(point, lineP1, lineP2, yardsPerPixel) {
  const [x0, y0] = point;
  const [x1, y1] = lineP1;
  const [x2, y2] = lineP2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) {
    return Math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2) * yardsPerPixel;
  }

  const a = dy, b = -dx;
  const c = -(a * x1 + b * y1);
  return (Math.abs(a * x0 + b * y0 + c) / len) * yardsPerPixel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance / Scale Calculations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Yards per degree of latitude.
 * Equivalent to Python: getLatDegreeDistance(bottom_lat, top_lat)
 *
 * @param {number} latmin
 * @param {number} latmax
 * @returns {number}
 */
export function getLatYardsPerDegree(latmin, latmax) {
  const LAT_EQUATOR_YDS   = 120925.62;
  const LAT_YDS_PER_DEGREE = 13.56;
  const avgLat = (latmin + latmax) / 2;
  return LAT_EQUATOR_YDS + Math.abs(avgLat) * LAT_YDS_PER_DEGREE;
}

/**
 * Yards per degree of longitude at the given latitude.
 * Equivalent to Python: getLonDegreeDistance(bottom_lat, top_lat)
 *
 * @param {number} latmin
 * @param {number} latmax
 * @returns {number}
 */
export function getLonYardsPerDegree(latmin, latmax) {
  const LON_EQUATOR_YDS = 69.172 * 5280 / 3;   // ~121,822 yards
  const avgLat = (latmin + latmax) / 2;
  return LON_EQUATOR_YDS * Math.cos((avgLat * Math.PI) / 180);
}

/**
 * Yards per pixel for an image covering a bounding box.
 * Equivalent to Python: ypp = max(lat_dist, lon_dist) / 3000
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {number}
 */
export function getYardsPerPixel(bbox, imageWidth, imageHeight) {
  const latDist = (bbox.latmax - bbox.latmin) * getLatYardsPerDegree(bbox.latmin, bbox.latmax);
  const lonDist = (bbox.lonmax - bbox.lonmin) * getLonYardsPerDegree(bbox.latmin, bbox.latmax);
  return Math.max(latDist, lonDist) / Math.max(imageWidth, imageHeight);
}

/**
 * Canvas dimensions for a bounding box, with the longest side = maxPx.
 * Equivalent to Python: generateImage sizing logic.
 *
 * Returns { width, height } where:
 *   width  = lat-based dimension (columns)
 *   height = lon-based dimension (rows)
 *
 * Resolution / memory trade-offs (worst case = square bbox at 45° rotation):
 *   3 000px → rotated canvas ~4 200×4 200 (~72 MB)   — original, too coarse
 *   6 000px → rotated canvas ~8 500×8 500 (~290 MB)  — good; comfortably exceeds 300 DPI for PDF
 *  10 000px → rotated canvas ~14 100×14 100 (~800 MB) — risky on low-RAM devices; overkill for print
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {number} [maxPx=6000]
 * @returns {{ width: number, height: number }}
 */
export function getCanvasDimensions(bbox, maxPx = 6000) {
  const latDist = (bbox.latmax - bbox.latmin) * getLatYardsPerDegree(bbox.latmin, bbox.latmax);
  const lonDist = (bbox.lonmax - bbox.lonmin) * getLonYardsPerDegree(bbox.latmin, bbox.latmax);

  let width, height;
  if (latDist >= lonDist) {
    width  = maxPx;
    height = Math.round((lonDist / latDist) * maxPx);
  } else {
    height = maxPx;
    width  = Math.round((latDist / lonDist) * maxPx);
  }
  return { width, height };
}

/**
 * Pixel distance between two [x,y] points.
 */
export function pixelDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}
