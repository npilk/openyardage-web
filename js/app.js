/**
 * app.js — OpenYardage main application entry point
 *
 * Manages global state, step navigation, and wires together all modules.
 * Imported as a module from index.html.
 */

import { initMap, getBbox, getCourseName, onBboxChange } from './map.js';
import { generateBook } from './generator.js';

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
    teeBox:   '#34E884',
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
    includeTrees:   true,
    inMeters:       false,
    includeTopo:    false,
    topoInterval:   2.0,   // meters
    topoLabels:     true,
    holeWidth:      50,    // yards from centerline
    shortFilter:    1.5,   // multiplier for near-tee filtering
  },

  /** Generation state (updated by generator.js) */
  generation: {
    isRunning:     false,
    progress:      0,      // 0–100
    statusMessage: '',
    pdfUrl:        null,
    error:         null,
  },
};

// Preserve default colors for reset
const DEFAULT_COLORS = { ...AppState.colors };

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
  colorGreen:     document.getElementById('color-green'),
  colorRough:     document.getElementById('color-rough'),
  colorWater:     document.getElementById('color-water'),
  colorSand:      document.getElementById('color-sand'),
  colorTrees:     document.getElementById('color-trees'),
  colorText:      document.getElementById('color-text'),
  colorTopo:      document.getElementById('color-topo'),

  hexFairway:     document.getElementById('hex-fairway'),
  hexGreen:       document.getElementById('hex-green'),
  hexRough:       document.getElementById('hex-rough'),
  hexWater:       document.getElementById('hex-water'),
  hexSand:        document.getElementById('hex-sand'),
  hexTrees:       document.getElementById('hex-trees'),
  hexText:        document.getElementById('hex-text'),
  hexTopo:        document.getElementById('hex-topo'),

  btnResetColors: document.getElementById('btn-reset-colors'),

  // Step 2 — options
  optTrees:         document.getElementById('opt-trees'),
  optYards:         document.getElementById('opt-yards'),
  optMeters:        document.getElementById('opt-meters'),
  optHoleWidth:     document.getElementById('opt-hole-width'),
  holeWidthVal:     document.getElementById('hole-width-val'),
  optTopo:          document.getElementById('opt-topo'),
  topoOptions:      document.getElementById('topo-options'),
  optTopoInterval:  document.getElementById('opt-topo-interval'),
  optTopoLabels:    document.getElementById('opt-topo-labels'),

  // Step 2 — summary
  courseNameDisplay: document.getElementById('course-name-display'),
  bboxSummary:       document.getElementById('bbox-summary'),

  // Step 2 navigation
  btnBackToStep1: document.getElementById('btn-back-to-step1'),
  btnToStep3:     document.getElementById('btn-to-step3'),

  // Step 3
  progressFill:    document.getElementById('progress-fill'),
  progressStatus:  document.getElementById('progress-status'),
  progressPct:     document.getElementById('progress-pct'),
  holeStatusList:  document.getElementById('hole-status-list'),
  holeStatusInner: document.getElementById('hole-status-inner'),

  pdfPreviewArea:  document.getElementById('pdf-preview-area'),
  pdfPreviewFrame: document.getElementById('pdf-preview-frame'),
  pdfPreviewTitle: document.getElementById('pdf-preview-title'),
  btnDownload:     document.getElementById('btn-download'),

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
  { input: dom.colorFairway, hex: dom.hexFairway, key: 'fairway'  },
  { input: dom.colorGreen,   hex: dom.hexGreen,   key: 'green'    },
  { input: dom.colorRough,   hex: dom.hexRough,   key: 'rough'    },
  { input: dom.colorWater,   hex: dom.hexWater,   key: 'water'    },
  { input: dom.colorSand,    hex: dom.hexSand,    key: 'sand'     },
  { input: dom.colorTrees,   hex: dom.hexTrees,   key: 'trees'    },
  { input: dom.colorText,    hex: dom.hexText,    key: 'text'     },
  { input: dom.colorTopo,    hex: dom.hexTopo,    key: 'topo'     },
];

function bindColorInputs() {
  for (const { input, hex, key } of COLOR_MAP) {
    input.addEventListener('input', () => {
      AppState.colors[key] = input.value.toUpperCase();
      hex.textContent = input.value.toUpperCase();
    });
  }
}

function resetColors() {
  for (const { input, hex, key } of COLOR_MAP) {
    const defaultVal = DEFAULT_COLORS[key];
    AppState.colors[key] = defaultVal;
    input.value = defaultVal;
    hex.textContent = defaultVal.toUpperCase();
  }
}

