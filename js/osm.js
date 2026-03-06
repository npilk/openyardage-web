/**
 * osm.js — OpenStreetMap / Overpass API data fetching and feature parsing
 *
 * Ports the Python functions: getOSMGolfWays, getOSMGolfData, categorizeWays
 *
 * Overpass API endpoints (both CORS-enabled, no key required):
 *   Primary: https://overpass-api.de/api/interpreter
 *   Mirror:  https://overpass.kumi.systems/api/interpreter
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all golf course data in a single Overpass query.
 *
 * Returns both the parsed hole centerline ways (golf=hole, sorted by ref) and
 * the full feature set used for rendering. Since way["golf"] is a superset of
 * way["golf"="hole"], there is no need for a separate hole-ways request.
 *
 * Features fetched:
 *   - way['golf']                        → hole centerlines, fairways, bunkers, tees, greens, etc.
 *   - way['natural'='wood']              → wooded areas
 *   - way['landuse'='forest']            → forested areas
 *   - way['natural'='water']             → water bodies
 *   - node['natural'='tree']             → individual trees
 *   - relation['golf'='fairway']         → multipolygon fairways
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @returns {Promise<{
 *   holeWays:  Array<{id, tags, nodes: Array<{lat, lon}>}>,
 *   ways:      Array<{id, tags, nodes: Array<{lat, lon}>}>,
 *   nodes:     Array<{id, tags, lat, lon}>,
 *   relations: Array<{id, tags, members: Array<{role, ref}>}>,
 * }>}
 */
export async function fetchCourseData(bbox) {
  const bb = `${bbox.latmin},${bbox.lonmin},${bbox.latmax},${bbox.lonmax}`;
  const query = `[out:json][timeout:60];
(
  way["golf"](${bb});
  way["natural"="wood"](${bb});
  way["landuse"="forest"](${bb});
  way["natural"="water"](${bb});
  way["waterway"="riverbank"](${bb});
  way["natural"="coastline"](${bb});
  node["natural"="tree"](${bb});
  relation["golf"="fairway"](${bb});
);
out body;
>;
out skel qt;`;

  const result = await overpassQuery(query);
  const nodeMap = buildNodeMap(result.elements);

  const ways = result.elements
    .filter(el => el.type === 'way')
    .map(way => ({
      id: way.id,
      tags: way.tags || {},
      nodes: resolveWayNodes(way, nodeMap),
    }));

  const nodes = result.elements
    .filter(el => el.type === 'node')
    .map(node => ({
      id: node.id,
      tags: node.tags || {},
      lat: node.lat,
      lon: node.lon,
    }));

  const relations = result.elements
    .filter(el => el.type === 'relation')
    .map(rel => ({
      id: rel.id,
      tags: rel.tags || {},
      members: rel.members || [],
    }));

  // Extract and sort hole centerline ways from the already-fetched data
  const holeWays = ways
    .filter(way => way.tags.golf === 'hole' && way.nodes.length >= 2)
    .sort((a, b) => (parseInt(a.tags.ref, 10) || 0) - (parseInt(b.tags.ref, 10) || 0));

  return { holeWays, ways, nodes, relations };
}

/**
 * Categorize raw Overpass features into typed buckets for rendering.
 * Equivalent to Python: categorizeWays(hole_result, ...)
 *
 * Returns raw lat/lon node arrays. Pixel conversion happens in renderer.js (Phase 3).
 *
 * Green identification: last node in holeWay.nodes = green center;
 *   find the golf=green polygon whose bounding box contains that point.
 *
 * Multipolygon fairways: relation with golf=fairway, extract outer way nodes.
 *
 * @param {{ ways, nodes, relations }} osmResult  — result from fetchHoleFeatures
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {{ id, tags, nodes: Array<{lat, lon}> }} holeWay
 * @returns {{
 *   sandTraps:    Array<Array<{lat, lon}>>,
 *   teeBoxes:     Array<Array<{lat, lon}>>,
 *   fairways:     Array<Array<{lat, lon}>>,
 *   waterHazards: Array<Array<{lat, lon}>>,
 *   woods:        Array<Array<{lat, lon}>>,
 *   trees:        Array<{lat, lon}>,
 *   green:        Array<{lat, lon}> | null,
 * }}
 */
