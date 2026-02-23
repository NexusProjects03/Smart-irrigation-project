let allCrops = [];
let selectedCrops = [];

// ================= CONFIG FETCHING =================
let FIREBASE_AUTH = "";
async function getFirebaseAuthToken() {
  if (FIREBASE_AUTH) return FIREBASE_AUTH;
  try {
    const r = await fetch("/api/config");
    const d = await r.json();
    FIREBASE_AUTH = d.FIREBASE_AUTH;
  } catch (e) { console.error("Config fetch error:", e); }
  return FIREBASE_AUTH;
}

// ================= THEME & CONNECTION STATUS (NEW) =================
const themeToggle = document.getElementById('themeToggle');
const connStatus = document.getElementById('connectionStatus');
const modeToggle = document.getElementById('modeToggle');
const modeLabel = document.getElementById('modeLabel');

let isCloudMode = false;
let currentSensorData = null; // Store current readings for prediction

// ================= SMART MOTOR CONTROL =================
let activeCropForMotor = JSON.parse(localStorage.getItem('activeCropForMotor')) || null;
let currentWaterStatus = "WATER";
let currentRainForecast = "NO"; // NO, YES, EXPECTED
let lastMotorWriteState = null; // Track to avoid redundant Firebase writes

// ================= WEATHER CONFIG =================
const WEATHER_LAT = 17.7343;  // Visakhapatnam
const WEATHER_LON = 83.3130;  // Visakhapatnam
const RAIN_EXPECTED_THRESHOLD = 40; // precipitation probability % to trigger EXPECTED
let weatherApiData = null; // Store latest weather API data for display

modeToggle.addEventListener('change', (e) => {
  isCloudMode = e.target.checked;
  modeLabel.textContent = isCloudMode ? "Cloud Mode" : "USB Mode";

  // Clear current values to show change
  document.querySelectorAll('.card-value span:first-child').forEach(el => el.innerText = "--");

  // Trigger immediate reload
  loadSensor();
  loadMotorStatus();
});

// Load Theme from LocalStorage
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';

  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
});

function updateThemeIcon(theme) {
  const icon = themeToggle.querySelector('.toggle-icon');
  icon.textContent = theme === 'light' ? '🌞' : '🌙';
}

function updateConnectionStatus(isConnected) {
  if (isConnected) {
    connStatus.classList.remove('disconnected');
    connStatus.classList.add('connected');
    connStatus.querySelector('.status-text').textContent = isCloudMode ? "Cloud Connected" : "Arduino Connected";
  } else {
    connStatus.classList.remove('connected');
    connStatus.classList.add('disconnected');
    connStatus.querySelector('.status-text').textContent = "Disconnected";
  }
}

// ================= MOTOR STATUS =================
function updateMotorStatus(status) {
  const motorBadge = document.getElementById('motorStatus');
  const motorText = motorBadge.querySelector('.motor-text');
  const cautionEl = motorBadge.querySelector('.motor-caution');

  if (status === 'online' || status === 'ON') {
    motorBadge.classList.remove('motor-offline');
    motorBadge.classList.add('motor-online');
    motorText.textContent = "Motor: ON";
  } else {
    motorBadge.classList.remove('motor-online');
    motorBadge.classList.add('motor-offline');
    motorText.textContent = "Motor: OFF";
  }

  // Show/hide caution for water status
  if (cautionEl) {
    if (currentWaterStatus === "NO WATER") {
      cautionEl.classList.add('visible');
      motorBadge.classList.add('motor-no-water');
    } else {
      cautionEl.classList.remove('visible');
      motorBadge.classList.remove('motor-no-water');
    }
  }

  updateMotorTooltip();
}

// ================= RAIN STATUS =================
function updateRainStatus(rainStatus) {
  const rainBadge = document.getElementById('rainStatus');
  const rainText = rainBadge.querySelector('.rain-text');
  const rainIcon = rainBadge.querySelector('.rain-icon');

  // Remove all rain classes
  rainBadge.classList.remove('rain-no', 'rain-yes', 'rain-expected');

  if (rainStatus === "EXPECTED") {
    rainBadge.classList.add('rain-expected');
    rainText.textContent = "Rain: EXPECTED";
    if (rainIcon) rainIcon.textContent = "🌦️";
  } else {
    // Normalize rain status
    let isRaining = false;
    if (typeof rainStatus === 'string') {
      isRaining = rainStatus.toUpperCase().includes("YES") || rainStatus.toUpperCase() === "RAIN";
    } else if (typeof rainStatus === 'number') {
      isRaining = rainStatus === 1;
    }

    if (isRaining) {
      rainBadge.classList.add('rain-yes');
      rainText.textContent = "Rain: YES";
      if (rainIcon) rainIcon.textContent = "🌧️";
    } else {
      rainBadge.classList.add('rain-no');
      rainText.textContent = "Rain: NO";
      if (rainIcon) rainIcon.textContent = "☁️";
    }
  }
}

async function loadMotorStatus() {
  try {
    if (isCloudMode) {
      // In Cloud Mode, motor status is handled by loadSensor (fetching all data at once)
      // So we do nothing here to avoid double fetching or overwriting
      return;
    } else {
      const res = await fetch("/api/motor-status");
      const data = await res.json();
      updateMotorStatus(data.status);
    }
  } catch (e) {
    updateMotorStatus("offline");
  }
}


