/**
 * map.js — Leaflet map, Nominatim search, and bounding box selection
 *
 * Provides:
 *   initMap({ containerId, onBboxChange }) — initializes everything
 *   getBbox()        — returns current { latmin, lonmin, latmax, lonmax } or null
 *   getCourseName()  — returns current course name string
 *   onBboxChange     — callback passed via initMap options
 */

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

let _map = null;
let _drawnItems = null;
let _currentBbox = null;
let _currentCourseName = '';
let _onBboxChange = null;

// Search debounce timer
let _searchTimer = null;
const SEARCH_DEBOUNCE_MS = 400;

// Nominatim usage policy: identify app, max 1 req/s
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_HEADERS = { 'Accept-Language': 'en' };

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function getBbox() {
  return _currentBbox;
}

export function getCourseName() {
  return _currentCourseName;
}

/**
 * Initialize the Leaflet map with search + draw tools.
 *
 * @param {object} opts
 * @param {string} opts.containerId   — DOM id of the map div
 * @param {function} opts.onBboxChange — called with (bbox, courseName) when selection changes
 */
export function initMap({ containerId, onBboxChange }) {
  _onBboxChange = onBboxChange;

  // ── Create map ──────────────────────────────────────────────────────────────
  _map = L.map(containerId, {
    center: [39.5, -98.35],   // Continental US center
    zoom: 4,
    zoomControl: true,
  });

  // OSM tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(_map);

  // ── Draw layer ──────────────────────────────────────────────────────────────
  _drawnItems = new L.FeatureGroup();
  _map.addLayer(_drawnItems);

  const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      rectangle: {
        shapeOptions: {
          color: '#2d7a4a',
          weight: 2.5,
          fillColor: '#34e884',
          fillOpacity: 0.12,
        },
        showArea: false,
      },
      // Disable all other draw tools
      polyline:    false,
      polygon:     false,
      circle:      false,
      marker:      false,
      circlemarker: false,
    },
    edit: {
      featureGroup: _drawnItems,
      remove: true,
    },
  });
  _map.addControl(drawControl);

  // Handle rectangle draw complete
  _map.on(L.Draw.Event.CREATED, (e) => {
    _drawnItems.clearLayers();
    _drawnItems.addLayer(e.layer);
    const bounds = e.layer.getBounds();
    updateBbox({
      latmin: bounds.getSouth(),
      lonmin: bounds.getWest(),
      latmax: bounds.getNorth(),
      lonmax: bounds.getEast(),
    }, '');
  });

  // Handle rectangle deleted
  _map.on(L.Draw.Event.DELETED, () => {
    if (_drawnItems.getLayers().length === 0) {
      updateBbox(null, '');
    }
  });

  // Handle rectangle edited
  _map.on(L.Draw.Event.EDITED, (e) => {
    e.layers.eachLayer((layer) => {
      const bounds = layer.getBounds();
      updateBbox({
        latmin: bounds.getSouth(),
        lonmin: bounds.getWest(),
        latmax: bounds.getNorth(),
        lonmax: bounds.getEast(),
      }, _currentCourseName);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────────────
  initSearch();

  // ── Geolocation (zoom to user's area on load if permitted) ─────────────────
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        _map.setView([pos.coords.latitude, pos.coords.longitude], 10);
      },
      () => { /* permission denied or unavailable — keep default view */ },
      { timeout: 5000 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bbox Management
// ─────────────────────────────────────────────────────────────────────────────

function updateBbox(bbox, courseName) {
  _currentBbox = bbox;
  _currentCourseName = courseName || '';
  if (_onBboxChange) _onBboxChange(bbox, _currentCourseName);
}

/**
 * Draw a bbox rectangle on the map (e.g. from a Nominatim suggestion).
 * Replaces any existing drawn rectangle.
 *
 * @param {{ latmin, lonmin, latmax, lonmax }} bbox
 * @param {string} courseName
 */
function applyBbox(bbox, courseName) {
  _drawnItems.clearLayers();

  const bounds = L.latLngBounds(
    [bbox.latmin, bbox.lonmin],
    [bbox.latmax, bbox.lonmax]
  );

  const rect = L.rectangle(bounds, {
    color: '#2d7a4a',
    weight: 2.5,
    fillColor: '#34e884',
    fillOpacity: 0.12,
  });
  _drawnItems.addLayer(rect);

  _map.fitBounds(bounds, { padding: [40, 40] });
  updateBbox(bbox, courseName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Search (Nominatim)
// ─────────────────────────────────────────────────────────────────────────────

function initSearch() {
  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  const clearBtn = document.getElementById('search-clear');

  if (!input || !results) return;

  // Input handler with debounce
  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearBtn.hidden = query.length === 0;

    if (_searchTimer) clearTimeout(_searchTimer);

    if (query.length < 3) {
      hideResults(results);
      return;
    }

    _searchTimer = setTimeout(() => runSearch(query, results), SEARCH_DEBOUNCE_MS);
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    hideResults(results);
    input.focus();
  });

  // Keyboard navigation in results
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideResults(results);
      input.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = results.querySelector('[role=option]');
      if (first) first.focus();
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-overlay')) {
      hideResults(results);
    }
  });
}

async function runSearch(query, resultsEl) {
  showLoading(resultsEl);

  try {
    const params = new URLSearchParams({
      q:              query,
      format:         'json',
      limit:          '6',
      addressdetails: '1',
    });

    const resp = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: NOMINATIM_HEADERS,
    });

    if (!resp.ok) throw new Error(`Nominatim error ${resp.status}`);
    const data = await resp.json();
    renderResults(data, resultsEl);
  } catch (err) {
    console.error('Search failed:', err);
    resultsEl.innerHTML = `<li class="search-loading">Search unavailable. Try again.</li>`;
    resultsEl.removeAttribute('hidden');
  }
}