export function categorizeFeatures(osmResult, bbox, holeWay) {
  const sandTraps    = [];
  const teeBoxes     = [];
  const fairways     = [];
  const waterHazards = [];
  const woods        = [];
  const trees        = [];
  const allGreens    = [];
  let   green        = null;

  // Build a way lookup map for multipolygon relation resolution
  const wayById = new Map(osmResult.ways.map(w => [w.id, w]));

  // ── Categorize ways ────────────────────────────────────────────────────────
  for (const way of osmResult.ways) {
    const golfType    = way.tags.golf    || null;
    const naturalType = way.tags.natural || null;
    const landuse     = way.tags.landuse || null;

    // Normalize: natural=water, waterway=riverbank, and natural=wood/landuse=forest override golf tag
    const waterway = way.tags.waterway || null;
    let type = golfType;
    if (naturalType === 'water' || waterway === 'riverbank') type = 'water_hazard';
    if (naturalType === 'wood' || landuse === 'forest')      type = 'woods';

    if (way.nodes.length === 0) continue;

    switch (type) {
      case 'bunker':               sandTraps.push(way.nodes);    break;
      case 'tee':                  teeBoxes.push(way.nodes);     break;
      case 'water_hazard':
      case 'lateral_water_hazard': waterHazards.push(way.nodes); break;
      case 'fairway':              fairways.push(way.nodes);     break;
      case 'woods':                woods.push(way.nodes);        break;
      case 'green':                allGreens.push(way.nodes);    break;
    }
  }

  // ── Multipolygon fairway relations ─────────────────────────────────────────
  for (const relation of osmResult.relations) {
    if (relation.tags.golf !== 'fairway') continue;

    for (const member of relation.members) {
      if (member.role !== 'outer') continue;

      const way = wayById.get(member.ref);
      if (way && way.nodes.length > 0) {
        fairways.push(way.nodes);
      }
    }
  }

  // ── Individual tree nodes ──────────────────────────────────────────────────
  for (const node of osmResult.nodes) {
    if (node.tags.natural === 'tree') {
      trees.push({ lat: node.lat, lon: node.lon });
    }
  }

  // ── Identify green for this hole ───────────────────────────────────────────
  // The last node in the hole centerline way is the green center (OSM convention).
  if (holeWay.nodes.length > 0) {
    const greenCenter = holeWay.nodes[holeWay.nodes.length - 1];
    green = findGreen(osmResult.ways, greenCenter);
  }

  // ── Coastline ocean polygons ────────────────────────────────────────────────
  // natural=coastline ways need special assembly: they are directed lines (land
  // on left, ocean on right) that must be chained and closed along the bbox.
  const coastlinePolygons = coastlineToPolygons(osmResult.ways, bbox);
  waterHazards.push(...coastlinePolygons);

  return { sandTraps, teeBoxes, fairways, waterHazards, woods, trees, green, allGreens };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
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
      const contentType = resp.headers.get('Content-Type') || '';
      if (contentType.includes('xml') || contentType.includes('html')) {
        throw new Error(`Expected JSON but got ${contentType.split(';')[0].trim()}`);
      }
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

/**
 * Convert natural=coastline ways into filled ocean/sea polygon node arrays.
 * OSM coastline convention: land is to the LEFT of way direction, ocean to the RIGHT.
 * Open chains are closed by tracing the bbox boundary clockwise (ocean/right side).
 *
 * Returns arrays of {lat, lon} objects, compatible with wayToPixels().
 *
 * @param {Array<{id, tags, nodes}>} ways
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @returns {Array<Array<{lat, lon}>>}
 */
function coastlineToPolygons(ways, bbox) {
  const coastlineWays = ways.filter(w => w.tags.natural === 'coastline');
  if (!coastlineWays.length) return [];

  const { latmin, lonmin, latmax, lonmax } = bbox;
  const chains = _chainCoastlineWays(coastlineWays);
  const polygons = [];

  for (const chain of chains) {
    if (chain.length < 2) continue;

    // Clip chain to bbox, collecting continuous segments
    const segments = [];
    let currentSeg = [];

    for (let i = 0; i < chain.length - 1; i++) {
      const clipped = _clipSegmentToBBox(chain[i], chain[i + 1], latmin, lonmin, latmax, lonmax);
      if (clipped === null) {
        if (currentSeg.length) { segments.push(currentSeg); currentSeg = []; }
        continue;
      }
      const [c1, c2] = clipped;
      const last = currentSeg[currentSeg.length - 1];
      if (!currentSeg.length) {
        currentSeg = [c1, c2];
      } else if (Math.abs(last[0] - c1[0]) < 1e-9 && Math.abs(last[1] - c1[1]) < 1e-9) {
        currentSeg.push(c2);
      } else {
        segments.push(currentSeg);
        currentSeg = [c1, c2];
      }
    }
    if (currentSeg.length) segments.push(currentSeg);

    for (const seg of segments) {
      if (seg.length < 2) continue;

      const startPt = seg[0];
      const endPt   = seg[seg.length - 1];

      const posStart = _clockwisePos(startPt[0], startPt[1], latmin, lonmin, latmax, lonmax);
      const posEnd   = _clockwisePos(endPt[0],   endPt[1],   latmin, lonmin, latmax, lonmax);

      const closing = _cornersClockwiseBetween(posEnd, posStart, latmin, lonmin, latmax, lonmax);

      const allLatLons = [...seg, ...closing];
      polygons.push(allLatLons.map(([lat, lon]) => ({ lat, lon })));
    }
  }

  return polygons;
}

/**
 * Chain OSM coastline ways into ordered lat/lon paths by matching endpoint node IDs.
 * @param {Array<{tags, nodes}>} coastlineWays
 * @returns {Array<Array<[lat, lon]>>}
 */
function _chainCoastlineWays(coastlineWays) {
  const wayData = coastlineWays.map(w => ({
    latlons: w.nodes.map(n => [n.lat, n.lon]),
    startId: w.nodes[0]?.id,
    endId:   w.nodes[w.nodes.length - 1]?.id,
    used:    false,
  })).filter(wd => wd.latlons.length >= 2);

  // Map start node ID → way index (coastlines are directed, chain forward only)
  const nodeStarts = new Map(wayData.map((wd, i) => [wd.startId, i]));

  const chains = [];
  for (let startIdx = 0; startIdx < wayData.length; startIdx++) {
    const wd = wayData[startIdx];
    if (wd.used) continue;
    wd.used = true;
    const chain = [...wd.latlons];
    let currentEndId = wd.endId;

    while (nodeStarts.has(currentEndId)) {
      const nextIdx = nodeStarts.get(currentEndId);
      const nextWd = wayData[nextIdx];
      if (nextWd.used) break;
      nextWd.used = true;
      chain.push(...nextWd.latlons.slice(1)); // skip duplicate connecting node
      currentEndId = nextWd.endId;
    }

    chains.push(chain);
  }

  return chains;
}

/**
 * Clip a lat/lon segment to a bounding box using the Liang-Barsky algorithm.
 * @returns {[[lat,lon],[lat,lon]] | null}
 */
function _clipSegmentToBBox(p1, p2, minlat, minlon, maxlat, maxlon) {
  const [lat1, lon1] = p1;
  const [lat2, lon2] = p2;
  const dlat = lat2 - lat1;
  const dlon = lon2 - lon1;
  let t0 = 0, t1 = 1;

  for (const [p, q] of [
    [-dlat, lat1 - minlat], [dlat, maxlat - lat1],
    [-dlon, lon1 - minlon], [dlon, maxlon - lon1],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
    } else if (p < 0) {
      t0 = Math.max(t0, q / p);
    } else {
      t1 = Math.min(t1, q / p);
    }
  }

  if (t0 > t1) return null;
  return [
    [lat1 + t0 * dlat, lon1 + t0 * dlon],
    [lat1 + t1 * dlat, lon1 + t1 * dlon],
  ];
}

/**
 * Return the clockwise position (0–4) of a lat/lon point on the bbox boundary.
 * 0=NE corner, 0–1=east edge going south, 1=SE, 1–2=south going west, etc.
 */
function _clockwisePos(lat, lon, minlat, minlon, maxlat, maxlon) {
  const latR = maxlat - minlat;
  const lonR = maxlon - minlon;

  const dEast  = Math.abs(lon - maxlon);
  const dSouth = Math.abs(lat - minlat);
  const dWest  = Math.abs(lon - minlon);
  const dNorth = Math.abs(lat - maxlat);
  const nearest = Math.min(dEast, dSouth, dWest, dNorth);

  if (nearest === dEast)  return (maxlat - lat) / latR;       // 0..1
  if (nearest === dSouth) return 1 + (maxlon - lon) / lonR;   // 1..2
  if (nearest === dWest)  return 2 + (lat - minlat) / latR;   // 2..3
  return 3 + (lon - minlon) / lonR;                            // 3..4
}

/**
 * Return bbox corner lat/lon points that fall between posEnd and posStart going clockwise.
 * Corners: SE=1, SW=2, NW=3, NE=4(=0)
 * @returns {Array<[lat, lon]>}
 */
function _cornersClockwiseBetween(posEnd, posStart, minlat, minlon, maxlat, maxlon) {
  const allCorners = [
    [1.0, [minlat, maxlon]],  // SE
    [2.0, [minlat, minlon]],  // SW
    [3.0, [maxlat, minlon]],  // NW
    [4.0, [maxlat, maxlon]],  // NE
  ];

  const arcLen = ((posStart - posEnd) % 4 + 4) % 4;
  if (arcLen === 0) return [];

  const result = [];
  for (const [cornerPos, cornerLatLon] of allCorners) {
    const distFromEnd = ((cornerPos - posEnd) % 4 + 4) % 4;
    if (distFromEnd > 0 && distFromEnd < arcLen) {
      result.push([distFromEnd, cornerLatLon]);
    }
  }

  result.sort((a, b) => a[0] - b[0]);
  return result.map(r => r[1]);
}

/**
 * Find the golf=green polygon whose bounding box contains a given lat/lon point.
 * Equivalent to Python: identifyGreen(hole_way_nodes, hole_result)
 *
 * @param {Array<{id, tags, nodes}>} ways
 * @param {{ lat: number, lon: number }} centerPoint
 * @returns {Array<{lat, lon}> | null}
 */
function findGreen(ways, centerPoint) {
  for (const way of ways) {
    if (way.tags.golf !== 'green' || way.nodes.length === 0) continue;

    const lats = way.nodes.map(n => n.lat);
    const lons = way.nodes.map(n => n.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    if (
      centerPoint.lat > minLat && centerPoint.lat < maxLat &&
      centerPoint.lon > minLon && centerPoint.lon < maxLon
    ) {
      return way.nodes;
    }
  }
  return null;
}