// ================= SENSOR POLLING =================
async function loadSensor() {
  try {
    let d = {};

    if (isCloudMode) {
      // FETCH FROM ROOT to get Rain, Motor, and Soil Data all at once
      const authCount = await getFirebaseAuthToken();
      const res = await fetch(`https://smartsoilhealth-bdc49-default-rtdb.asia-southeast1.firebasedatabase.app/.json?auth=${authCount}`);
      if (!res.ok) throw new Error("Firebase Error");

      const rootData = await res.json();
      if (!rootData) throw new Error("No Data");

      const sData = rootData.soilData || {};

      d = {
        temperature: sData.temperature,
        soil_moisture: sData.moisture,
        ph: sData.ph,
        // Check multiple key variations for robustness
        N: sData.nitrogen ?? sData.Nitrogen ?? sData.N,
        P: sData.phosphorus ?? sData.Phosphorus ?? sData.P,
        K: sData.potassium ?? sData.Potassium ?? sData.K,
        rainStatus: rootData.rainStatus
      };

      updateConnectionStatus(true);

      // Read water status from Firebase
      currentWaterStatus = rootData.waterStatus || "WATER";

      // Sync lastMotorWriteState from Firebase on first read
      if (lastMotorWriteState === null) {
        lastMotorWriteState = rootData.motorControl === "ON" ? "ON" : "OFF";
      }

      // Combine hardware rain sensor with weather forecast
      const hwRain = rootData.rainStatus;
      const hwIsRaining = typeof hwRain === 'string' &&
        (hwRain.toUpperCase().includes("YES") || hwRain.toUpperCase() === "RAIN");

      if (hwIsRaining) {
        currentRainForecast = "YES";
      }
      // Otherwise keep currentRainForecast from weather API

      updateRainStatus(currentRainForecast);
      updateMotorStatus(rootData.motorControl === "ON" ? "ON" : "OFF");

    } else {
      const res = await fetch("/api/sensor-data");
      if (!res.ok) throw new Error("API Error");

      d = await res.json();

      // Check if we have actual sensor data
      const hasData = d.N !== undefined && d.N !== null;
      updateConnectionStatus(hasData);

      // Update rain from USB data if available
      if (d.rainStatus !== undefined) {
        updateRainStatus(d.rainStatus);
      } else if (d.rain !== undefined) {
        updateRainStatus(d.rain); // Fallback if named 'rain'
      }
    }

    updateCard('temp', d.temperature, '°C');
    updateCard('moisture', d.soil_moisture, '%');
    updateCard('ph', d.ph, 'pH');
    updateCard('n', d.N, 'mg/kg');
    updateCard('p', d.P, 'mg/kg');
    updateCard('k', d.K, 'mg/kg');

    // Save for prediction usage
    currentSensorData = d;

    // Evaluate motor decision based on active crop
    if (isCloudMode && activeCropForMotor) {
      evaluateMotorDecision(d.soil_moisture);
    }

    // Update motor tooltip with latest data
    updateMotorTooltip();

    // Check if sensor data is valid (all zeros = invalid)
    const hasValidData = (Number(d.N) > 0 || Number(d.P) > 0 || Number(d.K) > 0);
    const predictBtn = document.querySelector('.predict-btn');
    if (predictBtn) {
      predictBtn.disabled = !hasValidData;
      if (!hasValidData) {
        predictBtn.title = "Sensor readings are 0. Connect sensors or switch mode.";
        predictBtn.style.opacity = '0.5';
      } else {
        predictBtn.title = "";
        predictBtn.style.opacity = '1';
      }
    }

  } catch (e) {
    console.error("Sensor error:", e);
    currentSensorData = null;
    updateConnectionStatus(false);
    // Disable predict button on error
    const predictBtn = document.querySelector('.predict-btn');
    if (predictBtn) { predictBtn.disabled = true; predictBtn.style.opacity = '0.5'; }
  }
}

function updateCard(id, value, unit) {
  const el = document.getElementById(id);
  const card = document.getElementById(`card-${id}`);

  const oldVal = el.innerText;
  const newVal = value ?? "--";

  if (oldVal !== String(newVal)) {
    el.innerText = newVal;
    // Trigger pulse animation
    card.classList.remove('pulse-anim');
    void card.offsetWidth; // re-flow hack
    card.classList.add('pulse-anim');
  }
}


// ================= ADD CROP (UI ONLY) =================
async function addCrop() {
  const crop = {
    name: cname.value.trim(),
    N_min: +nmin.value, N_max: +nmax.value,
    P_min: +pmin.value, P_max: +pmax.value,
    K_min: +kmin.value, K_max: +kmax.value,
    moist_min: +mmin.value, moist_max: +mmax.value,
    ph_min: +phmin.value, ph_max: +phmax.value,
    temp_min: +tmin.value, temp_max: +tmax.value
  };

  if (!crop.name) {
    alert("Please enter a crop name.");
    return;
  }

  try {
    await fetch("/api/crops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(crop)
    });

    // Clear all inputs
    document.querySelectorAll(".form-grid input").forEach(i => i.value = "");

    // Simple Toast notification or alert (keeping alert for now but phrasing improved)
    alert("✅ New Smart Crop Added Successfully!");
    loadCrops();
  } catch (e) {
    alert("Error adding crop.");
  }
}

// ================= ADD CROP (AI) =================
async function addCropAI() {
  const nameInput = document.getElementById("cname");
  const name = nameInput.value.trim();
  const btn = document.querySelector(".btn-glow-action");

  if (!name) {
    alert("Please enter a crop name first.");
    return;
  }

  // UI Loading State
  const originalText = btn.innerHTML;
  btn.innerHTML = "⏳ Asking AI...";
  btn.disabled = true;
  document.body.style.cursor = "wait";

  try {
    const res = await fetch("/api/ai-add-crop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name })
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Server Response Not JSON: " + text.substring(0, 150));
    }

    if (!res.ok) throw new Error(data.error || "AI Error");

    // Clear input
    nameInput.value = "";

    // Show the crop details in the modal popup
    loadCrops();
    openCropModal(data.crop);

  } catch (e) {
    console.error(e);
    showErrorModal(e.message);
  } finally {
    // Restore UI
    btn.innerHTML = originalText;
    btn.disabled = false;
    document.body.style.cursor = "default";
  }
}

