// --- Map Initialization ---
const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
const lightMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');

const map = L.map('map', {
  center: [32.1, 34.8],
  zoom: 8,
  layers: [darkMap] // Default to dark map
});

let isDark = true;
function toggleMapTheme() {
  map.removeLayer(isDark ? darkMap : lightMap);
  map.addLayer(isDark ? lightMap : darkMap);
  isDark = !isDark;
}

// --- DOM Elements ---
const alertSound = document.getElementById('alertSound');
const searchInput = document.getElementById('searchCities');
const cityListElem = document.getElementById('cityList');
const popupAlert = document.getElementById('popupAlert');
const timeline = document.getElementById('timeline');

// --- Global State Variables ---
let cityCoords = {};
let allCities = new Set();
let mapOverlays = []; // Stores static markers, circles, lines
let animatedMarkers = []; // Stores markers that are currently animating

// --- Socket.IO Client Setup (for Real-time) ---
// Since frontend and backend are now on the SAME domain (Render),
// no explicit backendUrl is needed here, io() connects to current host.
const socket = io(); // Connects to the same host that served this HTML

// Listen for alert events from the server (pushed via WebSocket)
socket.on('alert', (alertData) => {
  console.log('[Client] Received alert via WebSocket:', alertData);
  const alerts = Array.isArray(alertData) ? alertData : [alertData];
  updateAlerts(alerts);
});

// Listen for a clear map signal from the server (when Pikud sends 'none' type)
socket.on('clear_map_visuals', () => {
  console.log('[Client] Clearing map visuals (no active alerts).');
  clearMapOverlays();
  clearTimeline();
  timeline.innerHTML = '<div class="timeline-event">✅ אין התרעות פעילות כרגע</div>';
});

