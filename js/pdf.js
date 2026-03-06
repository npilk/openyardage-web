/**
 * pdf.js — PDF assembly using jsPDF
 *
 * Assembles rendered hole canvases into a printable PDF yardage book.
 * jsPDF is loaded from CDN and available as window.jspdf.jsPDF.
 *
 * Two output modes:
 *   1. Digital / single-hole-per-page (booklet page size: 4.25" x 5.5")
 *   2. Print-ready 4-up on portrait letter (8.5" x 11") with cut guides
 *
 * Single-page layout (matches hand-made yardage book style):
 *   ┌──────────────────────────────────┐
 *   │ Left (40%)    │  Right (60%)     │
 *   │               │                  │
 *   │  Hole N       │                  │
 *   │  Par N        │  [Hole Image     │
 *   │               │   full height]   │
 *   │  (yardages)   │                  │
 *   │               │                  │
 *   │  Notes        │                  │
 *   │  ──────       │                  │
 *   │               │                  │
 *   │  ┌─────────┐  │                  │
 *   │  │ Green   │  │                  │
 *   │  │ Inset   │  │                  │
 *   │  └─────────┘  │                  │
 *   └──────────────────────────────────┘
 */

// ─────────────────────────────────────────────────────────────────────────────
// Booklet page dimensions (all mm)
// ─────────────────────────────────────────────────────────────────────────────

const BOOKLET_W = 107.95; // 4.25"
const BOOKLET_H = 139.7;  // 5.5"
const BM = 3;              // booklet margin

// Left/right panel split
const LEFT_W   = BOOKLET_W * 0.40;          // ~43mm
const RIGHT_X  = LEFT_W;
const RIGHT_W  = BOOKLET_W - LEFT_W;        // ~65mm

// Green inset: bottom ~40% of left panel
const GREEN_TOP = BOOKLET_H * 0.60;
const GREEN_H   = BOOKLET_H - GREEN_TOP - BM;
const GREEN_W   = LEFT_W - BM * 2;

// Letter page for print layout
const LETTER_W = 215.9;  // 8.5"
const LETTER_H = 279.4;  // 11"

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble all rendered holes into a single-hole-per-page PDF (booklet size).
 *
 * @param {object} opts
 * @param {Array<{ holeNum, par, holeCanvas, greenCanvas }>} opts.holes
 * @param {string} opts.courseName
 * @param {object} opts.colors
 * @returns {Promise<string>} PDF data URI
 */
export async function assemblePdf({ holes, courseName, colors }) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [BOOKLET_W, BOOKLET_H],
  });

  // Cover page
  addCoverPage(pdf, courseName, colors, BOOKLET_W, BOOKLET_H);

  // One page per hole
  const sorted = [...holes].sort((a, b) => a.holeNum - b.holeNum);
  for (const hole of sorted) {
    pdf.addPage([BOOKLET_W, BOOKLET_H], 'portrait');
    await drawHolePage(pdf, hole, colors, 0, 0);
  }

  return pdf.output('datauristring');
}

/**
 * Assemble a print-ready 4-up PDF on portrait letter pages.
 * Each letter page has 4 booklet pages arranged in a 2x2 grid with cut guides.
 *
 * @param {object} opts  — same as assemblePdf
 * @returns {Promise<string>} PDF data URI
 */