// ================= CUSTOM ERROR MODAL =================
function showErrorModal(message) {
  let modal = document.getElementById("errorModal");

  // Create Modal if not exists
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "errorModal";
    modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
            z-index: 1000; backdrop-filter: blur(4px);
        `;

    modal.innerHTML = `
            <div style="background: var(--card-bg); padding: 25px; border-radius: 12px; max-width: 400px; width: 90%; text-align: center; border: 1px solid var(--status-danger); box-shadow: 0 10px 25px rgba(0,0,0,0.3);">
                <div style="font-size: 3rem; margin-bottom: 10px;">❌</div>
                <h3 style="margin-bottom: 10px; color: var(--text-primary);">AI Error</h3>
                <p id="errorMsgText" style="color: var(--text-secondary); margin-bottom: 20px; font-family: monospace; background: rgba(0,0,0,0.05); padding: 10px; border-radius: 6px; overflow-wrap: break-word; font-size: 0.9rem; max-height: 200px; overflow-y: auto;"></p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="copyErrBtn" style="background: var(--text-secondary); color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer;">📋 Copy Error</button>
                    <button onclick="document.getElementById('errorModal').remove()" style="background: var(--status-danger); color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer;">Close</button>
                </div>
            </div>
        `;
    document.body.appendChild(modal);
  }

  // Set Message
  document.getElementById("errorMsgText").innerText = message;

  // Copy Functionality
  document.getElementById("copyErrBtn").onclick = () => {
    navigator.clipboard.writeText(message);
    const btn = document.getElementById("copyErrBtn");
    btn.innerText = "✅ Copied!";
    setTimeout(() => { btn.innerText = "📋 Copy Error"; }, 2000);
  };
}


// ================= DELETE CROP =================
async function deleteCrop(name) {
  if (!confirm(`Delete ${name}?`)) return;

  await fetch(`/api/crops/${name}`, { method: "DELETE" });
  selectedCrops = selectedCrops.filter(c => c !== name);
  loadCrops();
}

// ================= LOAD CROPS & RENDER LIST =================
// ================= LOAD CROPS & RENDER LIST =================
let currentCropData = null; // Store current crop for modal operations
let cropsDisplayLimit = 3; // Show only 3 crops initially in main list
let validCropsCache = []; // Cache valid crops for load more

// ================= LOAD CROPS & RENDER LIST =================

// Fetch and Render (replaces old loadCrops)
async function loadCrops() {
  try {
    const res = await fetch("/api/crops");
    const allCrops = await res.json();
    // Filter out empty crops
    validCropsCache = allCrops.filter(crop => crop.name && crop.name.trim() !== "");

    // Sync active crop for motor with latest data
    if (activeCropForMotor) {
      const updated = validCropsCache.find(c => c.name === activeCropForMotor.name);
      if (updated) {
        activeCropForMotor = updated;
        localStorage.setItem('activeCropForMotor', JSON.stringify(updated));
      } else {
        // Crop was deleted - deselect
        activeCropForMotor = null;
        localStorage.removeItem('activeCropForMotor');
      }
    }

    renderCropList();
  } catch (e) {
    console.error("Failed to load crops:", e);
  }
}

// Render Only (from cache)
function renderCropList() {
  const list = document.getElementById("cropList");
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  if (!list) return;

  list.innerHTML = "";

  // Sort: Favorites first
  validCropsCache.sort((a, b) => {
    // Sort logic: Favs first, then Alphabetical?
    if (a.favorite !== b.favorite) return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    return 0;
  });

  if (validCropsCache.length === 0) {
    list.innerHTML = '<li style="opacity: 0.5; cursor: default;">No crops added yet. Use AI Assistant above!</li>';
    loadMoreBtn.style.display = "none";
    return;
  }

  // Show limited crops (Top 3)
  const cropsToShow = validCropsCache.slice(0, cropsDisplayLimit);

  cropsToShow.forEach(crop => {
    const isFav = crop.favorite === true;
    const favClass = isFav ? 'active' : '';
    const safeName = crop.name.replace(/'/g, "\\'");
    const isActive = activeCropForMotor && activeCropForMotor.name === crop.name;
    const li = document.createElement("li");
    if (isActive) li.classList.add('crop-selected');
    li.innerHTML = `
        <div class="crop-item-actions">
           <button class="fav-btn ${favClass}" onclick="event.stopPropagation(); toggleFavorite('${safeName}')">
             ${isFav ? '❤️' : '🤍'}
           </button>
           <span class="crop-name">${crop.name}</span>
        </div>
        <div class="crop-item-right">
           <button class="select-crop-btn ${isActive ? 'active' : ''}" onclick="event.stopPropagation(); selectCropForMotor('${safeName}')" title="${isActive ? 'Deselect crop' : 'Select for motor control'}">
             ${isActive ? '✅' : '🎯'}
           </button>
           <span class="crop-arrow">→</span>
        </div>
    `;
    li.onclick = () => openCropModal(crop);
    list.appendChild(li);
  });

  // Show/hide load more button
  if (validCropsCache.length > cropsDisplayLimit) {
    loadMoreBtn.style.display = "block";
    loadMoreBtn.innerHTML = `📋 View All Crops (${validCropsCache.length} total)`;
    // Override default click handler
    loadMoreBtn.onclick = openAllCropsModal;
  } else {
    loadMoreBtn.style.display = "none";
  }
}


// ================= TOGGLE FAVORITE (OPTIMISTIC UPDATE) =================
async function toggleFavorite(cropName) {
  // 1. Find and update local cache first
  const crop = validCropsCache.find(c => c.name === cropName);
  const previousState = crop ? crop.favorite : false;

  if (crop) {
    crop.favorite = !previousState; // Toggle locally
  }

  // 2. Update UI Immediately
  renderCropList();

  // Update Modal Grid if it's open
  const modal = document.getElementById("allCropsModal");
  if (modal && !modal.classList.contains("hidden")) {
    openAllCropsModal(); // Rerender grid from cache
  }

  // 3. Send API Request in background
  try {
    const res = await fetch("/api/toggle-fav", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cropName })
    });

    if (!res.ok) {
      throw new Error("API Failed");
    }
    // Success: do nothing, UI is already correct
  } catch (e) {
    console.error("Fav toggle error:", e);
    // Revert UI on error
    if (crop) {
      crop.favorite = previousState;
      renderCropList();
      if (modal && !modal.classList.contains("hidden")) openAllCropsModal();
      alert("Failed to update favorite status. Check connection.");
    }
  }
}

// ================= ALL CROPS GRID MODAL =================
function openAllCropsModal() {
  const modal = document.getElementById("allCropsModal");
  const grid = document.getElementById("allCropsGrid");
  modal.classList.remove("hidden");
  grid.innerHTML = "";

  // Use validCropsCache which is kept up-to-date
  validCropsCache.forEach(crop => {
    const isFav = crop.favorite === true;
    const safeName = crop.name.replace(/'/g, "\\'");
    const isActive = activeCropForMotor && activeCropForMotor.name === crop.name;
    const tile = document.createElement("div");
    tile.className = "crop-tile" + (isActive ? " crop-tile-selected" : "");

    tile.innerHTML = `
          <div style="position:absolute; top:10px; right:10px;">
             <button class="fav-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${safeName}')">
                ${isFav ? '❤️' : '🤍'}
             </button>
          </div>
          <div class="crop-tile-icon">🌾</div>
          <div class="crop-tile-name">${crop.name}</div>
          <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:5px;">
             pH: ${crop.ph_min || 0}-${crop.ph_max || 14}
          </div>
          <button class="select-crop-tile-btn ${isActive ? 'active' : ''}" onclick="event.stopPropagation(); selectCropForMotor('${safeName}')">
             ${isActive ? '✅ Selected' : '🎯 Select Crop'}
          </button>
      `;
    tile.onclick = () => {
      closeAllCropsModal();
      openCropModal(crop);
    };
    grid.appendChild(tile);
  });
}

function closeAllCropsModal() {
  document.getElementById("allCropsModal").classList.add("hidden");
  // Refresh main list in case favorites changed inside modal
  loadCrops();
}

// ================= CROP MODAL =================
function openCropModal(crop) {
  currentCropData = crop;

  const modal = document.getElementById("cropModal");
  modal.classList.remove("hidden");

  // Populate modal data
  document.getElementById("modalCropName").textContent = crop.name;
  document.getElementById("modalN").textContent = `${crop.N_min || 0} - ${crop.N_max || 0} mg/kg`;
  document.getElementById("modalP").textContent = `${crop.P_min || 0} - ${crop.P_max || 0} mg/kg`;
  document.getElementById("modalK").textContent = `${crop.K_min || 0} - ${crop.K_max || 0} mg/kg`;
  document.getElementById("modalPH").textContent = `${crop.ph_min || 0} - ${crop.ph_max || 0}`;
  document.getElementById("modalTemp").textContent = `${crop.temp_min || 0} - ${crop.temp_max || 0} °C`;
  document.getElementById("modalMoist").textContent = `${crop.moist_min || 0} - ${crop.moist_max || 0} %`;

  // Analysis text (if stored)
  const analysisEl = document.getElementById("modalAnalysisText");
  if (crop.analysis) {
    analysisEl.textContent = crop.analysis;
  } else {
    analysisEl.textContent = "No AI analysis available for this crop. It may have been added manually.";
  }

  // Disable compatibility check if sensor readings are invalid
  const compatBtn = document.querySelector('.btn-compat-check');
  if (compatBtn) {
    const hasValidData = currentSensorData && (Number(currentSensorData.N) > 0 || Number(currentSensorData.P) > 0 || Number(currentSensorData.K) > 0);
    compatBtn.disabled = !hasValidData;
    if (!hasValidData) {
      compatBtn.style.opacity = '0.5';
      compatBtn.title = "Sensor readings are 0. Connect sensors or switch mode.";
    } else {
      compatBtn.style.opacity = '1';
      compatBtn.title = '';
    }
  }
}

function closeCropModal() {
  document.getElementById("cropModal").classList.add("hidden");
  document.getElementById("compatResult").classList.add("hidden"); // Reset compat result
  currentCropData = null;
}

async function deleteSelectedCrop() {
  if (!currentCropData) return;

  if (!confirm(`Are you sure you want to delete "${currentCropData.name}"?`)) return;

  await fetch(`/api/crops/${currentCropData.name}`, { method: "DELETE" });
  closeCropModal();
  loadCrops();
}

// ================= ML PREDICT (Top 5 Crops) =================
// ================= ML PREDICT (Top Suitable Crops) =================
async function predict() {
  const resultBox = document.getElementById("predictionResult");
  const btn = document.querySelector('.predict-btn');

  btn.innerText = "Analyzing...";
  btn.disabled = true;

  try {
    // Guard: check if we have sensor data
    if (!currentSensorData) {
      btn.innerText = "🌱 Check Suitable Crops";
      btn.disabled = false;
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = "<span class='result-error'>❌ No sensor data available. Ensure sensors are connected or Cloud Mode is active.</span>";
      return;
    }

    // Build clean payload with numeric values only
    const payload = {
      N: Number(currentSensorData.N) || 0,
      P: Number(currentSensorData.P) || 0,
      K: Number(currentSensorData.K) || 0,
      temperature: Number(currentSensorData.temperature) || 0,
      soil_moisture: Number(currentSensorData.soil_moisture) || 0,
      ph: Number(currentSensorData.ph) || 0
    };

    console.log("Predict payload:", payload);

    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("Predict response:", data);

    btn.innerText = "🌱 Check Suitable Crops";
    btn.disabled = false;
    resultBox.classList.remove('hidden');

    if (data.error) {
      resultBox.innerHTML = `<span class='result-error'>❌ ${data.error}</span>`;
      return;
    }

    if (!data.predicted_crop && (!data.recommendations || data.recommendations.length === 0)) {
      resultBox.innerHTML = "<span class='result-error'>❌ Could not predict any crops. Try checking sensor connections.</span>";
      return;
    }

    // fallback if recommendations missing (backward compatibility)
    const recommendations = data.recommendations || data.top5 || [];
    lastPredictionResults = recommendations; // Store for modal

    // Show only top 3 initially
    const top3 = recommendations.slice(0, 3);

    let topHTML = `<span class="result-label">🏆 Top Suitable Crops</span>
      <div class="top5-list">`;

    top3.forEach((item, index) => {
      let confColor = 'var(--status-danger)';
      if (item.confidence > 80) confColor = 'var(--status-good)';
      else if (item.confidence > 40) confColor = 'var(--status-warning)';

      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;

      // Determine badge style
      let badgeStyle = 'background: #E3F2FD; color: #1565C0; border: 1px solid #90CAF9;';
      if (item.type === "Favorite") {
        badgeStyle = 'background: #FCE4EC; color: #C62828; border: 1px solid #F48FB1;';
      } else if (item.type === "Your Crops") {
        badgeStyle = 'background: #E8F5E9; color: #2E7D32; border: 1px solid #A5D6A7;';
      }
      const badgeIcon = item.type === "Favorite" ? '❤️' : item.type === "Your Crops" ? '🌿' : '🤖';
      const badgeLabel = item.type || "ML Model";

      topHTML += `
        <div class="top5-item ${index === 0 ? 'top5-best' : ''}">
          <div style="display:flex; align-items:center; gap:8px;">
              <span class="top5-rank">${medal}</span>
              <div style="display:flex; flex-direction:column;">
                  <span class="top5-name">${item.crop}</span>
                  <span style="font-size:0.7rem; padding:2px 6px; border-radius:4px; margin-top:2px; width:fit-content; ${badgeStyle}">
                      ${badgeIcon} ${badgeLabel}
                  </span>
              </div>
          </div>
          <span class="top5-conf" style="color:${confColor}">${item.confidence}%</span>
        </div>`;
    });

    topHTML += `</div>`;

    // Add View All Button if results > 3
    if (recommendations.length > 3) {
      topHTML += `
        <button class="btn-load-more" onclick="openPredictionModal()" style="margin-top:10px; width:100%; padding:10px; border:none; background:#eee; cursor:pointer; border-radius:8px; font-weight:600; color:#555;">
          📋 View All ${recommendations.length} Recommendations
        </button>
      `;
    }

    resultBox.innerHTML = topHTML;
    resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

  } catch (error) {
    console.error("Prediction Error:", error);
    btn.innerText = "🌱 Check Suitable Crops";
    btn.disabled = false;
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `<span class='result-error'>❌ Prediction failed: ${error.message}. Check if backend server is running.</span>`;
  }
}

// ================= PREDICTION MODAL (GRID) =================
let lastPredictionResults = [];

function openPredictionModal() {
  const modal = document.getElementById("predictionModal");
  const grid = document.getElementById("predictionGrid");
  modal.classList.remove("hidden");
  grid.innerHTML = "";

  lastPredictionResults.forEach((item) => {
    let confColor = 'var(--status-danger)';
    if (item.confidence > 80) confColor = 'var(--status-good)';
    else if (item.confidence > 40) confColor = 'var(--status-warning)';

    const badgeIcon = item.type === "Favorite" ? '❤️' : item.type === "Your Crops" ? '🌿' : '🤖';

    const tile = document.createElement("div");
    tile.className = "crop-tile";

    tile.innerHTML = `
          <div class="crop-tile-icon">🌾</div>
          <div class="crop-tile-name">${item.crop}</div>
          <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:5px;">
             ${badgeIcon} ${item.type || "ML Model"}
          </div>
          <div style="margin-top:8px; font-weight:bold; color:${confColor}">
             ${item.confidence}% Confidence
          </div>
      `;
    // Optional: Click to see details? Assuming yes, if it matches a known crop
    // But ML crops might not have detail data. We can try to find them in allCrops.
    tile.onclick = () => {
      const knownCrop = allCrops.find(c => c.name === item.crop);
      if (knownCrop) {
        closePredictionModal();
        openCropModal(knownCrop);
      }
    };

    grid.appendChild(tile);
  });
}

function closePredictionModal() {
  document.getElementById("predictionModal").classList.add("hidden");
}

// ================= COMPATIBILITY CHECK =================
function runCompatibilityCheck() {
  if (!currentCropData || !currentSensorData) {
    alert("No sensor data or crop data available for compatibility check.");
    return;
  }

  const crop = currentCropData;
  const sensor = currentSensorData;
  const resultDiv = document.getElementById("compatResult");
  resultDiv.classList.remove("hidden");

  const checks = [];
  let allGood = true;

  // Helper to normalize ranges
  function getRange(min, max) {
    const realMin = Math.min(min, max);
    const realMax = Math.max(min, max);
    return { min: realMin, max: realMax };
  }

  // --- Nitrogen ---
  const sN = Number(sensor.N);
  if (crop.N_min !== undefined && crop.N_max !== undefined) {
    const { min, max } = getRange(crop.N_min, crop.N_max);
    if (sN === 0) {
      allGood = false;
      checks.push({ param: "Nitrogen (N)", icon: "⚠️", status: "low", current: "0 mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Critically low or sensor error. Check connections." });
    } else if (sN < min) {
      allGood = false;
      checks.push({ param: "Nitrogen (N)", icon: "🧪", status: "low", current: sN + " mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Apply nitrogen-rich fertilizers like Urea (46-0-0), Ammonium Sulphate, or natural compost such as well-rotted farmyard manure, vermicompost, or green manure crops like Sesbania." });
    } else if (sN > max) {
      allGood = false;
      checks.push({ param: "Nitrogen (N)", icon: "🧪", status: "high", current: sN + " mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Excess nitrogen detected. Reduce nitrogen fertilizer application. Add carbon-rich mulch (straw, sawdust) to absorb excess nitrogen." });
    }
  }

  // --- Phosphorus ---
  const sP = Number(sensor.P);
  if (crop.P_min !== undefined && crop.P_max !== undefined) {
    const { min, max } = getRange(crop.P_min, crop.P_max);
    if (sP === 0) {
      allGood = false;
      checks.push({ param: "Phosphorus (P)", icon: "⚠️", status: "low", current: "0 mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Critically low or sensor error. Check connections." });
    } else if (sP < min) {
      allGood = false;
      checks.push({ param: "Phosphorus (P)", icon: "🧪", status: "low", current: sP + " mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Apply phosphorus-rich fertilizers like Single Super Phosphate (SSP), DAP (18-46-0), or bone meal. Natural options include rock phosphate, fish meal, and composted chicken manure." });
    } else if (sP > max) {
      allGood = false;
      checks.push({ param: "Phosphorus (P)", icon: "🧪", status: "high", current: sP + " mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Excess phosphorus detected. Stop phosphorus fertilizer application. Plant phosphorus-absorbing cover crops." });
    }
  }

  // --- Potassium ---
  const sK = Number(sensor.K);
  if (crop.K_min !== undefined && crop.K_max !== undefined) {
    const { min, max } = getRange(crop.K_min, crop.K_max);
    if (sK === 0) {
      allGood = false;
      checks.push({ param: "Potassium (K)", icon: "⚠️", status: "low", current: "0 mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Critically low or sensor error. Check connections." });
    } else if (sK < min) {
      allGood = false;
      checks.push({ param: "Potassium (K)", icon: "🧪", status: "low", current: sK + " mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Apply potassium-rich fertilizers like Muriate of Potash (MOP), Sulphate of Potash (SOP). Natural sources include wood ash, banana peels compost, kelp meal, and greensand." });
    } else if (sK > max) {
      allGood = false;
      checks.push({ param: "Potassium (K)", icon: "🧪", status: "high", current: sK + " mg/kg", ideal: min + " - " + max + " mg/kg", suggestion: "Excess potassium detected. Stop potassium fertilizer usage. Leach excess potassium by controlled irrigation." });
    }
  }

  // --- pH ---
  const sPH = Number(sensor.ph);
  if (crop.ph_min !== undefined && crop.ph_max !== undefined) {
    const { min, max } = getRange(crop.ph_min, crop.ph_max);
    if (sPH < min) {
      allGood = false;
      checks.push({ param: "pH Level", icon: "⚗️", status: "low", current: sPH, ideal: min + " - " + max, suggestion: "Soil is too acidic. Apply agricultural lime (calcium carbonate) or dolomite to raise pH. Wood ash can also help." });
    } else if (sPH > max) {
      allGood = false;
      checks.push({ param: "pH Level", icon: "⚗️", status: "high", current: sPH, ideal: min + " - " + max, suggestion: "Soil is too alkaline. Apply elemental sulfur, iron sulfate, or acidic organic matter (peat moss, pine needles)." });
    }
  }

  // --- Temperature ---
  const sTemp = Number(sensor.temperature);
  if (crop.temp_min !== undefined && crop.temp_max !== undefined) {
    const { min, max } = getRange(crop.temp_min, crop.temp_max);
    if (sTemp < min) {
      allGood = false;
      checks.push({ param: "Temperature", icon: "🌡️", status: "low", current: sTemp + " °C", ideal: min + " - " + max + " °C", suggestion: "Temperature is too low. Consider using mulch to retain soil warmth, plastic row covers, or a greenhouse." });
    } else if (sTemp > max) {
      allGood = false;
      checks.push({ param: "Temperature", icon: "🌡️", status: "high", current: sTemp + " °C", ideal: min + " - " + max + " °C", suggestion: "Temperature is too high. Use shade nets (50% shade cloth), increase irrigation frequency, apply thick mulch layer." });
    }
  }

  // --- Moisture ---
  const sMoist = Number(sensor.soil_moisture);
  if (crop.moist_min !== undefined && crop.moist_max !== undefined) {
    const { min, max } = getRange(crop.moist_min, crop.moist_max);
    if (sMoist < min) {
      allGood = false;
      checks.push({ param: "Soil Moisture", icon: "💧", status: "low", current: sMoist + " %", ideal: min + " - " + max + " %", suggestion: "Soil is too dry. Increase irrigation frequency. Use drip irrigation for efficient watering. Apply organic mulch to retain moisture." });
    } else if (sMoist > max) {
      allGood = false;
      checks.push({ param: "Soil Moisture", icon: "💧", status: "high", current: sMoist + " %", ideal: min + " - " + max + " %", suggestion: "Soil is over-saturated. Reduce irrigation immediately. Ensure proper drainage channels are clear." });
    }
  }

  // --- Build Result HTML ---
  if (allGood) {
    resultDiv.innerHTML = `
      <div class="compat-success">
        <div class="compat-icon-big">✅</div>
        <h3>Fully Compatible!</h3>
        <p>Your current soil conditions are within the ideal range for <strong>${crop.name}</strong>. This crop can be grown successfully in your soil.</p>
      </div>`;
  } else {
    let issueHTML = `
      <div class="compat-fail">
        <div class="compat-icon-big">⚠️</div>
        <h3>Adjustments Needed</h3>
        <p>${checks.length} parameter(s) are outside the ideal range for <strong>${crop.name}</strong>.</p>
        <div class="compat-issues">`;

    checks.forEach(c => {
      const statusColor = c.status === "low" ? "#FF9800" : "#F44336";
      const statusLabel = c.status === "low" ? "TOO LOW ↓" : "TOO HIGH ↑";
      issueHTML += `
        <div class="compat-issue-card">
          <div class="compat-issue-header">
            <span>${c.icon} ${c.param}</span>
            <span class="compat-status-tag" style="background:${statusColor}">${statusLabel}</span>
          </div>
          <div class="compat-issue-values">
            <span>Current: <strong>${c.current}</strong></span>
            <span>Ideal: <strong>${c.ideal}</strong></span>
          </div>
          <div class="compat-suggestion">💡 ${c.suggestion}</div>
        </div>`;
    });

    issueHTML += `</div></div>`;
    resultDiv.innerHTML = issueHTML;
  }

  resultDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ================= CROP SELECTION FOR MOTOR =================
function selectCropForMotor(cropName) {
  // Toggle: if already selected, deselect
  if (activeCropForMotor && activeCropForMotor.name === cropName) {
    activeCropForMotor = null;
    localStorage.removeItem('activeCropForMotor');
  } else {
    const crop = validCropsCache.find(c => c.name === cropName);
    if (!crop) return;
    activeCropForMotor = crop;
    localStorage.setItem('activeCropForMotor', JSON.stringify(crop));
  }

  // Update UI
  renderCropList();
  updateMotorTooltip();

  // Re-render all crops modal if open
  const modal = document.getElementById("allCropsModal");
  if (modal && !modal.classList.contains("hidden")) {
    openAllCropsModal();
  }

  // Immediately evaluate motor decision
  if (currentSensorData && isCloudMode) {
    evaluateMotorDecision(currentSensorData.soil_moisture);
  }
}

// ================= MOTOR DECISION LOGIC =================
function evaluateMotorDecision(moisture) {
  if (!activeCropForMotor || !isCloudMode) return;

  const currentMoisture = Number(moisture);
  if (isNaN(currentMoisture)) return;

  const moistMin = Number(activeCropForMotor.moist_min) || 0;
  const moistMax = Number(activeCropForMotor.moist_max) || 100;

  // Block: No water in the tank
  if (currentWaterStatus === "NO WATER") {
    if (lastMotorWriteState === "ON") {
      writeMotorToFirebase("OFF");
      console.log("⚠️ Motor OFF: No water in tank (safety)");
    }
    return;
  }

  // Block: Rain is active
  if (currentRainForecast === "YES") {
    if (lastMotorWriteState === "ON") {
      writeMotorToFirebase("OFF");
      console.log("🌧️ Motor OFF: Rain is active");
    }
    return;
  }

  // Calculate target moisture (when to stop motor)
  let targetMoisture;
  if (currentRainForecast === "EXPECTED") {
    // Only fill to midpoint of the range (50% of required)
    targetMoisture = moistMin + (moistMax - moistMin) / 2;
    console.log(`🌦️ Rain expected: Target moisture = ${targetMoisture}% (midpoint)`);
  } else {
    // Normal: fill to max - 10% of max (latency buffer)
    targetMoisture = moistMax - (0.10 * moistMax);
    console.log(`💧 Normal mode: Target moisture = ${targetMoisture}% (max - 10%)`);
  }

  // Motor ON: moisture is at or below minimum
  if (currentMoisture <= moistMin && lastMotorWriteState !== "ON") {
    writeMotorToFirebase("ON");
    console.log(`🟢 Motor ON: Moisture ${currentMoisture}% ≤ min ${moistMin}%`);
  }
  // Motor OFF: moisture reached target
  else if (currentMoisture >= targetMoisture && lastMotorWriteState !== "OFF") {
    writeMotorToFirebase("OFF");
    console.log(`🔴 Motor OFF: Moisture ${currentMoisture}% ≥ target ${targetMoisture}%`);
  }
}

async function writeMotorToFirebase(status) {
  try {
    const authCount = await getFirebaseAuthToken();
    const url = `https://smartsoilhealth-bdc49-default-rtdb.asia-southeast1.firebasedatabase.app/motorControl.json?auth=${authCount}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(status)
    });
    if (res.ok) {
      lastMotorWriteState = status;
      updateMotorStatus(status);
      console.log(`✅ Motor ${status}: Written to Firebase`);
    }
  } catch (e) {
    console.error("❌ Failed to write motor status to Firebase:", e);
  }
}

