// --- Map Initialization ---
const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
const lightMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');

const map = L.map('map', {
  center: [32.1, 34.8], // Centered on Israel
  zoom: 8,
  layers: [darkMap] // Default map theme
});

let isDark = true;
function toggleMapTheme() {
  map.removeLayer(isDark ? darkMap : lightMap);
  map.addLayer(isDark ? lightMap : darkMap);
  isDark = !isDark;
  console.log(`Map theme toggled to ${isDark ? 'Dark' : 'Light'}`);
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
let mapOverlays = []; // Stores static markers, circles, lines for easy clearing
let animatedMarkers = []; // Stores markers that are currently animating

// --- Socket.IO Client Setup (for Real-time) ---
// backendUrl is defined globally in index.html, so it's directly accessible here.
if (typeof backendUrl === 'undefined') {
  console.error("Error: backendUrl is not defined. Please ensure it's set in index.html correctly.");
  // Fallback to local for dev if backendUrl is not set. REMOVE IN PRODUCTION.
  // backendUrl = "http://localhost:3000"; // UNCOMMENT FOR LOCAL TESTING ONLY IF DEPLOYMENT FAILS
}
const socket = io(backendUrl);

// Listen for alert events pushed from the server via WebSocket
socket.on('alert', (alertData) => {
  console.log('[Client] WebSocket Alert Received:', alertData);
  // Ensure alertData is always treated as an array for consistent processing
  const alerts = Array.isArray(alertData) ? alertData : [alertData];
  updateAlerts(alerts);
});

// Listen for a specific event from the server to clear map visuals (e.g., when no alerts are active)
socket.on('clear_map_visuals', () => {
  console.log('[Client] Server signaled to clear map visuals (no active alerts).');
  clearMapOverlays();
  clearTimeline();
  timeline.innerHTML = '<div class="timeline-event">✅ אין התרעות פעילות כרגע</div>';
});

// Handle WebSocket connection errors
socket.on('connect_error', (err) => {
  console.error('[Client] WebSocket connection error:', err.message);
  popup(`⚠️ תקלת תקשורת לשרת: ${err.message}`);
});
socket.on('disconnect', (reason) => {
  console.warn('[Client] WebSocket disconnected:', reason);
  popup(`❌ התנתקות מהשרת: ${reason}`);
  clearMapOverlays(); // Clear map if disconnected
  clearTimeline();
  timeline.innerHTML = '<div class="timeline-event">❌ התנתקת מהשרת</div>';
});
socket.on('connect', () => {
    console.log('[Client] WebSocket connected!');
});


// --- City Data Loading & Search Functions ---
// Fetches city data from the backend. Uses the global backendUrl.
fetch(backendUrl + '/cities-il.json')
  .then(res => {
    if (!res.ok) {
      // Throw an error if the HTTP response status is not 2xx
      throw new Error(`HTTP error! Status: ${res.status} - ${res.statusText}`);
    }
    return res.json();
  })
  .then(data => {
    if (!Array.isArray(data)) {
        throw new Error("cities-il.json did not return an array.");
    }
    data.forEach(city => {
      if (city.name && city.lat !== undefined && city.lon !== undefined) {
        cityCoords[city.name] = [city.lat, city.lon];
        allCities.add(city.name);
      } else {
        console.warn("Skipping malformed city entry:", city);
      }
    });
    renderCityList(); // Populate the city list after data is loaded
    console.log(`Cities loaded successfully: ${Object.keys(cityCoords).length} cities.`);
  })
  .catch(err => {
    console.error("Error loading cities-il.json:", err);
    popup(`❌ שגיאת טעינת ערים: ${err.message}. (בדוק קונסול)`);
  });

function renderCityList(filter = '') {
  const f = filter.trim().toLowerCase();
  cityListElem.innerHTML = ''; // Clear previous list items

  // Filter, sort, and slice for performance on large lists
  [...allCities]
    .filter(name => name.toLowerCase().includes(f))
    .sort((a, b) => a.localeCompare(b, 'he', { sensitivity: 'base' })) // Sort in Hebrew locale
    .slice(0, 30) // Limit to top 30 results for autocomplete
    .forEach(name => {
      const div = document.createElement('div');
      div.className = 'cityItem';
      div.innerText = name;
      div.onclick = () => {
        focusOnCity(name);
        searchInput.value = name;
        cityListElem.innerHTML = ''; // Clear the list after user selection
      };
      cityListElem.appendChild(div);
    });
}

searchInput.addEventListener('input', () => {
  renderCityList(searchInput.value);
});

function focusOnCity(city) {
  const coords = cityCoords[city];
  if (coords) {
    map.flyTo(coords, 12); // Fly to city coordinates with zoom level 12
    console.log(`Map flew to: ${city} (${coords})`);
  } else {
    console.warn(`Attempted to focus on unknown city: ${city}`);
    popup(`מיקום העיר ${city} לא נמצא.`);
  }
}

// --- Popup Notification System ---
function popup(msg) {
  popupAlert.innerText = msg;
  popupAlert.style.display = 'block';
  setTimeout(() => {
    popupAlert.style.display = 'none';
  }, 4000); // Popup visible for 4 seconds
}

// --- Map Overlay Management (Markers, Circles, Lines) ---
function addEmojiMarker(coords, emoji) {
  // Use a div icon for emojis to ensure consistent sizing and display
  const icon = L.divIcon({ className: '', html: `<div style="font-size:20px">${emoji}</div>`, iconSize: [24, 24] });
  const marker = L.marker(coords, { icon }).addTo(map);
  mapOverlays.push(marker); // Track for easy clearing later
  return marker;
}

function addCircle(coords, label) {
  const circle = L.circle(coords, {
    radius: 500, // Fixed radius for the alert zone in meters
    color: 'red',
    fillColor: 'red',
    fillOpacity: 0.3
  }).addTo(map).bindPopup(label); // Add popup on click
  mapOverlays.push(circle); // Track for easy clearing later
}

function drawLine(from, to) {
  const line = L.polyline([from, to], {
    color: 'red',
    dashArray: '5, 10' // Dotted line style
  }).addTo(map);
  mapOverlays.push(line); // Track for easy clearing later
}

function clearMapOverlays() {
  mapOverlays.forEach(item => {
    if (map.hasLayer(item)) map.removeLayer(item);
  });
  mapOverlays = [];
  animatedMarkers.forEach(marker => { // Ensure any ongoing animated markers are also cleared
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  animatedMarkers = [];
  console.log('Map overlays cleared.');
}

function clearTimeline() {
  timeline.innerHTML = ''; // Clears all entries in the timeline display
  console.log('Timeline cleared.');
}

// --- Animated Rocket/UAV Path Simulation ---
// Calculates distance between two lat/lon points in kilometers (Haversine formula)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance; // Distance in km
}

function simulateRocket(originCoords, targetCoords, emoji, duration = 10000) {
  const rocketIcon = L.divIcon({ html: `<div style="font-size:24px">${emoji}</div>`, className: '', iconSize: [24, 24] });
  const rocketMarker = L.marker(originCoords, { icon: rocketIcon }).addTo(map);
  animatedMarkers.push(rocketMarker); // Keep track of animating markers

  drawLine(originCoords, targetCoords); // Draw the static path line (remains after animation)

  let startTime = null;

  function animate(currentTime) {
    if (!startTime) startTime = currentTime;
    const elapsedTime = currentTime - startTime;
    const progress = Math.min(elapsedTime / duration, 1); // Progress from 0 to 1

    // Calculate intermediate position
    const lat = originCoords[0] + (targetCoords[0] - originCoords[0]) * progress;
    const lon = originCoords[1] + (targetCoords[1] - originCoords[1]) * progress;
    rocketMarker.setLatLng([lat, lon]);

    if (progress < 1) {
      requestAnimationFrame(animate); // Continue animation
    } else {
      // Animation finished, remove the animated marker after a short delay
      setTimeout(() => {
        if (map.hasLayer(rocketMarker)) map.removeLayer(rocketMarker);
        animatedMarkers = animatedMarkers.filter(m => m !== rocketMarker); // Remove from tracking
        console.log(`Animation finished for ${emoji} to ${targetCoords}`);
      }, 500);
    }
  }
  requestAnimationFrame(animate); // Start animation frame loop
}

// Function to guess launch origin based on keywords in alert text with priority
function guessLaunchOrigin(text) {
  const lowerText = text.toLowerCase(); // Convert to lowercase for case-insensitive matching

  // Define potential origins with their coordinates and a priority.
  // Order matters: Higher priority comes first in the array.
  const prioritizedSources = [
    { keywords: ['איראן', 'טווח ארוך', 'בליסטי', 'בלייסטי', 'טילי שיוט'], coords: [32.0, 51.0], name: 'איראן' }, // Long-range/Ballistic missiles/Cruise missiles
    { keywords: ['סוריה', 'רמת הגולן'], coords: [33.4, 36.2], name: 'סוריה' }, // Syria / Golan Heights
    { keywords: ['לבנון', 'חיזבאללה', 'צפון הארץ'], coords: [33.25, 35.5], name: 'לבנון' }, // Lebanon / Hezbollah / North
    { keywords: ['עזה', 'חמאס', 'דרום הארץ', 'עוטף עזה', 'רצועת עזה'], coords: [31.5, 34.466], name: 'עזה' } // Gaza / Hamas / South
  ];

  for (const source of prioritizedSources) {
    for (const keyword of source.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        console.log(`[Origin Guess] Found keyword "${keyword}", inferring origin: ${source.name}`);
        return source.coords; // Return the coordinate of the first matching, highest-priority source
      }
    }
  }

  console.log('[Origin Guess] No specific origin keyword found in alert text.');
  return null; // If no specific origin keywords found
}

// --- Main Alert Processing Function ---
// This function is called when a new alert is received via WebSocket
function updateAlerts(alerts) {
  console.log('[updateAlerts] Processing new alerts batch:', alerts);

  // Always clear previous map overlays when new alerts arrive, as only the latest are relevant.
  clearMapOverlays();
  clearTimeline(); // Clear timeline to always show only the latest batch of alerts at the top

  // Filter out 'none' type alerts and ensure alerts have relevant content
  const relevantAlerts = alerts.filter(alert =>
    alert.type !== 'none' && (alert.title || alert.desc || alert.instructions || (Array.isArray(alert.cities) && alert.cities.length > 0))
  );

  if (relevantAlerts.length === 0) {
    timeline.innerHTML = '<div class="timeline-event">✅ אין התרעות פעילות כרגע</div>';
    console.log('[updateAlerts] No relevant alerts to display after filtering.');
    return; // Exit if no relevant alerts
  }

  // Process and display each relevant alert
  relevantAlerts.forEach(alert => {
    // Safely extract alert details, providing fallbacks for missing data
    const title = alert.title || 'התרעה כללית';
    const desc = alert.desc || alert.instructions || 'אין תיאור זמין.';
    const time = new Date().toLocaleTimeString('he-IL'); // Format time for Israel locale
    const cities = alert.cities || alert.data || []; // Use 'cities' or 'data' array
    const hasCities = Array.isArray(cities) && cities.length > 0;
    const cityList = hasCities ? cities.join(', ') : '⚠️ עיר לא מזוהה';

    console.log(`[Alert] Title: ${title}, Cities: ${cityList}, Desc: ${desc}`);

    // Handle "Event Ended" alerts specifically
    if (desc.includes('הסתיים') || title.includes('הסתיים') || alert.type === 'newsFlash' && desc.includes('הסתיים')) {
      popup(`✅ ${title}: ${desc}`);
      clearMapOverlays(); // Clear map when an event ends
      timeline.innerHTML = '<div class="timeline-event">✅ האירוע הסתיים, אין התרעות פעילות כרגע</div>'; // Update timeline
      console.log('[Alert] Event ended, clearing map and timeline.');
      return; // Stop processing further for this "ended" alert
    }

    // Add alert to timeline (prepended to show latest at top)
    const div = document.createElement('div');
    div.className = 'timeline-event';
    div.innerHTML = `<strong>${title}</strong><br>🕒 ${time}<br>${desc}<br>${cityList}`;
    timeline.prepend(div); // Add to the beginning of the timeline
    setTimeout(() => {
      if (div.parentNode) div.remove(); // Auto-remove from timeline after 20 seconds
      console.log(`Timeline event removed after 20s: ${title}`);
    }, 20000);

    // Determine alert type for emoji and sound based on category or title keywords
    const isRocket = alert.cat === '1' || title.includes('שיגור') || title.includes('רקטה');
    const isUAV = alert.cat === '6' || title.includes('כטב"ם') || title.includes('כלי טיס') || alert.type === 'hostileAircraftIntrusion';
    const emoji = isRocket ? '🚀' : isUAV ? '✈️' : '⚠️'; // Default warning emoji if type is unknown

    // Process each affected city listed in the alert
    if (cities.length === 0 && (isRocket || isUAV)) {
        // If alert is a rocket/UAV but no specific cities, target center of Israel
        console.warn(`Rocket/UAV alert with no specific cities: ${title}. Targeting general center of Israel.`);
        const generalTarget = [31.5, 34.8]; // Central Israel approx
        addCircle(generalTarget, `${emoji} ישראל - התרעה כללית`);
        const origin = guessLaunchOrigin(title + desc);
        if (origin) simulateRocket(origin, generalTarget, emoji, 20000); // Longer duration for general alert
        else addEmojiMarker(generalTarget, emoji);
        alertSound.play();
        popup(`${emoji} ${desc}`);
    } else {
        cities.forEach(city => {
            const coords = cityCoords[city];
            if (!coords) {
                console.warn(`Missing coordinates for city: ${city}. Cannot display on map.`);
                return; // Skip if city coordinates are unknown
            }

            // Add static circle for the target area
            addCircle(coords, `${emoji} ${city} — ${title}`);

            // Simulate animated path from origin if applicable
            const origin = guessLaunchOrigin(title + desc);
            if (origin) {
                const distanceKm = getDistance(origin[0], origin[1], coords[0], coords[1]);
                // Adjust animation duration: Min 5s, Max 30s. Ratio: 100ms per 10km.
                const animationDuration = Math.min(Math.max(distanceKm * 10, 5000), 30000);
                simulateRocket(origin, coords, emoji, animationDuration);
            } else {
                // If no specific origin is guessed, just add a static emoji marker at the target city
                addEmojiMarker(coords, emoji);
            }

            // Play sound and show popup for critical alerts
            if (isRocket || isUAV) {
                alertSound.play();
                popup(`${emoji} ${desc}`);
            }
        });
    }
  });
}