export async function assemblePrintPdf({ holes, courseName, colors }) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
  });

  // Build the list of booklet pages in the correct order for cutting/stacking
  // Order: 18, 16, blank, 1, blank, 2, 17, 15, 14, 12, 3, 5, 4, 6, 13, 11, 10, blank, 7, title, 8, blank, 9, blank
  const holeMap = new Map(holes.map(h => [h.holeNum, { type: 'hole', ...h }]));
  const order = [18, 16, null, 1, null, 2, 17, 15, 14, 12, 3, 5, 4, 6, 13, 11, 10, null, 7, 'cover', 8, null, 9, null];

  const pages = order.map(item => {
    if (item === 'cover') return { type: 'cover', courseName, colors };
    if (item === null) return { type: 'blank' };
    return holeMap.get(item) || { type: 'blank' };
  });

  // Quadrant origins (TL, TR, BL, BR)
  const origins = [
    [0, 0],
    [BOOKLET_W, 0],
    [0, BOOKLET_H],
    [BOOKLET_W, BOOKLET_H],
  ];

  let isFirstSheet = true;
  for (let i = 0; i < pages.length; i += 4) {
    if (!isFirstSheet) pdf.addPage('letter', 'portrait');
    isFirstSheet = false;

    // Draw 4 booklet pages on this sheet
    for (let q = 0; q < 4; q++) {
      const page = pages[i + q];
      const [ox, oy] = origins[q];

      if (page.type === 'cover') {
        addCoverPage(pdf, page.courseName, page.colors, BOOKLET_W, BOOKLET_H, ox, oy);
      } else if (page.type === 'hole') {
        await drawHolePage(pdf, page, colors, ox, oy);
      }
      // 'blank' pages — leave empty
    }

    // Cut guides
    drawCutGuides(pdf);
  }

  return pdf.output('datauristring');
}

// ─────────────────────────────────────────────────────────────────────────────
// Page builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw a cover page at the given origin.
 */
function addCoverPage(pdf, courseName, colors, w, h, ox = 0, oy = 0) {
  // White background
  pdf.setFillColor(255, 255, 255);
  pdf.rect(ox, oy, w, h, 'F');

  // Black text
  pdf.setTextColor(0, 0, 0);

  const cx = ox + w / 2;
  const cy = oy + h / 2;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(courseName || 'Golf Course', cx, cy - 8, { align: 'center' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text('Yardage Book', cx, cy + 4, { align: 'center' });

  pdf.setFontSize(5);
  pdf.text('Generated by OpenYardage', cx, oy + h - 4, { align: 'center' });
  pdf.setFontSize(4);
  pdf.text('Map data \u00A9 OpenStreetMap contributors', cx, oy + h - 2, { align: 'center' });
}

/**
 * Draw a single hole page at the given origin (ox, oy).
 * This is the core layout matching the hand-made yardage book style.
 */
async function drawHolePage(pdf, hole, colors, ox, oy) {
  // Composite the hole image onto a rough-colored canvas sized to the panel's
  // aspect ratio, so the entire right panel is one PNG with no separate fill.
  // This avoids PDF color-management mismatches between vector fills and raster.
  const holeDataUrl  = await canvasToDataUrl(
    makeBackgroundComposite(hole.holeCanvas, colors.rough, RIGHT_W, BOOKLET_H)
  );
  const greenDataUrl = await canvasToDataUrl(hole.greenCanvas);

  // ── Right panel: single image covering the full panel ──
  pdf.addImage(holeDataUrl, 'PNG', ox + RIGHT_X, oy, RIGHT_W, BOOKLET_H);

  // ── Left panel: white background ──
  pdf.setFillColor(255, 255, 255);
  pdf.rect(ox, oy, LEFT_W, BOOKLET_H, 'F');

  // Hole number
  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text(`Hole  ${hole.holeNum}`, ox + BM, oy + BM + 6);

  // Par
  let textY = oy + BM + 13;
  if (hole.par) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.text(`Par  ${hole.par}`, ox + BM, textY);
    textY += 6;
  }

  // Placeholder space for HDCP and yardage data (future)
  // Draw faint placeholder lines for yardage dots
  textY += 3;
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.2);
  for (let row = 0; row < 3; row++) {
    const y = textY + row * 5;
    // Left dot placeholder
    pdf.circle(ox + BM + 2, y, 1.2, 'S');
    pdf.line(ox + BM + 5, y, ox + BM + 16, y);
    // Right dot placeholder
    pdf.circle(ox + BM + 20, y, 1.2, 'S');
    pdf.line(ox + BM + 23, y, ox + BM + 34, y);
  }

  // Notes section
  const notesY = textY + 20;
  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.text('Notes', ox + BM, notesY);
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.3);
  pdf.line(ox + BM, notesY + 1, ox + LEFT_W - BM, notesY + 1);

  // ── Green inset: bottom of left panel ──
  // White background for green inset area
  pdf.setFillColor(255, 255, 255);
  pdf.rect(ox + BM, oy + GREEN_TOP, GREEN_W, GREEN_H, 'F');

  // Fit image and align to bottom of the area
  const gi = fitImage(
    hole.greenCanvas.width, hole.greenCanvas.height,
    ox + BM, oy + GREEN_TOP,
    GREEN_W, GREEN_H,
  );
  // Bottom-align the image instead of centering
  const bottomY = oy + GREEN_TOP + GREEN_H - gi.h;
  pdf.addImage(greenDataUrl, 'PNG', gi.x, bottomY, gi.w, gi.h);
}

