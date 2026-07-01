'use strict';

const MIN_ZOOM = 2;
const MAX_ZOOM = 19;

const STORAGE_KEY = 'kyorikan.defaultView';

const FALLBACK_VIEW = {
  A: { center: [35.6812, 139.7671], zoom: 13 }, // 東京駅
  B: { center: [26.2124, 127.6809], zoom: 13 }, // 那覇
};

function isValidView(v) {
  return (
    v &&
    Array.isArray(v.center) &&
    v.center.length === 2 &&
    v.center.every(Number.isFinite) &&
    Number.isFinite(v.zoom)
  );
}

function loadInitialViews() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && isValidView(saved.A) && isValidView(saved.B)) return saved;
  } catch {
    // 壊れたデータは無視してデフォルトに戻す
  }
  return FALLBACK_VIEW;
}

const INITIAL = loadInitialViews();

const maps = {};
const measurements = {
  A: { points: [], markers: [], line: null },
  B: { points: [], markers: [], line: null },
};

let primaryKey = 'A';
let isSyncing = false;
let lastNominatimRequest = 0;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function otherKey(key) {
  return key === 'A' ? 'B' : 'A';
}

function createMap(key) {
  const { center, zoom } = INITIAL[key];
  // zoomSnap: 0 で小数zoomを許可する。緯度差補正は小数のzoom差になるため必須
  const map = L.map(`map-${key}`, {
    center,
    zoom,
    zoomSnap: 0,
    zoomDelta: 0.5,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    scrollWheelZoom: false, // 標準のホイールズームは無効化し、下の自前処理に置き換える
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: MAX_ZOOM,
  }).addTo(map);
  L.control.scale({ metric: true, imperial: false, maxWidth: 150 }).addTo(map);
  enableSmoothWheelZoom(map);
  return map;
}

// Leaflet標準のスクロールズームは1ジェスチャのズーム量に上限があり、
// デバウンスで段階的に動くためタッチパッドだと引っかかる感触になる。
// wheelイベントごとに即座にsetZoomAroundすることで連続的なズームにする。
function enableSmoothWheelZoom(map) {
  map.getContainer().addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // deltaMode 1 (行単位・Firefoxのマウスホイール等) はピクセル相当に換算
      const deltaY = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      // ctrlKey=true はタッチパッドのピンチ操作（ブラウザが合成するイベント）
      const rate = e.ctrlKey ? 1 / 100 : 1 / 250;
      const target = map.getZoom() - deltaY * rate;
      map.setZoomAround(map.mouseEventToContainerPoint(e), target, { animate: false });
    },
    { passive: false }
  );
}

// ---- 縮尺同期 --------------------------------------------------------------

function setPrimary(key) {
  primaryKey = key;
  document.getElementById('primary-label').textContent = `地図${key}`;
  for (const k of ['A', 'B']) {
    document.getElementById(`panel-${k}`).classList.toggle('is-primary', k === key);
  }
}

// 基準地図と同じ m/px になるように追従地図の zoom を補正する。
// Webメルカトルでは m/px = C * cos(緯度) / 2^zoom なので、
//   追従zoom = 基準zoom + log2( cos(追従緯度) / cos(基準緯度) )
function syncSecondaryMap() {
  const primaryMap = maps[primaryKey];
  const secondaryMap = maps[otherKey(primaryKey)];

  const primaryLat = primaryMap.getCenter().lat;
  const secondaryLat = secondaryMap.getCenter().lat;
  const corrected =
    primaryMap.getZoom() +
    Math.log2(Math.cos(toRad(secondaryLat)) / Math.cos(toRad(primaryLat)));
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, corrected));

  if (Math.abs(secondaryMap.getZoom() - target) < 1e-4) return;

  // animate: false でイベントを同期発火させ、フラグで再入を確実に防ぐ
  isSyncing = true;
  secondaryMap.setZoom(target, { animate: false });
  isSyncing = false;
}

function handleViewChange(key) {
  if (isSyncing) return;
  if (key !== primaryKey) setPrimary(key); // 操作した側が基準になる
  syncSecondaryMap();
}

// ---- 距離計測 --------------------------------------------------------------

function resetMeasurement(key) {
  const m = measurements[key];
  m.markers.forEach((marker) => marker.remove());
  if (m.line) m.line.remove();
  m.points = [];
  m.markers = [];
  m.line = null;
  document.getElementById(`distance-${key}`).textContent = '—';
}