// --- City Data & Search Functions ---
// Load city data from cities-il.json file (now served by Render backend on same domain)
fetch('/cities-il.json') // <--- Relative path is now correct!
  .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch cities-il.json: ${res.statusText}`);
      return res.json();
  })
  .then(data => {
    data.forEach(city => {
      cityCoords[city.name] = [city.lat, city.lon];
      allCities.add(city.name);
    });
    renderCityList();
    console.log("Cities loaded successfully:", Object.keys(cityCoords).length);
  })
  .catch(err => console.error("Error loading cities-il.json:", err));

function renderCityList(filter = '') {
  const f = filter.trim().toLowerCase();
  cityListElem.innerHTML = '';

  [...allCities]
    .filter(name => name.toLowerCase().includes(f))
    .sort()
    .slice(0, 30)
    .forEach(name => {
      const div = document.createElement('div');
      div.className = 'cityItem';
      div.innerText = name;
      div.onclick = () => {
        focusOnCity(name);
        searchInput.value = name;
        cityListElem.innerHTML = ''; // Clear list after selection
      };
      cityListElem.appendChild(div);
    });
}

searchInput.addEventListener('input', () => {
  renderCityList(searchInput.value);
});

function focusOnCity(city) {
  const coords = cityCoords[city];
  if (coords) map.flyTo(coords, 12);
}

// --- Popup & Map Overlay Management ---
function popup(msg) {
  popupAlert.innerText = msg;
  popupAlert.style.display = 'block';
  setTimeout(() => {
    popupAlert.style.display = 'none';
  }, 4000); // Popup display duration
}

function addEmojiMarker(coords, emoji) {
  const icon = L.divIcon({ className: '', html: `<div style="font-size:20px">${emoji}</div>`, iconSize: [24, 24] });
  const marker = L.marker(coords, { icon }).addTo(map);
  mapOverlays.push(marker); // Track for clearing
  return marker;
}

function addCircle(coords, label) {
  const circle = L.circle(coords, {
    radius: 500, // Approximate radius for alert zone
    color: 'red',
    fillColor: 'red',
    fillOpacity: 0.3
  }).addTo(map).bindPopup(label);
  mapOverlays.push(circle); // Track for clearing
}

function drawLine(from, to) {
  const line = L.polyline([from, to], {
    color: 'red',
    dashArray: '5, 10' // Dotted line style
  }).addTo(map);
  mapOverlays.push(line); // Track for clearing
}

function clearMapOverlays() {
  mapOverlays.forEach(item => map.removeLayer(item));
  mapOverlays = [];
  animatedMarkers.forEach(marker => { // Ensure animated markers are also cleared
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  animatedMarkers = [];
}

function clearTimeline() {
  timeline.innerHTML = ''; // Clears all entries in the timeline
}

// --- Animated Rocket/UAV Path Simulation ---
function simulateRocket(originCoords, targetCoords, emoji, duration = 10000) { // duration in ms
  const rocketIcon = L.divIcon({ html: `<div style="font-size:24px">${emoji}</div>`, className: '', iconSize: [24, 24] });
  const rocketMarker = L.marker(originCoords, { icon: rocketIcon }).addTo(map);
  animatedMarkers.push(rocketMarker); // Track animated markers separately

  drawLine(originCoords, targetCoords); // Draw the static path line (remains after animation)

  let startTime = null;

  function animate(currentTime) {
    if (!startTime) startTime = currentTime;
    const elapsedTime = currentTime - startTime;
    const progress = Math.min(elapsedTime / duration, 1);

    const lat = originCoords[0] + (targetCoords[0] - originCoords[0]) * progress;
    const lon = originCoords[1] + (targetCoords[1] - originCoords[1]) * progress;
    rocketMarker.setLatLng([lat, lon]);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Rocket reached target, remove the animated marker after a short delay
      setTimeout(() => {
        if (map.hasLayer(rocketMarker)) map.removeLayer(rocketMarker);
        animatedMarkers = animatedMarkers.filter(m => m !== rocketMarker); // Remove from tracking
      }, 500);
    }
  }
  requestAnimationFrame(animate);
}

// --- Origin Guessing for Animations ---
function guessLaunchOrigin(text) {
  const sources = {
    'עזה': [31.5, 34.466],
    'לבנון': [33.25, 35.5],
    'צפון': [33.1, 35.65],
    'סוריה': [33.4, 36.2],
    'איראן': [32.0, 51.0],
    'דרום': [31.2, 34.3]
  };
  for (const key in sources) {
    if (text.includes(key)) return sources[key];
  }
  return null;
}

// --- Main Alert Processing Function ---
function updateAlerts(alerts) {
  // Clear map overlays ONLY if this is a new set of alerts that are NOT 'none' types
  clearMapOverlays();
  clearTimeline(); // Clear timeline to show only latest batch of relevant alerts at the top

  const relevantAlerts = alerts.filter(alert => alert.type !== 'none' && (alert.title || alert.desc || alert.instructions));

  if (relevantAlerts.length === 0) {
    timeline.innerHTML = '<div class="timeline-event">✅ אין התרעות פעילות כרגע</div>';
    return;
  }

  // Process and display each relevant alert
  relevantAlerts.forEach(alert => {
    const title = alert.title || 'התרעה';
    const desc = alert.desc || alert.instructions || '—';
    const time = new Date().toLocaleTimeString();
    const cities = alert.cities || alert.data || []; // Ensure 'cities' or 'data' array is used
    const hasCities = Array.isArray(cities) && cities.length > 0;
    const cityList = hasCities ? cities.join(', ') : '⚠️ עיר לא מזוהה';

    // Handle "Event Ended" alerts
    if (desc.includes('הסתיים') || title.includes('הסתיים')) {
      popup(`✅ ${title}: ${desc}`);
      clearMapOverlays(); // Clear map when an event ends
      timeline.innerHTML = '<div class="timeline-event">✅ אין התרעות פעילות כרגע</div>'; // Update timeline
      return; // Stop processing this "ended" alert
    }

    // Add alert to timeline (prepended to show latest at top)
    const div = document.createElement('div');
    div.className = 'timeline-event';
    div.innerHTML = `<strong>${title}</strong><br>🕒 ${time}<br>${desc}<br>${cityList}`;
    timeline.prepend(div); // Add to the beginning of the timeline
    setTimeout(() => div.remove(), 20000); // Auto-remove from timeline after 20 seconds

    // Determine alert type for emoji and sound
    const isRocket = alert.cat === '1' || title.includes('שיגור') || title.includes('רקטה');
    const isUAV = alert.cat === '6' || title.includes('כטב"ם') || title.includes('כלי טיס') || alert.type === 'hostileAircraftIntrusion';

    // Process each affected city
    cities.forEach(city => {
      const coords = cityCoords[city];
      if (!coords) {
        console.warn('Missing coordinates for city:', city);
        return; // Skip if city coordinates are unknown
      }

      // Determine emoji based on type
      const emoji = isRocket ? '🚀' : isUAV ? '✈️' : '⚠️';

      // Add static circle for the target area
      addCircle(coords, `${emoji} ${city} — ${title}`);

      // Simulate animated path from origin if applicable
      const origin = guessLaunchOrigin(title + desc);
      if (origin) {
        simulateRocket(origin, coords, emoji);
      } else {
        // If no origin guessed (e.g., general alert), just add a static emoji marker at the target city
        addEmojiMarker(coords, emoji);
      }

      // Play sound and show popup for critical alerts
      if (isRocket || isUAV) {
        alertSound.play();
        popup(`${emoji} ${desc}`);
      }
    });
  });
}