// ================= MOTOR TOOLTIP =================
function updateMotorTooltip() {
  const tooltip = document.getElementById('motorTooltip');
  if (!tooltip) return;

  let html = '';

  if (activeCropForMotor) {
    const moistMin = activeCropForMotor.moist_min || 0;
    const moistMax = activeCropForMotor.moist_max || 100;
    const currentMoist = currentSensorData ? (currentSensorData.soil_moisture ?? '--') : '--';

    // Only show rain-related target info when relevant
    let targetLabel = '';
    if (currentRainForecast === "EXPECTED") {
      const target = moistMin + (moistMax - moistMin) / 2;
      targetLabel = `<div class="tooltip-row warning"><span>�️ Rain Expected</span><span>Target: ${target.toFixed(0)}%</span></div>`;
    } else if (currentRainForecast === "YES") {
      targetLabel = `<div class="tooltip-row warning"><span>🌧️ Motor Blocked</span><span>Rain Active</span></div>`;
    }

    html = `
      <div class="tooltip-header">🌾 ${activeCropForMotor.name}</div>
      <div class="tooltip-row"><span>💧 Moisture Range</span><span>${moistMin}% - ${moistMax}%</span></div>
      <div class="tooltip-row"><span>📊 Current Moisture</span><span>${currentMoist}%</span></div>
      ${targetLabel}
    `;
  } else {
    html = `<div class="tooltip-header">No crop selected</div>
            <div class="tooltip-row dim"><span>Select a crop for smart motor control</span></div>`;
  }

  // Water warning
  if (currentWaterStatus === "NO WATER") {
    html += `<div class="tooltip-row danger"><span>⚠️ No water in the tank</span></div>`;
  }

  tooltip.innerHTML = html;
}

