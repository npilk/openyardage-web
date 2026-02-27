/**
 * osm.js — OpenStreetMap / Overpass API data fetching and feature parsing
 *
 * Ports the Python functions: getOSMGolfWays, getOSMGolfData, categorizeWays
 *
 * TODO (Phase 2): Implement fetchHoleWays, fetchHoleFeatures, categorizeFeatures.
 *
 * Overpass API endpoints (both CORS-enabled, no key required):
 *   Primary: https://overpass-api.de/api/interpreter
 *   Mirror:  https://overpass.kumi.systems/api/interpreter
 *
 * Overpass QL reference:
 *   https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all golf hole centerline ways within a bounding box.
 * Equivalent to Python: getOSMGolfWays(latmin, lonmin, latmax, lonmax)
 *
 * OSM convention: ways tagged golf=hole define each hole.
 *   - way.tags.ref  = hole number (string)
 *   - way.tags.par  = hole par (string)
 *   - way.nodes     = ordered nodes from tee (first) to green (last)
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @returns {Promise<Array>} Array of Overpass way objects
 */
export async function fetchHoleWays(bbox) {
  // TODO (Phase 2): Implement
  // Query: way["golf"="hole"](latmin,lonmin,latmax,lonmax);
  //
  // Overpass QL template:
  // [out:json][timeout:30];
  // (
  //   way["golf"="hole"](${bbox.latmin},${bbox.lonmin},${bbox.latmax},${bbox.lonmax});
  // );
  // out body;
  // >;
  // out skel qt;
  //
  // Returns: result.elements filtered to ways, with .nodes resolved to lat/lon

  throw new Error('fetchHoleWays not yet implemented (Phase 2)');
}

/**
 * Fetch all golf course features within a bounding box.
 * Equivalent to Python: getOSMGolfData(latmin, lonmin, latmax, lonmax)
 *
 * Features fetched:
 *   - way['golf']         → fairways, bunkers, tees, greens, roughs, water hazards
 *   - way['natural'='wood'] / way['landuse'='forest'] → wooded areas
 *   - node['natural'='tree'] → individual trees
 *   - way['natural'='water'] → water bodies
 *   - relation['golf'='fairway'] → multipolygon fairways
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @returns {Promise<object>} Parsed Overpass result: { ways: [], nodes: [], relations: [] }
 */
export async function fetchHoleFeatures(bbox) {
  // TODO (Phase 2): Implement
  // Query: all golf-tagged ways + trees + water within bbox
  //
  // [out:json][timeout:60];
  // (
  //   way["golf"](latmin,lonmin,latmax,lonmax);
  //   way["natural"="wood"](latmin,lonmin,latmax,lonmax);
  //   way["landuse"="forest"](latmin,lonmin,latmax,lonmax);
  //   way["natural"="water"](latmin,lonmin,latmax,lonmax);
  //   node["natural"="tree"](latmin,lonmin,latmax,lonmax);
  //   relation["golf"="fairway"](latmin,lonmin,latmax,lonmax);
  // );
  // out body;
  // >;
  // out skel qt;

  throw new Error('fetchHoleFeatures not yet implemented (Phase 2)');
}

/**
 * Categorize raw Overpass features into typed buckets for rendering.
 * Equivalent to Python: categorizeWays(hole_result, ...)
 *
 * @param {object} osmResult   — result from fetchHoleFeatures
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {object} holeWay     — hole way object (for bounding context)
 * @returns {{
 *   sandTraps:    Array<Float32Array>,  // pixel coordinate arrays
 *   teeBoxes:     Array<Float32Array>,
 *   fairways:     Array<Float32Array>,
 *   waterHazards: Array<Float32Array>,
 *   woods:        Array<Float32Array>,
 *   trees:        Array<{lat, lon}>,    // individual tree nodes
 *   green:        Float32Array | null,  // green polygon
 * }}
 */
export function categorizeFeatures(osmResult, bbox, holeWay) {
  // TODO (Phase 2): Implement
  // Tag mapping (from Python hyformulas.py):
  //   golf=bunker          → sandTraps
  //   golf=tee             → teeBoxes
  //   golf=fairway         → fairways
  //   golf=water_hazard    → waterHazards
  //   natural=water        → waterHazards
  //   natural=wood         → woods
  //   landuse=forest       → woods
  //   natural=tree (node)  → trees
  //   golf=green           → green
  //
  // Green identification: last node in holeWay = green center;
  //   find the golf=green polygon whose bounding box contains that point.
  //
  // Multipolygon fairways: relation with type=multipolygon, extract outer way.

  throw new Error('categorizeFeatures not yet implemented (Phase 2)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (to be fleshed out in Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run an Overpass QL query, trying primary endpoint then fallback.
 *
 * @param {string} query  — Overpass QL string
 * @returns {Promise<object>}  parsed JSON response
 */
async function overpassQuery(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      console.warn(`Overpass endpoint ${endpoint} failed:`, err.message);
      lastErr = err;
    }
  }
  throw new Error(`All Overpass endpoints failed: ${lastErr?.message}`);
}

/**
 * Build a node coordinate lookup map from Overpass result elements.
 * Overpass 'out body; >; out skel qt;' returns both ways and their nodes.
 *
 * @param {Array} elements  — result.elements from Overpass JSON
 * @returns {Map<number, {lat: number, lon: number}>}
 */
function buildNodeMap(elements) {
  const map = new Map();
  for (const el of elements) {
    if (el.type === 'node') {
      map.set(el.id, { lat: el.lat, lon: el.lon });
    }
  }
  return map;
}

/**
 * Resolve a way's node IDs to {lat, lon} coordinates using a node map.
 *
 * @param {object} way       — Overpass way element
 * @param {Map} nodeMap      — from buildNodeMap
 * @returns {Array<{lat, lon}>}
 */
function resolveWayNodes(way, nodeMap) {
  return (way.nodes || [])
    .map(id => nodeMap.get(id))
    .filter(Boolean);
}