/**
 * Draw cut guides on a letter-sized page (dashed lines at midpoints).
 */
function drawCutGuides(pdf) {
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.15);

  // Vertical center line
  drawDashedLine(pdf, LETTER_W / 2, 0, LETTER_W / 2, LETTER_H, 4, 2);
  // Horizontal center line
  drawDashedLine(pdf, 0, LETTER_H / 2, LETTER_W, LETTER_H / 2, 4, 2);
}

function drawDashedLine(pdf, x1, y1, x2, y2, dashLen, gapLen) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;

  let pos = 0;
  while (pos < len) {
    const segEnd = Math.min(pos + dashLen, len);
    pdf.line(
      x1 + ux * pos, y1 + uy * pos,
      x1 + ux * segEnd, y1 + uy * segEnd,
    );
    pos = segEnd + gapLen;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new canvas sized to panelW:panelH aspect ratio, filled with
 * roughColor, then draw srcCanvas centered inside it. This bakes the
 * letterbox padding into the image so the PDF needs no separate fill layer,
 * eliminating vector-vs-raster color management mismatches.
 */
function makeBackgroundComposite(srcCanvas, roughColor, panelW, panelH) {
  const panelAspect = panelW / panelH;
  const imgAspect   = srcCanvas.width / srcCanvas.height;

  let compositeW, compositeH;
  if (imgAspect > panelAspect) {
    compositeW = srcCanvas.width;
    compositeH = Math.round(srcCanvas.width / panelAspect);
  } else {
    compositeH = srcCanvas.height;
    compositeW = Math.round(srcCanvas.height * panelAspect);
  }

  const canvas = document.createElement('canvas');
  canvas.width  = compositeW;
  canvas.height = compositeH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = roughColor;
  ctx.fillRect(0, 0, compositeW, compositeH);

  const x = Math.round((compositeW - srcCanvas.width)  / 2);
  const y = Math.round((compositeH - srcCanvas.height) / 2);
  ctx.drawImage(srcCanvas, x, y);

  return canvas;
}

/**
 * Convert a canvas to a data URL for jsPDF.addImage().
 */
export async function canvasToDataUrl(canvas) {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blobToDataUrl(blob);
  }
  return canvas.toDataURL('image/png');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Aspect-ratio-preserved fit (object-fit: contain).
 */
export function fitImage(imgW, imgH, boxX, boxY, boxW, boxH) {
  const imgAspect = imgW / imgH;
  const boxAspect = boxW / boxH;

  let w, h;
  if (imgAspect > boxAspect) {
    w = boxW;
    h = boxW / imgAspect;
  } else {
    h = boxH;
    w = boxH * imgAspect;
  }

  const x = boxX + (boxW - w) / 2;
  const y = boxY + (boxH - h) / 2;

  return { x, y, w, h };
}

/**
 * Hex color string to [r, g, b].
 */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