// ================= WEATHER FORECAST (Open-Meteo) =================
async function fetchWeatherForecast() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&hourly=rain,precipitation,precipitation_probability&current=temperature_2m,relative_humidity_2m,rain,weather_code,wind_speed_10m&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather API error");
    const data = await res.json();

    const now = new Date();
    const hourly = data.hourly;
    if (!hourly || !hourly.time) return;

    // Find closest hour index
    let currentIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < hourly.time.length; i++) {
      const t = new Date(hourly.time[i]);
      const diff = Math.abs(now - t);
      if (diff < minDiff) {
        minDiff = diff;
        currentIdx = i;
      }
    }

    // Check current rain (from API)
    const currentRain = hourly.rain[currentIdx] || 0;
    const currentPrecip = hourly.precipitation[currentIdx] || 0;
    const currentProb = hourly.precipitation_probability[currentIdx] || 0;

    // Compute max probability in next 6 hours
    let maxProb = 0;
    const lookAhead = Math.min(currentIdx + 6, hourly.precipitation_probability.length);
    for (let i = currentIdx; i < lookAhead; i++) {
      maxProb = Math.max(maxProb, hourly.precipitation_probability[i] || 0);
    }

    if (currentRain > 0 || currentPrecip > 0.5) {
      currentRainForecast = "YES";
    } else if (maxProb >= RAIN_EXPECTED_THRESHOLD) {
      currentRainForecast = "EXPECTED";
    } else {
      currentRainForecast = "NO";
    }

    // Store weather data for dashboard display
    weatherApiData = {
      rain: currentRain,
      precipitation: currentPrecip,
      probability: currentProb,
      maxProbability6h: maxProb,
      current: data.current || null
    };

    updateRainStatus(currentRainForecast);
    updateWeatherDisplay();
    console.log(`🌤️ Weather forecast: Rain = ${currentRainForecast}, Prob = ${currentProb}%, Max6h = ${maxProb}%`);

    // Send rain status to Firebase
    await writeRainToFirebase(currentRainForecast);

  } catch (e) {
    console.error("Weather forecast error:", e);
  }
}

