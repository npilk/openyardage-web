/**
 * app.js — OpenYardage main application entry point
 *
 * Manages global state, step navigation, and wires together all modules.
 * Imported as a module from index.html.
 */

import { initMap } from './map.js';
import { generateBook, reRenderHole } from './generator.js';
import { assemblePdf, assemblePrintPdf } from './pdf.js';

// ─────────────────────────────────────────────────────────────────────────────
// Global Application State
// ─────────────────────────────────────────────────────────────────────────────

export const AppState = {
  currentStep: 1,

  /** Bounding box selected on map. { latmin, lonmin, latmax, lonmax } */
  bbox: null,

  /** Course name from Nominatim (may be empty if user drew bbox manually) */
  courseName: '',

  /** Color settings (hex strings, matching Python defaults) */
  colors: {
    fairway:  '#34E884',
    teeBox:   '#5AFCA3',
    green:    '#5AFCA3',
    rough:    '#18BB3E',
    trees:    '#178200',
    water:    '#15BCF1',
    sand:     '#FFD435',
    text:     '#000000',
    topo:     '#8B5E3C',
  },

  /** Feature/rendering options */
  options: {
    includeTrees:    true,
    textBackground:  true,
    inMeters:        false,
    includeTopo:     false,
    topoInterval:   2.0,   // meters
    topoLabels:     true,
    holeWidth:        50,    // yards from centerline
    shortFilter:      1.0,   // multiplier for near-tee filtering
    drawAllFeatures:  false, // skip all feature filtering
  },

  /** Generation state (updated by generator.js) */
  generation: {
    isRunning:     false,
    progress:      0,      // 0–100
    statusMessage: '',
    pdfUrl:        null,
    error:         null,
    renderedHoles: [],     // { holeNum, par, holeImageUrl, greenImageUrl, holeWidth, holeHeight, greenWidth, greenHeight, holeWay }[]
    osmData:       null,   // { allFeatures, elevationGrid, bbox }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Presets
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS = {
  default: {
    fairway: '#34E884',
    teeBox:  '#5AFCA3',
    green:   '#5AFCA3',
    rough:   '#18BB3E',
    trees:   '#178200',
    water:   '#15BCF1',
    sand:    '#FFD435',
    text:    '#000000',
  },
  bw: {
    fairway: '#F0F0F0',
    teeBox:  '#F0F0F0',
    green:   '#888888',
    rough:   '#CCCCCC',
    trees:   '#222222',
    water:   '#555555',
    sand:    '#FFFFFF',
    text:    '#000000',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────────────────────────────────────

const dom = {
  // Step panels
  step1:  document.getElementById('step-1'),
  step2:  document.getElementById('step-2'),
  step3:  document.getElementById('step-3'),

  // Step nav items
  stepNav1: document.getElementById('step-nav-1'),
  stepNav2: document.getElementById('step-nav-2'),
  stepNav3: document.getElementById('step-nav-3'),

  // Step 1
  bboxInfo:       document.getElementById('bbox-info'),
  btnToStep2:     document.getElementById('btn-to-step2'),
  mapHint:        document.getElementById('map-hint'),

  // Step 2 — colors
  colorFairway:   document.getElementById('color-fairway'),
  colorTeeBox:    document.getElementById('color-teebox'),
  colorGreen:     document.getElementById('color-green'),
  colorRough:     document.getElementById('color-rough'),
  colorWater:     document.getElementById('color-water'),
  colorSand:      document.getElementById('color-sand'),
  colorTrees:     document.getElementById('color-trees'),
  colorText:      document.getElementById('color-text'),
  hexFairway:     document.getElementById('hex-fairway'),
  hexTeeBox:      document.getElementById('hex-teebox'),
  hexGreen:       document.getElementById('hex-green'),
  hexRough:       document.getElementById('hex-rough'),
  hexWater:       document.getElementById('hex-water'),
  hexSand:        document.getElementById('hex-sand'),
  hexTrees:       document.getElementById('hex-trees'),
  hexText:        document.getElementById('hex-text'),

  colorPreset:    document.getElementById('color-preset'),

  // Step 2 — options
  optTrees:         document.getElementById('opt-trees'),
  optTextBg:        document.getElementById('opt-text-bg'),
  optYards:         document.getElementById('opt-yards'),
  optMeters:        document.getElementById('opt-meters'),
  optHoleWidth:     document.getElementById('opt-hole-width'),
  holeWidthVal:     document.getElementById('hole-width-val'),
  optDrawAll:       document.getElementById('opt-draw-all'),

  // Step 2 — summary / course name
  courseNameInput: document.getElementById('course-name-input'),
  bboxSummary:     document.getElementById('bbox-summary'),

  // Step 2 navigation
  btnBackToStep1: document.getElementById('btn-back-to-step1'),
  btnToStep3:     document.getElementById('btn-to-step3'),

  // Step 3
  progressFill:    document.getElementById('progress-fill'),
  progressStatus:  document.getElementById('progress-status'),
  progressPct:     document.getElementById('progress-pct'),
  genCourseName:   document.getElementById('gen-course-name'),

  // Step 3 generation status
  generationStatus: document.getElementById('generation-status'),

  // Step 3 download / export
  downloadActions:     document.getElementById('download-actions'),
  btnExport:           document.getElementById('btn-export'),
  exportModal:         document.getElementById('export-modal'),
  btnExportClose:      document.getElementById('btn-export-close'),
  aboutModal:          document.getElementById('about-modal'),
  btnAbout:            document.querySelector('.header-about-link'),
  btnAboutClose:       document.getElementById('btn-about-close'),
  btnViewBook:         document.getElementById('btn-view-book'),
  btnDownloadPdf:      document.getElementById('btn-download-pdf'),
  btnDownloadPrintPdf: document.getElementById('btn-download-print-pdf'),
  btnDownloadZip:      document.getElementById('btn-download-zip'),

  // Viewer
  viewerOverlay:       document.getElementById('viewer-overlay'),
  viewerStage:         document.getElementById('viewer-stage'),
  viewerTitle:         document.getElementById('viewer-title'),
  viewerPageIndicator: document.getElementById('viewer-page-indicator'),
  btnViewerClose:      document.getElementById('btn-viewer-close'),
  btnViewerPrev:       document.getElementById('btn-viewer-prev'),
  btnViewerNext:       document.getElementById('btn-viewer-next'),

  // Hole browser
  holeBrowser:       document.getElementById('hole-browser'),
  holeBrowserTitle:  document.getElementById('hole-browser-title'),
  holeSelect:        document.getElementById('hole-select'),
  btnHolePrev:       document.getElementById('btn-hole-prev'),
  btnHoleNext:       document.getElementById('btn-hole-next'),
  btnHoleDelete:     document.getElementById('btn-hole-delete'),
  holeDisplayCanvas: document.getElementById('hole-display-canvas'),
  greenDisplayCanvas:document.getElementById('green-display-canvas'),

  // Per-hole regen controls
  regenHoleWidth:  document.getElementById('regen-hole-width'),
  regenWidthVal:   document.getElementById('regen-width-val'),
  regenShortFilter:document.getElementById('regen-short-filter'),
  regenFilterVal:  document.getElementById('regen-filter-val'),
  regenDrawAll:    document.getElementById('regen-draw-all'),
  btnRegenHole:    document.getElementById('btn-regen-hole'),
  regenStatus:     document.getElementById('regen-status'),
  btnRegenToggle:  document.getElementById('btn-regen-toggle'),
  holeBrowserRight:document.querySelector('.hole-browser-right'),
  holeOsmName:     document.getElementById('hole-osm-name'),

  errorState:    document.getElementById('error-state'),
  errorMessage:  document.getElementById('error-message'),
  btnRetry:      document.getElementById('btn-retry'),

  btnBackToStep2: document.getElementById('btn-back-to-step2'),
  btnStartOver:   document.getElementById('btn-start-over'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Step Navigation
// ─────────────────────────────────────────────────────────────────────────────

function showStep(n) {
  AppState.currentStep = n;

  // Toggle panel visibility
  [dom.step1, dom.step2, dom.step3].forEach((panel, i) => {
    const stepNum = i + 1;
    if (stepNum === n) {
      panel.removeAttribute('hidden');
      panel.classList.add('active');
    } else {
      panel.setAttribute('hidden', '');
      panel.classList.remove('active');
    }
  });

  // Update header step indicators
  [dom.stepNav1, dom.stepNav2, dom.stepNav3].forEach((el, i) => {
    const stepNum = i + 1;
    el.classList.toggle('active', stepNum === n);
    el.classList.toggle('completed', stepNum < n);
  });

  // Step-specific setup
  if (n === 2) populateStep2Summary();
  if (n === 3) startGeneration();
}

// ─────────────────────────────────────────────────────────────────────────────
// BBox / Map Integration
// ─────────────────────────────────────────────────────────────────────────────

function handleBboxChange(bbox, courseName) {
  AppState.bbox = bbox;
  AppState.courseName = courseName || '';
  AppState.generation.osmData = null; // bbox changed — cached OSM data is stale

  // A new selection from the map clears any prior user edit so the
  // Nominatim-sourced name is shown in Step 2 (user can still override it).
  delete dom.courseNameInput.dataset.userEdited;

  if (bbox) {
    // Hide the hint once they've drawn a box
    dom.mapHint.classList.add('hidden');

    // Update footer info
    dom.bboxInfo.innerHTML = `
      <span class="bbox-label">Selected: </span>
      <span class="bbox-coords">
        ${bbox.latmin.toFixed(4)}, ${bbox.lonmin.toFixed(4)}
        &nbsp;→&nbsp;
        ${bbox.latmax.toFixed(4)}, ${bbox.lonmax.toFixed(4)}
      </span>
    `;
    dom.btnToStep2.disabled = false;
  } else {
    dom.bboxInfo.innerHTML = '<span class="bbox-label">No area selected</span>';
    dom.btnToStep2.disabled = true;
    dom.mapHint.classList.remove('hidden');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Color & Option Handlers
// ─────────────────────────────────────────────────────────────────────────────

/** Map color input IDs to AppState.colors keys */
const COLOR_MAP = [
  { input: dom.colorFairway, hex: dom.hexFairway, key: 'fairway' },
  { input: dom.colorTeeBox,  hex: dom.hexTeeBox,  key: 'teeBox'  },
  { input: dom.colorGreen,   hex: dom.hexGreen,   key: 'green'   },
  { input: dom.colorRough,   hex: dom.hexRough,   key: 'rough'   },
  { input: dom.colorWater,   hex: dom.hexWater,   key: 'water'   },
  { input: dom.colorSand,    hex: dom.hexSand,    key: 'sand'    },
  { input: dom.colorTrees,   hex: dom.hexTrees,   key: 'trees'   },
  { input: dom.colorText,    hex: dom.hexText,    key: 'text'    },
];

function detectPreset() {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (COLOR_MAP.every(({ key }) =>
      AppState.colors[key].toUpperCase() === preset[key].toUpperCase()
    )) return name;
  }
  return 'custom';
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  for (const { input, hex, key } of COLOR_MAP) {
    AppState.colors[key] = preset[key];
    input.value = preset[key];
    hex.textContent = preset[key].toUpperCase();
  }
  dom.colorPreset.value = name;
}

function bindColorInputs() {
  for (const { input, hex, key } of COLOR_MAP) {
    input.addEventListener('input', () => {
      AppState.colors[key] = input.value.toUpperCase();
      hex.textContent = input.value.toUpperCase();
      dom.colorPreset.value = detectPreset();
    });
  }
}

function bindOptionInputs() {
  dom.optTrees.addEventListener('change', () => {
    AppState.options.includeTrees = dom.optTrees.checked;
  });

  dom.optTextBg.addEventListener('change', () => {
    AppState.options.textBackground = dom.optTextBg.checked;
  });

  dom.optYards.addEventListener('change', () => {
    AppState.options.inMeters = false;
  });
  dom.optMeters.addEventListener('change', () => {
    AppState.options.inMeters = true;
  });

  dom.optHoleWidth.addEventListener('input', () => {
    const val = parseInt(dom.optHoleWidth.value, 10);
    AppState.options.holeWidth = val;
    dom.holeWidthVal.textContent = `${val} yds`;
  });

  dom.optDrawAll.addEventListener('change', () => {
    AppState.options.drawAllFeatures = dom.optDrawAll.checked;
  });

  // Course name (editable in step 2 summary)
  dom.courseNameInput.addEventListener('input', () => {
    AppState.courseName = dom.courseNameInput.value;
    dom.courseNameInput.dataset.userEdited = '1';
  });

  // Regen sliders — live value display
  dom.regenHoleWidth.addEventListener('input', () => {
    dom.regenWidthVal.textContent = `${dom.regenHoleWidth.value} yds`;
  });
  dom.regenShortFilter.addEventListener('input', () => {
    dom.regenFilterVal.textContent = `${parseFloat(dom.regenShortFilter.value).toFixed(1)}×`;
  });
}

/** Populate the course summary shown at bottom of Step 2 */
function populateStep2Summary() {
  // Only set the input value if it's empty or was auto-filled from Nominatim
  // (don't overwrite what the user may have typed manually)
  if (!dom.courseNameInput.dataset.userEdited) {
    dom.courseNameInput.value = AppState.courseName || '';
  }

  if (AppState.bbox) {
    const b = AppState.bbox;
    dom.bboxSummary.textContent =
      `${b.latmin.toFixed(4)}°N, ${b.lonmin.toFixed(4)}°W  →  ${b.latmax.toFixed(4)}°N, ${b.lonmax.toFixed(4)}°W`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Generation
// ─────────────────────────────────────────────────────────────────────────────

function startGeneration() {
  // Preserve any previously fetched OSM data so we can skip re-fetching if the
  // bbox hasn't changed (e.g. user went back to tweak colors and regenerated).
  const cachedOsmData = AppState.generation.osmData;

  // Reset step 3 UI
  dom.holeBrowser.setAttribute('hidden', '');
  dom.downloadActions.setAttribute('hidden', '');
  dom.generationStatus.removeAttribute('hidden');
  dom.errorState.setAttribute('hidden', '');
  dom.genCourseName.textContent = AppState.courseName || 'Yardage Book';
  setProgress(0, 'Starting…');

  AppState.generation.isRunning = true;
  AppState.generation.error = null;
  AppState.generation.pdfUrl = null;
  AppState.generation.renderedHoles = [];
  AppState.generation.osmData = null;

  generateBook({
    bbox:         AppState.bbox,
    courseName:   AppState.courseName,
    colors:       AppState.colors,
    options:      AppState.options,
    cachedOsmData,
    onProgress:   handleProgress,
    onHoleStatus: handleHoleStatus,
    onDone:       handleGenerationDone,
    onError:      handleGenerationError,
  });
}

/** Called by generator.js with { pct: 0-100, message: string } */
export function handleProgress({ pct, message }) {
  setProgress(pct, message);
}

/** Called by generator.js when a hole starts/finishes — no-op (log removed) */
export function handleHoleStatus(_event) {}

/** Called by generator.js when all holes are rendered */
export function handleGenerationDone({ holeCount, renderedHoles, osmData }) {
  AppState.generation.isRunning = false;
  AppState.generation.renderedHoles = renderedHoles;
  AppState.generation.osmData = osmData;

  // Collapse the progress / status section once the browser is ready
  dom.generationStatus.setAttribute('hidden', '');

  showHoleBrowser();
  dom.downloadActions.removeAttribute('hidden');
}

/** Called by generator.js on unrecoverable error */
export function handleGenerationError({ message }) {
  AppState.generation.isRunning = false;
  AppState.generation.error = message;

  dom.errorMessage.innerHTML = message;
  dom.errorState.removeAttribute('hidden');
}

function setProgress(pct, message) {
  AppState.generation.progress = pct;
  AppState.generation.statusMessage = message;

  dom.progressFill.style.width = `${pct}%`;
  dom.progressFill.closest('[role=progressbar]').setAttribute('aria-valuenow', pct);
  dom.progressStatus.textContent = message;
  dom.progressPct.textContent = `${Math.round(pct)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hole Browser
// ─────────────────────────────────────────────────────────────────────────────

let currentHoleIndex = 0;

function showHoleBrowser() {
  const holes = AppState.generation.renderedHoles;

  // Set course name title
  dom.holeBrowserTitle.textContent = AppState.courseName || 'Yardage Book';

  // Populate hole selector dropdown
  dom.holeSelect.innerHTML = holes.map((h, i) =>
    `<option value="${i}">Hole ${h.holeNum}${h.par ? ` — Par ${h.par}` : ''}</option>`
  ).join('');

  // Sync regen controls to current global options
  dom.regenHoleWidth.value  = AppState.options.holeWidth;
  dom.regenWidthVal.textContent = `${AppState.options.holeWidth} yds`;
  dom.regenShortFilter.value = AppState.options.shortFilter;
  dom.regenFilterVal.textContent = `${AppState.options.shortFilter.toFixed(1)}×`;
  dom.regenDrawAll.checked = AppState.options.drawAllFeatures;

  dom.holeBrowser.removeAttribute('hidden');
  displayHole(0);
}

function displayHole(index) {
  const holes = AppState.generation.renderedHoles;
  currentHoleIndex = index;
  dom.holeSelect.value = String(index);

  // Draw hole canvas
  drawToDisplayCanvas(holes[index].holeImageUrl,  dom.holeDisplayCanvas);
  drawToDisplayCanvas(holes[index].greenImageUrl, dom.greenDisplayCanvas);

  // Show OSM hole name if present (e.g. "Pacific Dunes 1", "Amen Corner")
  const osmName = holes[index].holeWay?.tags?.name;
  if (osmName) {
    dom.holeOsmName.textContent = osmName;
    dom.holeOsmName.removeAttribute('hidden');
  } else {
    dom.holeOsmName.setAttribute('hidden', '');
  }

  // Update nav
  dom.btnHolePrev.disabled = index === 0;
  dom.btnHoleNext.disabled = index === holes.length - 1;
}

function deleteCurrentHole() {
  const holes = AppState.generation.renderedHoles;
  if (holes.length <= 1) {
    alert('Cannot delete the last hole.');
    return;
  }
  holes.splice(currentHoleIndex, 1);

  // Rebuild dropdown
  dom.holeSelect.innerHTML = holes.map((h, i) =>
    `<option value="${i}">Hole ${h.holeNum}${h.par ? ` — Par ${h.par}` : ''}</option>`
  ).join('');

  // Stay at same index, or back up if we just deleted the last item
  const newIndex = Math.min(currentHoleIndex, holes.length - 1);
  displayHole(newIndex);
}

function drawToDisplayCanvas(src, dest) {
  if (typeof src === 'string') {
    const img = new Image();
    img.onload = () => {
      dest.width  = img.naturalWidth;
      dest.height = img.naturalHeight;
      dest.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = src;
    return;
  }
  dest.width  = src.width;
  dest.height = src.height;
  dest.getContext('2d').drawImage(src, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export Modal
// ─────────────────────────────────────────────────────────────────────────────

function openExportModal() {
  dom.exportModal.removeAttribute('hidden');
}

function closeExportModal() {
  dom.exportModal.setAttribute('hidden', '');
}

function openAboutModal() {
  dom.aboutModal.removeAttribute('hidden');
}

function closeAboutModal() {
  dom.aboutModal.setAttribute('hidden', '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Yardage Book Viewer
// ─────────────────────────────────────────────────────────────────────────────

let viewerPageIndex = 0;
let viewerPages = [];

function openViewer() {
  const holes = AppState.generation.renderedHoles;
  if (!holes || holes.length === 0) return;

  const sorted = [...holes].sort((a, b) => a.holeNum - b.holeNum);
  const stage = dom.viewerStage;
  stage.innerHTML = '';
  viewerPages = [];

  // Cover page
  const cover = document.createElement('div');
  cover.className = 'viewer-page viewer-page-cover';
  cover.innerHTML = `
    <div class="viewer-cover-name">${escapeHtml(AppState.courseName || 'Golf Course')}</div>
    <div class="viewer-cover-sub">Yardage Book</div>
    <div class="viewer-cover-credit">Generated by OpenYardage<br>Map data \u00A9 OpenStreetMap contributors</div>
  `;
  stage.appendChild(cover);
  viewerPages.push(cover);

  // One page per hole
  for (const hole of sorted) {
    const page = document.createElement('div');
    page.className = 'viewer-page';

    const roughColor = AppState.colors.rough || '#18BB3E';

    page.innerHTML = `
      <div class="viewer-left">
        <div class="viewer-hole-num">Hole ${hole.holeNum}</div>
        ${hole.par ? `<div class="viewer-par">Par ${hole.par}</div>` : ''}
        <div class="viewer-notes-label">Notes</div>
        <div class="viewer-green-wrap">
          <img src="${hole.greenImageUrl}" alt="Green detail — Hole ${hole.holeNum}" />
        </div>
      </div>
      <div class="viewer-right" style="background: ${roughColor}">
        <img src="${hole.holeImageUrl}" alt="Hole ${hole.holeNum}" />
      </div>
    `;
    stage.appendChild(page);
    viewerPages.push(page);
  }

  dom.viewerTitle.textContent = AppState.courseName || 'Yardage Book';
  viewerPageIndex = 0;
  updateViewerPage();

  dom.viewerOverlay.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  dom.viewerOverlay.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

function updateViewerPage() {
  viewerPages.forEach((p, i) => p.classList.toggle('active', i === viewerPageIndex));
  dom.btnViewerPrev.disabled = viewerPageIndex === 0;
  dom.btnViewerNext.disabled = viewerPageIndex === viewerPages.length - 1;

  if (viewerPageIndex === 0) {
    dom.viewerPageIndicator.textContent = 'Cover';
  } else {
    dom.viewerPageIndicator.textContent = `${viewerPageIndex} of ${viewerPages.length - 1}`;
  }
}

function viewerPrev() {
  if (viewerPageIndex > 0) { viewerPageIndex--; updateViewerPage(); }
}

function viewerNext() {
  if (viewerPageIndex < viewerPages.length - 1) { viewerPageIndex++; updateViewerPage(); }
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// Swipe support for touch devices
function initViewerSwipe() {
  let startX = 0;
  let startY = 0;

  dom.viewerStage.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  dom.viewerStage.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // Only trigger if horizontal swipe is dominant and long enough
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) viewerNext();
      else viewerPrev();
    }
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download helpers
// ─────────────────────────────────────────────────────────────────────────────

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function safeFilename(base) {
  return (base || 'yardage-book').replace(/[^a-z0-9]/gi, '-').toLowerCase();
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Small delay before cleanup so mobile browsers can start the download
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

async function generateAndDownloadPdf() {
  const btn = dom.btnDownloadPdf;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⌛ Building PDF…';

  try {
    const pdfBlob = await assemblePdf({
      holes:      AppState.generation.renderedHoles,
      courseName: AppState.courseName,
      colors:     AppState.colors,
    });
    triggerBlobDownload(pdfBlob, `${safeFilename(AppState.courseName)}.pdf`);
  } catch (err) {
    console.error('PDF generation failed:', err);
    alert('PDF generation failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function generateAndDownloadPrintPdf() {
  const btn = dom.btnDownloadPrintPdf;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⌛ Building PDF…';

  try {
    const pdfBlob = await assemblePrintPdf({
      holes:      AppState.generation.renderedHoles,
      courseName: AppState.courseName,
      colors:     AppState.colors,
    });
    triggerBlobDownload(pdfBlob, `${safeFilename(AppState.courseName)}-print.pdf`);
  } catch (err) {
    console.error('Print PDF generation failed:', err);
    alert('Print PDF generation failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function downloadZip() {
  const btn = dom.btnDownloadZip;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⌛ Preparing ZIP…';

  try {
    const zip = new window.JSZip();
    const folder = zip.folder('yardage-book');

    for (const hole of AppState.generation.renderedHoles) {
      const num = String(hole.holeNum).padStart(2, '0');
      folder.file(`hole-${num}.png`,       dataUrlToBlob(hole.holeImageUrl));
      folder.file(`hole-${num}-green.png`, dataUrlToBlob(hole.greenImageUrl));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(blob, `${safeFilename(AppState.courseName)}-images.zip`);
  } catch (err) {
    console.error('ZIP generation failed:', err);
    alert('ZIP generation failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Hole Regeneration
// ─────────────────────────────────────────────────────────────────────────────

async function regenCurrentHole() {
  const index   = currentHoleIndex;
  const osmData = AppState.generation.osmData;
  const hole    = AppState.generation.renderedHoles[index];

  const overrideOptions = {
    ...AppState.options,
    holeWidth:        parseInt(dom.regenHoleWidth.value, 10),
    shortFilter:      parseFloat(dom.regenShortFilter.value),
    drawAllFeatures:  dom.regenDrawAll.checked,
  };

  dom.btnRegenHole.disabled = true;
  dom.regenStatus.textContent = 'Rendering…';

  try {
    const result = await reRenderHole({
      holeWay:       hole.holeWay,
      allFeatures:   osmData.allFeatures,
      elevationGrid: osmData.elevationGrid,
      bbox:          osmData.bbox,
      colors:        AppState.colors,
      options:       overrideOptions,
    });

    // Update stored images for this hole
    AppState.generation.renderedHoles[index] = {
      ...hole,
      holeImageUrl:  result.holeImageUrl,
      greenImageUrl: result.greenImageUrl,
      holeWidth:     result.holeWidth,
      holeHeight:    result.holeHeight,
      greenWidth:    result.greenWidth,
      greenHeight:   result.greenHeight,
    };

    displayHole(index);

    dom.regenStatus.textContent = 'Done!';
    setTimeout(() => { dom.regenStatus.textContent = ''; }, 2500);
  } catch (err) {
    console.error('Regen failed:', err);
    dom.regenStatus.textContent = `Error: ${err.message}`;
  } finally {
    dom.btnRegenHole.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Bindings
// ─────────────────────────────────────────────────────────────────────────────

function bindNavButtons() {
  dom.btnToStep2.addEventListener('click', () => {
    if (AppState.bbox) showStep(2);
  });

  dom.btnBackToStep1.addEventListener('click', () => showStep(1));

  dom.btnToStep3.addEventListener('click', () => showStep(3));

  dom.btnBackToStep2.addEventListener('click', () => {
    if (AppState.generation.isRunning) return; // don't navigate mid-generation
    showStep(2);
  });

  dom.btnRetry.addEventListener('click', () => {
    dom.errorState.setAttribute('hidden', '');
    startGeneration();
  });

  dom.btnStartOver.addEventListener('click', () => {
    AppState.generation.pdfUrl = null;
    showStep(1);
  });

  dom.colorPreset.addEventListener('change', () => {
    if (dom.colorPreset.value !== 'custom') applyPreset(dom.colorPreset.value);
  });

  // Hole browser navigation
  dom.btnHolePrev.addEventListener('click', () => {
    if (currentHoleIndex > 0) displayHole(currentHoleIndex - 1);
  });
  dom.btnHoleNext.addEventListener('click', () => {
    const max = AppState.generation.renderedHoles.length - 1;
    if (currentHoleIndex < max) displayHole(currentHoleIndex + 1);
  });
  dom.holeSelect.addEventListener('change', () => {
    displayHole(parseInt(dom.holeSelect.value, 10));
  });
  dom.btnHoleDelete.addEventListener('click', deleteCurrentHole);

  // Per-hole regen
  dom.btnRegenHole.addEventListener('click', regenCurrentHole);

  // Regen panel toggle (mobile only — button is hidden on wider screens via CSS)
  dom.btnRegenToggle.addEventListener('click', () => {
    const isOpen = dom.holeBrowserRight.classList.toggle('regen-open');
    dom.btnRegenToggle.textContent = isOpen ? 'Close ▴' : 'Edit ▾';
    dom.btnRegenToggle.setAttribute('aria-expanded', isOpen);
  });

  // About modal
  dom.btnAbout.addEventListener('click', e => { e.preventDefault(); openAboutModal(); });
  dom.btnAboutClose.addEventListener('click', closeAboutModal);
  dom.aboutModal.addEventListener('click', e => {
    if (e.target === dom.aboutModal) closeAboutModal();
  });

  // Export modal
  dom.btnExport.addEventListener('click', openExportModal);
  dom.btnExportClose.addEventListener('click', closeExportModal);
  dom.exportModal.addEventListener('click', e => {
    if (e.target === dom.exportModal) closeExportModal();
  });

  // Download buttons (inside modal — close modal after triggering download)
  dom.btnDownloadPdf.addEventListener('click', () => { closeExportModal(); generateAndDownloadPdf(); });
  dom.btnDownloadPrintPdf.addEventListener('click', () => { closeExportModal(); generateAndDownloadPrintPdf(); });
  dom.btnDownloadZip.addEventListener('click', () => { closeExportModal(); downloadZip(); });

  // Yardage book viewer
  dom.btnViewBook.addEventListener('click', openViewer);
  dom.btnViewerClose.addEventListener('click', closeViewer);
  dom.btnViewerPrev.addEventListener('click', viewerPrev);
  dom.btnViewerNext.addEventListener('click', viewerNext);
  document.addEventListener('keydown', (e) => {
    if (dom.viewerOverlay.hidden) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') viewerPrev();
    else if (e.key === 'ArrowRight') viewerNext();
  });
  initViewerSwipe();

  // Clicking a completed step in the header nav can go back
  dom.stepNav1.addEventListener('click', () => {
    if (dom.stepNav1.classList.contains('completed')) showStep(1);
  });
  dom.stepNav2.addEventListener('click', () => {
    if (dom.stepNav2.classList.contains('completed')) showStep(2);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  // Initialize Leaflet map (map.js)
  initMap({
    containerId: 'map',
    onBboxChange: handleBboxChange,
  });

  // Bind color pickers and option toggles
  bindColorInputs();
  bindOptionInputs();
  bindNavButtons();
}

// Run once DOM is ready (script is type="module" so DOMContentLoaded is safe)
init();