function bindOptionInputs() {
  dom.optTrees.addEventListener('change', () => {
    AppState.options.includeTrees = dom.optTrees.checked;
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

  dom.optTopo.addEventListener('change', () => {
    AppState.options.includeTopo = dom.optTopo.checked;
    if (dom.optTopo.checked) {
      dom.topoOptions.removeAttribute('hidden');
    } else {
      dom.topoOptions.setAttribute('hidden', '');
    }
  });

  dom.optTopoInterval.addEventListener('change', () => {
    AppState.options.topoInterval = parseFloat(dom.optTopoInterval.value);
  });

  dom.optTopoLabels.addEventListener('change', () => {
    AppState.options.topoLabels = dom.optTopoLabels.checked;
  });
}

/** Populate the course summary shown at bottom of Step 2 */
function populateStep2Summary() {
  dom.courseNameDisplay.textContent = AppState.courseName || '(unnamed selection)';

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
  // Reset step 3 UI
  dom.pdfPreviewArea.setAttribute('hidden', '');
  dom.errorState.setAttribute('hidden', '');
  dom.holeStatusList.setAttribute('hidden', '');
  dom.holeStatusInner.innerHTML = '';
  setProgress(0, 'Starting…');

  AppState.generation.isRunning = true;
  AppState.generation.error = null;
  AppState.generation.pdfUrl = null;

  // generateBook() is implemented in generator.js (Phase 6).
  // It calls back via the progress/error/done hooks below.
  generateBook({
    bbox:       AppState.bbox,
    courseName: AppState.courseName,
    colors:     AppState.colors,
    options:    AppState.options,
    onProgress: handleProgress,
    onHoleStatus: handleHoleStatus,
    onDone:     handleGenerationDone,
    onError:    handleGenerationError,
  });
}

/** Called by generator.js with { pct: 0-100, message: string } */
export function handleProgress({ pct, message }) {
  setProgress(pct, message);
}

/** Called by generator.js when a hole starts/finishes */
export function handleHoleStatus({ holeNum, par, status, detail }) {
  dom.holeStatusList.removeAttribute('hidden');

  // Find or create row
  let row = document.getElementById(`hole-row-${holeNum}`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'hole-status-row';
    row.id = `hole-row-${holeNum}`;
    row.innerHTML = `
      <span class="hole-status-icon pending" id="hole-icon-${holeNum}">○</span>
      <span class="hole-status-name">Hole ${holeNum}${par ? ` (Par ${par})` : ''}</span>
      <span class="hole-status-detail" id="hole-detail-${holeNum}"></span>
    `;
    dom.holeStatusInner.appendChild(row);
  }

  const icon = document.getElementById(`hole-icon-${holeNum}`);
  const detailEl = document.getElementById(`hole-detail-${holeNum}`);

  const iconMap = {
    pending:  { cls: 'pending', html: '○' },
    running:  { cls: 'running', html: '<span class="spinner"></span>' },
    done:     { cls: 'done',    html: '✓' },
    error:    { cls: 'error',   html: '✕' },
  };

  const info = iconMap[status] || iconMap.pending;
  icon.className = `hole-status-icon ${info.cls}`;
  icon.innerHTML = info.html;
  if (detail) detailEl.textContent = detail;

  // Auto-scroll to latest
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Called by generator.js when PDF is ready */
export function handleGenerationDone({ pdfUrl, holeCount }) {
  AppState.generation.isRunning = false;
  AppState.generation.pdfUrl = pdfUrl;

  setProgress(100, `Done! ${holeCount} hole${holeCount !== 1 ? 's' : ''} generated.`);

  // Show PDF preview
  dom.pdfPreviewFrame.src = pdfUrl;
  dom.pdfPreviewTitle.textContent =
    `${AppState.courseName || 'Yardage Book'} — ${holeCount} Holes`;
  dom.pdfPreviewArea.removeAttribute('hidden');

  // Wire download button
  dom.btnDownload.onclick = () => {
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `${(AppState.courseName || 'yardage-book').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
    a.click();
  };
}

/** Called by generator.js on unrecoverable error */
export function handleGenerationError({ message }) {
  AppState.generation.isRunning = false;
  AppState.generation.error = message;

  dom.errorMessage.textContent = message;
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

  dom.btnResetColors.addEventListener('click', resetColors);

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