function handleMapClick(key, e) {
  const m = measurements[key];
  if (m.points.length >= 2) resetMeasurement(key);

  m.points.push(e.latlng);
  m.markers.push(
    L.circleMarker(e.latlng, {
      radius: 6,
      color: '#d3382f',
      weight: 2,
      fillColor: '#fff',
      fillOpacity: 1,
      interactive: false,
    }).addTo(maps[key])
  );

  if (m.points.length === 2) {
    m.line = L.polyline(m.points, {
      color: '#d3382f',
      weight: 2,
      dashArray: '6 4',
      interactive: false,
    }).addTo(maps[key]);
    const km = m.points[0].distanceTo(m.points[1]) / 1000;
    document.getElementById(`distance-${key}`).textContent = `${km.toFixed(2)} km`;
  }
}

// ---- 場所検索 --------------------------------------------------------------

function setSearchStatus(key, text, isError = false) {
  const el = document.getElementById(`search-status-${key}`);
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function moveTo(key, lat, lng) {
  maps[key].setView([lat, lng], maps[key].getZoom(), { animate: false });
}

async function handleSearch(key) {
  const query = document.getElementById(`search-input-${key}`).value.trim();
  if (!query) return;

  // 「35.68, 139.76」形式なら Nominatim を使わず直接移動する
  const coord = query.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,，、\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coord) {
    const lat = parseFloat(coord[1]);
    const lng = parseFloat(coord[2]);
    if (Math.abs(lat) <= 85 && Math.abs(lng) <= 180) {
      moveTo(key, lat, lng);
      setSearchStatus(key, `緯度 ${lat}, 経度 ${lng} に移動しました`);
      return;
    }
  }

  // Nominatim のレート制限（1リクエスト/秒）を守る
  const now = Date.now();
  const wait = Math.max(0, lastNominatimRequest + 1100 - now);
  lastNominatimRequest = now + wait;
  setSearchStatus(key, '検索中…');
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '1',
      'accept-language': 'ja',
      q: query,
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = await res.json();
    if (results.length === 0) {
      setSearchStatus(key, `「${query}」は見つかりませんでした`, true);
      return;
    }
    const { lat, lon, display_name: displayName } = results[0];
    moveTo(key, parseFloat(lat), parseFloat(lon));
    setSearchStatus(key, displayName);
  } catch (err) {
    setSearchStatus(key, `検索に失敗しました（${err.message}）`, true);
  }
}

// ---- 初期位置の保存（localStorage） ----------------------------------------

function flashButton(button, text) {
  const original = button.dataset.label || (button.dataset.label = button.textContent);
  button.textContent = text;
  clearTimeout(button._flashTimer);
  button._flashTimer = setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

function saveDefaultView() {
  const data = {};
  for (const k of ['A', 'B']) {
    const c = maps[k].getCenter();
    data[k] = { center: [c.lat, c.lng], zoom: maps[k].getZoom() };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  flashButton(document.getElementById('save-default'), '保存しました ✓');
}

function resetDefaultView() {
  localStorage.removeItem(STORAGE_KEY);
  isSyncing = true; // 途中状態で同期が走らないようにまとめて移動する
  for (const k of ['A', 'B']) {
    maps[k].setView(FALLBACK_VIEW[k].center, FALLBACK_VIEW[k].zoom, { animate: false });
  }
  isSyncing = false;
  setPrimary('A');
  syncSecondaryMap();
  flashButton(document.getElementById('reset-default'), '戻しました ✓');
}

// ---- 初期化 ----------------------------------------------------------------

function initPanel(key) {
  maps[key] = createMap(key);
  maps[key].on('zoomend moveend', () => handleViewChange(key));
  maps[key].on('click', (e) => handleMapClick(key, e));
  document.getElementById(`search-form-${key}`).addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch(key);
  });
  document.getElementById(`clear-${key}`).addEventListener('click', () => resetMeasurement(key));
}

initPanel('A');
initPanel('B');
setPrimary('A');
syncSecondaryMap(); // 初期表示の時点から縮尺を揃える

document.getElementById('save-default').addEventListener('click', saveDefaultView);
document.getElementById('reset-default').addEventListener('click', resetDefaultView);