function renderResults(places, resultsEl) {
  if (!places || places.length === 0) {
    resultsEl.innerHTML = `<li class="search-loading">No results found.</li>`;
    resultsEl.removeAttribute('hidden');
    return;
  }

  resultsEl.innerHTML = '';

  for (const place of places) {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');

    // Extract a short display name
    const displayName = formatPlaceName(place);
    const detail = formatPlaceDetail(place);

    // Does this result have a usable bounding box?
    const hasBbox = place.boundingbox && place.boundingbox.length === 4;
    const isGolfCourse = isGolf(place);

    li.innerHTML = `
      <span class="result-name">${escapeHtml(displayName)}</span>
      <span class="result-detail">${escapeHtml(detail)}</span>
      ${hasBbox ? `<span class="result-use-bbox">${isGolfCourse ? '⛳ Use boundary' : '📍 Use boundary'}</span>` : ''}
    `;

    li.addEventListener('click', () => selectPlace(place, resultsEl));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectPlace(place, resultsEl);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = li.nextElementSibling;
        if (next) next.focus();
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = li.previousElementSibling;
        if (prev) {
          prev.focus();
        } else {
          document.getElementById('search-input')?.focus();
        }
      }
    });

    resultsEl.appendChild(li);
  }

  resultsEl.removeAttribute('hidden');
}

function selectPlace(place, resultsEl) {
  const displayName = formatPlaceName(place);

  document.getElementById('search-input').value = displayName;
  document.getElementById('search-clear').hidden = false;
  hideResults(resultsEl);

  const lat = parseFloat(place.lat);
  const lon = parseFloat(place.lon);

  if (place.boundingbox && place.boundingbox.length === 4) {
    // Nominatim returns [south, north, west, east]
    const [south, north, west, east] = place.boundingbox.map(parseFloat);
    applyBbox(
      { latmin: south, lonmin: west, latmax: north, lonmax: east },
      displayName
    );
  } else {
    // Just fly to the location, let the user draw manually
    _map.setView([lat, lon], 15);
    updateBbox(null, displayName);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function showLoading(resultsEl) {
  resultsEl.innerHTML = '<li class="search-loading">Searching…</li>';
  resultsEl.removeAttribute('hidden');
}

function hideResults(resultsEl) {
  resultsEl.setAttribute('hidden', '');
  resultsEl.innerHTML = '';
}

function isGolf(place) {
  return (
    place.type === 'golf_course' ||
    (place.address && place.address.leisure === 'golf_course') ||
    String(place.display_name).toLowerCase().includes('golf')
  );
}

function formatPlaceName(place) {
  // Prefer short name from address object, fall back to first segment of display_name
  if (place.name) return place.name;
  return place.display_name.split(',')[0].trim();
}

function formatPlaceDetail(place) {
  const parts = place.display_name.split(',').map(s => s.trim());
  // Show up to 3 parts after the name, deduplicated
  const name = formatPlaceName(place);
  const rest = parts.filter(p => p !== name).slice(0, 3);
  return rest.join(', ');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