// Write rain status to Firebase
async function writeRainToFirebase(status) {
  try {
    const authCount = await getFirebaseAuthToken();
    const url = `https://smartsoilhealth-bdc49-default-rtdb.asia-southeast1.firebasedatabase.app/rainStatus.json?auth=${authCount}`;
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(status)
    });
    console.log(`🌧️ Rain status '${status}' written to Firebase`);
  } catch (e) {
    console.error("Failed to write rain status to Firebase:", e);
  }
}

// Update weather info display on dashboard
function updateWeatherDisplay() {
  const weatherInfo = document.getElementById('weatherInfo');
  if (!weatherInfo || !weatherApiData) return;

  const cur = weatherApiData.current;
  let html = '';

  if (cur) {
    html += `<div class="weather-row"><span>🌡️ Temp</span><span>${cur.temperature_2m?.toFixed(1) ?? '--'}°C</span></div>`;
    html += `<div class="weather-row"><span>💨 Wind</span><span>${cur.wind_speed_10m?.toFixed(1) ?? '--'} km/h</span></div>`;
    html += `<div class="weather-row"><span>💧 Humidity</span><span>${cur.relative_humidity_2m ?? '--'}%</span></div>`;
  }

  html += `<div class="weather-row"><span>🌧️ Rain Now</span><span>${weatherApiData.rain?.toFixed(1) ?? '0'} mm</span></div>`;
  html += `<div class="weather-row"><span>📊 Chance (now)</span><span>${weatherApiData.probability ?? 0}%</span></div>`;
  html += `<div class="weather-row"><span>📈 Max 6h</span><span>${weatherApiData.maxProbability6h ?? 0}%</span></div>`;

  weatherInfo.innerHTML = html;
}

// ================= AUTO =================
setInterval(loadSensor, 5000);
setInterval(loadMotorStatus, 5000);
setInterval(fetchWeatherForecast, 15 * 60 * 1000); // Every 15 minutes
loadSensor();
loadMotorStatus();
loadCrops();
fetchWeatherForecast(); // Initial weather fetch
updateMotorTooltip(); // Initial tooltip render
