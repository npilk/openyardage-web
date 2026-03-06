/**
 * generator.js — Top-level generation orchestrator
 *
 * Coordinates the full pipeline: OSM fetch → render → PDF assembly.
 * Called by app.js when the user clicks "Generate Yardage Book".
 *
 * Pipeline:
 *   1. fetchCourseData(bbox)               → hole ways + all features in one request (osm.js)
 *   2. For each hole:
 *        a. categorizeFeatures(osmResult)  → sorted feature arrays (osm.js)
 *        c. renderHole(...)                → OffscreenCanvas, full hole (renderer.js)
 *        d. renderGreenInset(...)          → OffscreenCanvas, green close-up (renderer.js)
 *        e. [optional] fetchElevation(...) → contour arrays (elevation.js)
 *   3. onDone({ holeCount, renderedHoles, osmData }) — PDF assembled lazily on download
 */

import { fetchCourseData, categorizeFeatures } from './osm.js';
import { renderHole, renderGreenInset } from './renderer.js';
import { fetchElevationGrid } from './elevation.js';

/**
 * Main entry point. Called from app.js.
 *
 * @param {object} opts
 * @param {{ latmin, lonmin, latmax, lonmax }} opts.bbox
 * @param {string}   opts.courseName
 * @param {object}   opts.colors       — AppState.colors
 * @param {object}   opts.options      — AppState.options
 * @param {function} opts.onProgress   — ({ pct, message }) => void
 * @param {function} opts.onHoleStatus — ({ holeNum, par, status, detail }) => void
 * @param {function} opts.onDone       — ({ holeCount, renderedHoles, osmData }) => void
 * @param {function} opts.onError      — ({ message }) => void
 */
export async function generateBook({
  bbox,
  courseName,
  colors,
  options,
  cachedOsmData,
  onProgress,
  onHoleStatus,
  onDone,
  onError,
}) {
  try {
    // ── Step 1: Course data (fetch or reuse cache) ────────────────────────────
    let holeWays, allFeatures;

    if (cachedOsmData) {
      onProgress({ pct: 2, message: 'Using cached course data…' });
      allFeatures = cachedOsmData.allFeatures;
      holeWays = allFeatures.ways
        .filter(w => w.tags.golf === 'hole' && w.nodes.length >= 2)
        .sort((a, b) => (parseInt(a.tags.ref, 10) || 0) - (parseInt(b.tags.ref, 10) || 0));
    } else {
      onProgress({ pct: 2, message: 'Fetching course data from OpenStreetMap…' });
      const fetched = await fetchCourseData(bbox);
      holeWays    = fetched.holeWays;
      allFeatures = { ways: fetched.ways, nodes: fetched.nodes, relations: fetched.relations };
    }

    if (!holeWays || holeWays.length === 0) {
      throw new Error(
        'No golf holes found in the selected area. Make sure the course is mapped ' +
        'in OpenStreetMap with <code>golf=hole</code> tags on the hole ways. ' +
        '<a href="https://github.com/npilk/hacker-yardage/blob/main/docs/howtomap.md" target="_blank" rel="noopener">More info here.</a>'
      );
    }

    const totalHoles = holeWays.length;
    onProgress({ pct: 14, message: `Found ${totalHoles} hole${totalHoles !== 1 ? 's' : ''}. Processing…` });

    // ── Step 2: Elevation data (fetch or reuse cache) ─────────────────────────
    let elevationGrid = null;
    if (options.includeTopo) {
      if (cachedOsmData?.elevationGrid) {
        elevationGrid = cachedOsmData.elevationGrid;
      } else {
        onProgress({ pct: 16, message: 'Fetching elevation data…' });
        try {
          elevationGrid = await fetchElevationGrid(bbox);
        } catch (e) {
          console.warn('Elevation fetch failed, skipping contours:', e);
        }
      }
    }

    // ── Step 3: Render each hole ──────────────────────────────────────────────
    const renderedHoles = [];
    const pctPerHole = 70 / totalHoles;   // 14%–84% of progress bar

    for (let i = 0; i < holeWays.length; i++) {
      const holeWay = holeWays[i];
      const holeNum = parseInt(holeWay.tags?.ref, 10) || (i + 1);
      const par     = parseInt(holeWay.tags?.par, 10) || null;

      onHoleStatus({ holeNum, par, status: 'running' });

      try {
        // Categorize features relevant to this hole
        const features = categorizeFeatures(allFeatures, bbox, holeWay);

        // Skip holes with no green — likely frisbee golf or bad OSM data
        if (!features.green) {
          console.warn(`Hole ${holeNum}: no golf=green found — skipping`);
          onHoleStatus({ holeNum, par, status: 'skipped', detail: 'No green found' });
          const pct = 14 + (i + 1) * pctPerHole;
          onProgress({ pct, message: `Skipped hole ${holeNum} (no green mapped)` });
          continue;
        }

        // Render full hole image
        const holeCanvas = await renderHole({
          holeWay,
          features,
          elevationGrid,
          bbox,
          colors,
          options,
          holeNum,
          par,
        });

        // Render green inset
        const greenCanvas = await renderGreenInset({
          holeWay,
          features,
          bbox,
          colors,
          options,
          holeNum,
          par,
        });

        renderedHoles.push({ holeNum, par, holeCanvas, greenCanvas, holeWay });

        const pct = 14 + (i + 1) * pctPerHole;
        onProgress({ pct, message: `Rendered hole ${holeNum} of ${totalHoles}…` });
        onHoleStatus({ holeNum, par, status: 'done', detail: `Par ${par}` });

      } catch (holeErr) {
        console.error(`Error rendering hole ${holeNum}:`, holeErr);
        onHoleStatus({ holeNum, par, status: 'error', detail: holeErr.message });
        // Continue with remaining holes
      }
    }

    if (renderedHoles.length === 0) {
      throw new Error('No holes could be rendered. Check that the course is fully mapped in OpenStreetMap.');
    }

    onProgress({ pct: 100, message: `Done! ${renderedHoles.length} hole${renderedHoles.length !== 1 ? 's' : ''} rendered.` });
    onDone({
      holeCount: renderedHoles.length,
      renderedHoles,
      osmData: { allFeatures, elevationGrid, bbox },
    });

  } catch (err) {
    console.error('Generation failed:', err);
    onError({ message: err.message || 'An unexpected error occurred.' });
  }
}

/**
 * Re-render a single hole with (potentially) different options.
 * Used by the per-hole regeneration controls in Step 3.
 *
 * @param {object} opts
 * @param {object} opts.holeWay        — original holeWay from generation
 * @param {object} opts.allFeatures    — full course feature set (from osmData)
 * @param {object|null} opts.elevationGrid
 * @param {{ latmin, lonmin, latmax, lonmax }} opts.bbox
 * @param {object} opts.colors
 * @param {object} opts.options        — may include overridden holeWidth / shortFilter
 * @returns {Promise<{ holeNum, par, holeCanvas, greenCanvas, holeWay }>}
 */
export async function reRenderHole({ holeWay, allFeatures, elevationGrid, bbox, colors, options }) {
  const holeNum = parseInt(holeWay.tags?.ref, 10) || 0;
  const par     = parseInt(holeWay.tags?.par, 10) || null;

  const features = categorizeFeatures(allFeatures, bbox, holeWay);

  const holeCanvas = await renderHole({
    holeWay, features, elevationGrid, bbox, colors, options, holeNum, par,
  });

  const greenCanvas = await renderGreenInset({
    holeWay, features, bbox, colors, options, holeNum, par,
  });

  return { holeNum, par, holeCanvas, greenCanvas, holeWay };
}
