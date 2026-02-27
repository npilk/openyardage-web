/**
 * generator.js — Top-level generation orchestrator
 *
 * Coordinates the full pipeline: OSM fetch → render → PDF assembly.
 * Called by app.js when the user clicks "Generate Yardage Book".
 *
 * TODO (Phase 2–6): Implement fully. Currently a stub that reports progress
 *   and shows a placeholder message so the UI flow can be tested end-to-end.
 *
 * Pipeline (once fully implemented):
 *   1. fetchHoleWays(bbox)                 → hole centerline nodes (osm.js)
 *   2. For each hole:
 *        a. fetchHoleFeatures(holeBbox)    → fairways, hazards, trees, etc. (osm.js)
 *        b. categorizeFeatures(osmResult)  → sorted feature arrays (osm.js)
 *        c. renderHole(...)                → OffscreenCanvas, full hole (renderer.js)
 *        d. renderGreenInset(...)          → OffscreenCanvas, green close-up (renderer.js)
 *        e. [optional] fetchElevation(...) → contour arrays (elevation.js)
 *   3. assemblePdf(holes, options)         → jsPDF instance (pdf.js)
 *   4. pdf.output('datauristring')         → pdfUrl passed to onDone()
 */

import { fetchHoleWays, fetchHoleFeatures, categorizeFeatures } from './osm.js';
import { renderHole, renderGreenInset } from './renderer.js';
import { assemblePdf } from './pdf.js';
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
 * @param {function} opts.onDone       — ({ pdfUrl, holeCount }) => void
 * @param {function} opts.onError      — ({ message }) => void
 */
export async function generateBook({
  bbox,
  courseName,
  colors,
  options,
  onProgress,
  onHoleStatus,
  onDone,
  onError,
}) {
  try {
    // ── Step 1: Fetch hole waypoints ──────────────────────────────────────────
    onProgress({ pct: 2, message: 'Fetching hole layouts from OpenStreetMap…' });

    const holeWays = await fetchHoleWays(bbox);

    if (!holeWays || holeWays.length === 0) {
      throw new Error(
        'No golf holes found in the selected area. Make sure the course is mapped ' +
        'in OpenStreetMap with golf=hole tags on the hole ways.'
      );
    }

    const totalHoles = holeWays.length;
    onProgress({ pct: 8, message: `Found ${totalHoles} hole${totalHoles !== 1 ? 's' : ''}. Fetching feature data…` });

    // ── Step 2: Fetch all feature data for the bounding box ───────────────────
    const allFeatures = await fetchHoleFeatures(bbox);

    onProgress({ pct: 14, message: 'Processing holes…' });

    // ── Step 3: [Optional] Fetch elevation data ───────────────────────────────
    let elevationGrid = null;
    if (options.includeTopo) {
      onProgress({ pct: 16, message: 'Fetching elevation data…' });
      try {
        elevationGrid = await fetchElevationGrid(bbox);
      } catch (e) {
        console.warn('Elevation fetch failed, skipping contours:', e);
        // Non-fatal — continue without topography
      }
    }

    // ── Step 4: Render each hole ──────────────────────────────────────────────
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

        renderedHoles.push({ holeNum, par, holeCanvas, greenCanvas });

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

    // ── Step 5: Assemble PDF ──────────────────────────────────────────────────
    onProgress({ pct: 86, message: 'Assembling PDF…' });

    const pdfUrl = await assemblePdf({
      holes: renderedHoles,
      courseName,
      colors,
    });

    onProgress({ pct: 100, message: 'Done!' });
    onDone({ pdfUrl, holeCount: renderedHoles.length });

  } catch (err) {
    console.error('Generation failed:', err);
    onError({ message: err.message || 'An unexpected error occurred.' });
  }
}
