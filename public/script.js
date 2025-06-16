// Function to guess launch origin based on **DIRECT GEOGRAPHICAL KEYWORDS ONLY** in alert text.
// This is an **ULTRA-CONSERVATIVE** approach to minimize potential misattribution.
// If no direct geographical keyword is found, no origin line will be drawn.
// Returns { coords: [lat, lon], name: 'OriginName' } or null.
function guessLaunchOrigin(text) {
  const lowerText = text.toLowerCase();

  // Define explicit geographical origins with their coordinates and names.
  // Order matters: Higher priority comes first in the array.
  const directSources = [
    { keywords: ['איראן'], coords: [32.0, 51.0], name: 'איראן' },
    { keywords: ['סוריה', 'רמת הגולן'], coords: [33.4, 36.2], name: 'סוריה' },
    { keywords: ['לבנון', 'חיזבאללה', 'צפון הארץ', 'גבול הצפון'], coords: [33.25, 35.5], name: 'לבנון' },
    { keywords: ['עזה', 'חמאס', 'דרום הארץ', 'עוטף עזה', 'רצועת עזה', 'גבול הדרום'], coords: [31.5, 34.466], name: 'עזה' }
  ];

  for (const source of directSources) {
    for (const keyword of source.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        console.log(`[Origin Guess - Ultra-Conservative] Found direct keyword "${keyword}", inferring origin: ${source.name}`);
        return { coords: source.coords, name: source.name }; // Return object with coords and name
      }
    }
  }

  console.log('[Origin Guess - Ultra-Conservative] No explicit geographical origin keyword found in alert text. Not inferring origin.');
  return null; // If no direct geographical origin keyword found, do not draw a path.
}

// ... (rest of the script.js remains the same above this point) ...


// --- Main Alert Processing Function ---
// This function is called when a new alert is received via WebSocket
function updateAlerts(alerts) {
  console.log('[updateAlerts] Processing new alerts batch:', alerts);

  clearMapOverlays();
  clearTimeline();

  const relevantAlerts = alerts.filter(alert =>
    alert.type !== 'none' && (alert.title || alert.desc || alert.instructions || (Array.isArray(alert.cities) && alert.cities.length > 0))
  );

  if (relevantAlerts.length === 0) {
    timeline.innerHTML = '<div class="timeline-event">✅ אין התרעות פעילות כרגע</div>';
    console.log('[updateAlerts] No relevant alerts to display after filtering.');
    return;
  }

  relevantAlerts.forEach(alert => {
    const title = alert.title || 'התרעה כללית';
    const desc = alert.desc || alert.instructions || 'אין תיאור זמין.';
    const time = new Date().toLocaleTimeString('he-IL');
    const cities = alert.cities || alert.data || [];
    const hasCities = Array.isArray(cities) && cities.length > 0;
    const cityList = hasCities ? cities.join(', ') : '⚠️ עיר לא מזוהה';

    // Attempt to guess origin for display in timeline/map
    const inferredOrigin = guessLaunchOrigin(title + " " + desc); // Pass combined text

    // Handle "Event Ended" alerts
    if (desc.includes('הסתיים') || title.includes('הסתיים') || alert.type === 'newsFlash' && desc.includes('הסתיים')) {
      popup(`✅ ${title}: ${desc}`);
      clearMapOverlays();
      timeline.innerHTML = '<div class="timeline-event">✅ האירוע הסתיים, אין התרעות פעילות כרגע</div>';
      console.log('[Alert] Event ended, clearing map and timeline.');
      return;
    }

    // Prepare timeline content, including inferred origin name if available
    let timelineContent = `<strong>${title}</strong><br>🕒 ${time}<br>${desc}<br>${cityList}`;
    if (inferredOrigin) {
        timelineContent += `<br>מקור משוער: ${inferredOrigin.name}`; // Add inferred origin name
    }


    const div = document.createElement('div');
    div.className = 'timeline-event';
    div.innerHTML = timelineContent; // Use the prepared content
    timeline.prepend(div);
    setTimeout(() => {
      if (div.parentNode) div.remove();
      console.log(`Timeline event removed after 20s: ${title}`);
    }, 20000);

    const isRocket = alert.cat === '1' || title.includes('שיגור') || title.includes('רקטה');
    const isUAV = alert.cat === '6' || title.includes('כטב"ם') || title.includes('כלי טיס') || alert.type === 'hostileAircraftIntrusion';
    const emoji = isRocket ? '🚀' : isUAV ? '✈️' : '⚠️';

    if (cities.length === 0 && (isRocket || isUAV)) {
        // If alert is a rocket/UAV but no specific cities, target center of Israel
        console.warn(`Rocket/UAV alert with no specific cities: ${title}. Targeting general center of Israel.`);
        const generalTarget = [31.5, 34.8];
        addCircle(generalTarget, `${emoji} ישראל - התרעה כללית`);
        if (inferredOrigin) simulateRocket(inferredOrigin.coords, generalTarget, emoji, 20000);
        else addEmojiMarker(generalTarget, emoji);
        alertSound.play();
        popup(`${emoji} ${desc}`);
    } else {
        cities.forEach(city => {
            const coords = cityCoords[city];
            if (!coords) {
                console.warn(`Missing coordinates for city: ${city}. Cannot display on map.`);
                return;
            }

            addCircle(coords, `${emoji} ${city} — ${title}`);

            if (inferredOrigin) {
                const distanceKm = getDistance(inferredOrigin.coords[0], inferredOrigin.coords[1], coords[0], coords[1]);
                const animationDuration = Math.min(Math.max(distanceKm * 10, 5000), 30000);
                simulateRocket(inferredOrigin.coords, coords, emoji, animationDuration);
            } else {
                addEmojiMarker(coords, emoji); // Static marker if no origin guess
            }

            if (isRocket || isUAV) {
                alertSound.play();
                popup(`${emoji} ${desc}`);
            }
        });
    }
  });
}
