const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
const lightMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');

const map = L.map('map', {
  center: [32.1, 34.8],
  zoom: 8,
  layers: [darkMap]
});

let isDark = true;
function toggleMapTheme() {
  map.removeLayer(isDark ? darkMap : lightMap);
  map.addLayer(isDark ? lightMap : darkMap);
  isDark = !isDark;
}

const alertSound = document.getElementById('alertSound');
const searchInput = document.getElementById('searchCities');
const cityListElem = document.getElementById('cityList');
const popupAlert = document.getElementById('popupAlert');
const timeline = document.getElementById('timeline');

let cityCoords = {};
let allCities = new Set();
let mapOverlays = [];

fetch('/cities-il.json')
  .then(res => res.json())
  .then(data => {
    data.forEach(city => {
      cityCoords[city.name] = [city.lat, city.lon];
      allCities.add(city.name);
    });
    renderCityList();
  });

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
        cityListElem.innerHTML = '';
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

function popup(msg) {
  popupAlert.innerText = msg;
  popupAlert.style.display = 'block';
  setTimeout(() => {
    popupAlert.style.display = 'none';
  }, 4000);
}

function addEmojiMarker(coords, emoji) {
  const icon = L.divIcon({ className: '', html: `<div style="font-size:20px">${emoji}</div>`, iconSize: [24, 24] });
  const marker = L.marker(coords, { icon }).addTo(map);
  mapOverlays.push(marker);
  return marker;
}

function addCircle(coords, label) {
  const circle = L.circle(coords, {
    radius: 500,
    color: 'red',
    fillColor: 'red',
    fillOpacity: 0.3
  }).addTo(map).bindPopup(label);
  mapOverlays.push(circle);
}

function drawLine(from, to) {
  const line = L.polyline([from, to], {
    color: 'red',
    dashArray: '5, 10'
  }).addTo(map);
  mapOverlays.push(line);
}

function clearMapOverlays() {
  mapOverlays.forEach(item => map.removeLayer(item));
  mapOverlays = [];
}

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

function fetchAlerts() {
  fetch('/alert')
    .then(res => res.json())
    .then(updateAlerts)
    .catch(err => console.error('Fetch alert error:', err));
}

function updateAlerts(alerts) {
  if (!Array.isArray(alerts)) return;

  alerts.forEach(alert => {
    const title = alert.title || '';
    const desc = alert.desc || alert.instructions || '';
    const time = new Date().toLocaleTimeString();
    const cities = alert.cities || alert.data || [];
    const hasCities = Array.isArray(cities) && cities.length > 0;
    const cityList = hasCities ? cities.join(', ') : '⚠️ עיר לא מזוהה';

    // Event ended
    if (desc.includes('הסתיים')) {
      popup(`✅ ${desc}`);
      clearMapOverlays();
      return;
    }

    // Create timeline card
    const div = document.createElement('div');
    div.className = 'timeline-event';
    div.innerHTML = `<strong>${title}</strong><br>🕒 ${time}<br>${desc}<br>${cityList}`;
    timeline.appendChild(div);
    setTimeout(() => div.remove(), 20000); // remove after 20 sec

    const isRocket = alert.cat === '1' || title.includes('שיגור') || title.includes('רקטה');
    const isUAV = alert.cat === '6' || title.includes('כטב"ם') || title.includes('כלי טיס') || alert.type === 'hostileAircraftIntrusion';

    // For each city in the alert
    cities.forEach(city => {
      if (!cityCoords[city]) {
        console.warn('Missing coords for city:', city);
        return;
      }
      const coords = cityCoords[city];

      // Emoji
      const emoji = isRocket ? '🚀' : isUAV ? '✈️' : '⚠️';
      addEmojiMarker(coords, emoji);
      addCircle(coords, `${emoji} ${city} — ${title}`);

      // Dotted line from launch site
      const origin = guessLaunchOrigin(title + desc);
      if (origin) drawLine(origin, coords);

      // Sound + popup
      if (isRocket || isUAV) {
        alertSound.play();
        popup(`${emoji} ${desc}`);
      }
    });
  });
}

fetchAlerts();
setInterval(fetchAlerts, 10000);
