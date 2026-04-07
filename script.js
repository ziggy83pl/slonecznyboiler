﻿// CALCULATOR
// 1. Definicja inputs (sprawdź czy ID zgadzają się z HTML!)
const inputs = {
    volume:  { el: document.getElementById('range-volume'),  out: document.getElementById('val-volume'),  unit: ' L' },
    // heater: USUNIĘTE - teraz obsługiwane dynamicznie przez tablicę heatersState
    persons: { el: document.getElementById('range-persons'), out: document.getElementById('val-persons'), unit: '' },
    price:   { el: document.getElementById('range-price'),   out: document.getElementById('val-price'),   unit: ' zł' },
    sunny:   { el: document.getElementById('range-sunny'),   out: document.getElementById('val-sunny'),   unit: '' },
    tilt:    { el: document.getElementById('range-tilt'),    out: document.getElementById('val-tilt'),    unit: '°' },
    orient:  { el: document.getElementById('select-orientation'), out: null, unit: '' },
    panelPower: { el: document.getElementById('select-panel-power'), out: null, unit: '' },
    panelsCount: { el: document.getElementById('range-panels-count'), out: document.getElementById('val-panels-count'), unit: ' szt.' },
    insulation: { el: document.getElementById('range-insulation'), out: document.getElementById('val-insulation'), unit: '' },
};
const calcModeEl = document.getElementById('select-calc-mode');
const CALC_STORAGE_KEY = 'solarBoilerCalcStateV1';
let isRestoringCalculatorState = false;

// 2. Sprawdź czy wszystkie elementy istnieją
// (jeśli któryś zwróci null w konsoli — masz błąd ID w HTML)

// State for animations Helpers
let animationState = {
    previousExCost: 0,
    currentMode: 'boiler', // 'boiler' lub 'buffer'
    heaters: [3.0],
    boilerOrientation: 'vertical' // 'vertical' or 'horizontal'
};

// Aktualne dane pogodowe dla korekty temperaturowej PV
const weatherState = {
    temperatureC: null,
    radiationWm2: null
};

const INSULATION_LEVELS = [
    { label: 'Brak', cm: 0 },
    { label: 'Podstawowa', cm: 5 },
    { label: 'Dobra', cm: 10 },
    { label: 'Standard Plus', cm: 12 },
    { label: 'Bardzo dobra', cm: 15 },
    { label: 'Premium', cm: 20 }
];

function getInsulationMeta(levelRaw) {
    const maxLevel = INSULATION_LEVELS.length - 1;
    const level = Number.isFinite(levelRaw) ? Math.max(0, Math.min(maxLevel, Math.round(levelRaw))) : 2;
    return INSULATION_LEVELS[level] || INSULATION_LEVELS[2];
}

function formatInsulationValue(levelRaw) {
    const meta = getInsulationMeta(levelRaw);
    return `${meta.cm} cm (${meta.label})`;
}

function getTemperatureEfficiencyFactor(ambientTempC, radiationWm2) {
    if (!Number.isFinite(ambientTempC) || !Number.isFinite(radiationWm2)) return 1;

    // Uproszczony model temperatury ogniwa:
    // Tcell = Tamb + ((NOCT - 20) / 800) * G
    const NOCT = 45;
    const gammaPmp = -0.0035; // -0.35%/°C (typowy panel mono PERC)
    const cellTempC = ambientTempC + ((NOCT - 20) / 800) * radiationWm2;
    const factor = 1 + gammaPmp * (cellTempC - 25);

    // Ograniczenie skrajnych wartości dla stabilności kalkulatora
    return Math.max(0.75, Math.min(1.05, factor));
}

/**
 * Animates a number value in a DOM element.
 * @param {HTMLElement} element The element to update.
 * @param {number} start The starting number.
 * @param {number} end The final number.
 * @param {number} duration Animation duration in ms.
 * @param {object} options Formatting options {prefix, suffix, decimals}.
 */
function animateValue(element, start, end, duration, { prefix = '', suffix = '', decimals = 0, formatter = null } = {}) {
    if (!element) return;
    if (element.animationFrameId) cancelAnimationFrame(element.animationFrameId);

    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        const currentValue = start + (end - start) * ease;
        
        const valStr = formatter ? formatter(currentValue) : currentValue.toFixed(decimals);
        element.textContent = `${prefix}${valStr}${suffix}`;

        if (progress < 1) element.animationFrameId = requestAnimationFrame(step);
        else {
            const endStr = formatter ? formatter(end) : end.toFixed(decimals);
            element.textContent = `${prefix}${endStr}${suffix}`;
        }
    };
    element.animationFrameId = requestAnimationFrame(step);
}

/**
 * Rotates a point (px, py) around an origin (ox, oy) by an angle (cos_t, sin_t).
 */
function rotatePoint(px, py, ox, oy, cos_t, sin_t) {
    const x_translated = px - ox;
    const y_translated = py - oy;
    const x_rotated = x_translated * cos_t - y_translated * sin_t;
    const y_rotated = x_translated * sin_t + y_translated * cos_t;
    return { x: ox + x_rotated, y: oy + y_rotated };
}

/**
 * Draws a cooling curve based on standby losses.
 * Standard loss: ~0.8 kWh / 100L / 24h
 */
function drawCoolingChart(vol, insulationLevel = 1) {
    const canvas = document.getElementById('coolingChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    // Skalowanie dla ekranów High DPI i zapobieganie rozmyciu
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Mapowanie poziomów izolacji na kWh strat / 100L / 24h
    const lossFactors = [2.5, 1.5, 1.0, 0.8, 0.6, 0.4]; // kWh / 100L / 24h dla: 0,5,10,12,15,20 cm
    const factor = lossFactors[insulationLevel] !== undefined ? lossFactors[insulationLevel] : 1.0;

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const startTemp = 55;
    const ambientTemp = 20;
    // Straty postojowe w kWh na dobę
    const standbyKwh = (vol / 100) * factor;
    // Spadek temperatury: deltaT = Q / (m * c)
    // Dla 24h:
    const totalDeltaT = (standbyKwh * 3600) / (vol * 4.18);
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; // Niebieski
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 2]);
    ctx.moveTo(0, h * 0.2); // Linia startowa 55 stopni
    
    const points = 24;
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#3b82f6';
    
    // Dynamiczny wsp??czynnik ch?odzenia k
    const k = -Math.log((startTemp - totalDeltaT - ambientTemp) / (startTemp - ambientTemp)) / 24;

    for(let i = 0; i <= points; i++) {
        const t = i / points;
        // Wyk?adniczy spadek temperatury
        const currentTemp = ambientTemp + (startTemp - ambientTemp) * Math.exp(-k * i);
        const x = t * w;
        const y = h - ((currentTemp / startTemp) * h * 0.8);
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Etykiety
    ctx.fillStyle = 'rgba(28, 25, 23, 0.5)';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('55°C', 2, 10);
    ctx.fillText('24h', w - 25, h - 5);
    const endTemp = startTemp - totalDeltaT;
    ctx.fillStyle = totalDeltaT > 10 ? '#ef4444' : '#3b82f6';
    ctx.fillText(`-${totalDeltaT.toFixed(1)}°C`, w - 40, 15);
}

function saveCalculatorState() {
    if (isRestoringCalculatorState) return;
    try {
        const state = {
            currentMode: animationState.currentMode,
            heaters: animationState.heaters,
            boilerOrientation: animationState.boilerOrientation,
            coilChecked: !!document.getElementById('check-coil')?.checked,
            values: {
                volume: inputs.volume.el?.value,
                persons: inputs.persons.el?.value,
                price: inputs.price.el?.value,
                sunny: inputs.sunny.el?.value,
                tilt: inputs.tilt.el?.value,
                orient: inputs.orient.el?.value,
                panelPower: inputs.panelPower.el?.value,
                panelsCount: inputs.panelsCount.el?.value,
                insulation: inputs.insulation.el?.value,
                calcMode: calcModeEl?.value || 'live'
            }
        };
        localStorage.setItem(CALC_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        console.warn('Kalkulator: nie można zapisać ustawień do localStorage.', err);
    }
}

function restoreCalculatorState() {
    try {
        const raw = localStorage.getItem(CALC_STORAGE_KEY);
        if (!raw) return false;
        const state = JSON.parse(raw);
        if (!state || typeof state !== 'object') return false;

        isRestoringCalculatorState = true;

        if (state.currentMode) {
            const modeBtn = document.querySelector(`.mode-btn[data-mode="${state.currentMode}"]`);
            if (modeBtn) modeBtn.click();
        }

        if (state.values && typeof state.values === 'object') {
            const valueMap = {
                volume: inputs.volume.el,
                persons: inputs.persons.el,
                price: inputs.price.el,
                sunny: inputs.sunny.el,
                tilt: inputs.tilt.el,
                orient: inputs.orient.el,
                panelPower: inputs.panelPower.el,
                panelsCount: inputs.panelsCount.el,
                insulation: inputs.insulation.el
            };
            Object.entries(valueMap).forEach(([key, el]) => {
                if (el && state.values[key] !== undefined && state.values[key] !== null) {
                    el.value = state.values[key];
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            if (calcModeEl && state.values.calcMode) {
                calcModeEl.value = state.values.calcMode;
            }
        }

        if (Array.isArray(state.heaters) && state.heaters.length > 0) {
            const cleaned = state.heaters
                .map(v => parseFloat(v))
                .filter(v => Number.isFinite(v) && v > 0);
            if (cleaned.length > 0) animationState.heaters = cleaned;
        }

        if (state.boilerOrientation === 'vertical' || state.boilerOrientation === 'horizontal') {
            animationState.boilerOrientation = state.boilerOrientation;
            document.querySelectorAll('.orientation-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-orientation') === state.boilerOrientation);
            });
        }

        const coilEl = document.getElementById('check-coil');
        if (coilEl && typeof state.coilChecked === 'boolean') {
            coilEl.checked = state.coilChecked;
            coilEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        renderHeaters();
        calcUpdate();
        return true;
    } catch (err) {
        console.warn('Kalkulator: nie można odczytać ustawień z localStorage.', err);
        return false;
    } finally {
        isRestoringCalculatorState = false;
    }
}

// HEATER MANAGEMENT
function renderHeaters() {
    const container = document.getElementById('heaters-list');
    if (!container) return;
    container.innerHTML = '';

    animationState.heaters.forEach((val, index) => {
        const row = document.createElement('div');
        row.className = 'heater-row';
        
        // Minus button
        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'range-btn';
        minusBtn.textContent = '−';
        minusBtn.title = 'Zmniejsz moc';

        // Input range
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '1.0';
        input.max = animationState.currentMode === 'buffer' ? '9.0' : '4.0';
        input.step = '0.1';
        input.value = val;
        
        // Plus button
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'range-btn';
        plusBtn.textContent = '+';
        plusBtn.title = 'Zwiększ moc';

        // Display value
        const display = document.createElement('span');
        display.className = 'heater-val-display';
        display.textContent = val.toFixed(1) + ' kW';

        // Event listener for slider
        input.addEventListener('input', (e) => {
            const newVal = parseFloat(e.target.value);
            animationState.heaters[index] = newVal;
            display.textContent = newVal.toFixed(1) + ' kW';
            calcUpdate();
        });

        // Minus button action
        minusBtn.addEventListener('click', () => {
            const newVal = Math.max(parseFloat(input.min), parseFloat(input.value) - parseFloat(input.step));
            input.value = newVal;
            animationState.heaters[index] = newVal;
            display.textContent = newVal.toFixed(1) + ' kW';
            calcUpdate();
        });

        // Plus button action
        plusBtn.addEventListener('click', () => {
            const newVal = Math.min(parseFloat(input.max), parseFloat(input.value) + parseFloat(input.step));
            input.value = newVal;
            animationState.heaters[index] = newVal;
            display.textContent = newVal.toFixed(1) + ' kW';
            calcUpdate();
        });

        row.appendChild(minusBtn);
        row.appendChild(input);
        row.appendChild(plusBtn);
        row.appendChild(display);

        // Remove button (only if more than 1 heater)
        if (animationState.heaters.length > 1) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-remove-heater';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Usuń grzałkę';
            removeBtn.onclick = () => {
                animationState.heaters.splice(index, 1);
                renderHeaters();
                calcUpdate();
            };
            row.appendChild(removeBtn);
        }

        container.appendChild(row);
    });

    // Update total label
    const totalPower = animationState.heaters.reduce((a, b) => a + b, 0);
    const totalLabel = document.getElementById('val-heater-total');
    if (totalLabel) totalLabel.textContent = totalPower.toFixed(1) + ' kW';
}

document.getElementById('btn-add-heater')?.addEventListener('click', () => {
    // Dodaj now? grza?k? (domy?lnie 3kW)
    const defaultPower = 3.0;
    animationState.heaters.push(defaultPower);
    renderHeaters();
    calcUpdate();
});

// Globalne przyciski / + dla statycznych suwakw
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn[data-target]');
    if (!btn) return;
    const targetId = btn.dataset.target;
    const dir = parseFloat(btn.dataset.dir); // -1 lub +1
    const slider = document.getElementById(targetId);
    if (!slider) return;
    const step = parseFloat(slider.step) || 1;
    const min  = parseFloat(slider.min);
    const max  = parseFloat(slider.max);
    const newVal = Math.min(max, Math.max(min, parseFloat(slider.value) + dir * step));
    // Zaokr?gl do precyzji stepu
    const precision = (step.toString().split('.')[1] || '').length;
    slider.value = newVal.toFixed(precision);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
});

// 3. Funkcja obliczeniowa
function calcUpdate() {
    // Bezpieczne odczytanie ? je?li element nie istnieje, u?yj domy?lnej warto?ci
    const vol     = inputs.volume.el  ? +inputs.volume.el.value  : 180;
    
    // Sumuj moc wszystkich grza?ek
    const heaterPower = animationState.heaters.reduce((sum, val) => sum + val, 0);
    
    // Aktualizuj etykiet? sumy
    const totalLabel = document.getElementById('val-heater-total');
    if (totalLabel) totalLabel.textContent = heaterPower.toFixed(1) + ' kW';

    const persons = inputs.persons.el ? +inputs.persons.el.value : 4;
    const price   = inputs.price.el   ? +inputs.price.el.value   : 1.10;
    const sunny   = inputs.sunny.el   ? +inputs.sunny.el.value   : 180;
    const tilt    = inputs.tilt.el    ? +inputs.tilt.el.value    : 35;
    const orient  = inputs.orient.el  ? +inputs.orient.el.value  : 1.0;
    const panelPower = inputs.panelPower.el ? +inputs.panelPower.el.value : 450;
    const panelsCount = inputs.panelsCount.el ? +inputs.panelsCount.el.value : 7;
    const insulationLevel = inputs.insulation.el ? +inputs.insulation.el.value : 1;

// Energia do podgrzania wody: Q = m — c — ÎT / 3600
// 50L/os/dzie, ÎT = 35C, c = 4.186 kJ/(kgK)
    const litersPerDay    = persons * 50;
    const kwhUsagePerDay  = (litersPerDay * 4.186 * 35) / 3600;

    // Straty postojowe: ~0.8 kWh / 100L / dob?
    const standbyPerDay   = (vol / 100) * 0.8;

    const totalPerDay     = kwhUsagePerDay + standbyPerDay;
    const totalPerYear    = totalPerDay * 365;
    const costPerYear     = totalPerYear * price;

    // Wsp??czynnik wydajno?ci w zale?no?ci od k?ta nachylenia (uproszczony model dla Polski)
    // Optimum ~35 stopni (1.0). P?asko (0) ~0.85. Pionowo (90) ~0.7.
    let tiltEff = 1.0;
    if (tilt < 30) tiltEff = 0.85 + (tilt / 30) * 0.15; // Wzrost od 0.85 do 1.0
    else if (tilt > 45) tiltEff = 1.0 - ((tilt - 45) / 45) * 0.3; // Spadek od 1.0 do 0.7
    // (Pomi?dzy 30 a 45 uznajemy za optimum = 1.0)

    // Aktualizacja wizualizacji k?ta nachylenia (SVG)
    const tiltShadow = document.getElementById('tilt-visual-shadow');
    const tiltVisual = document.getElementById('tilt-visual-panel');
    if (tiltVisual) {
        tiltVisual.style.transform = `rotate(-${tilt}deg)`;

        if (tiltShadow) {
            // Panel corners relative to rect's x="0" y="-3"
            const p_tl = {x: 0, y: -3}; // top-left
            const p_tr = {x: 32, y: -3}; // top-right
            const p_br = {x: 32, y: 3};  // bottom-right
            const p_bl = {x: 0, y: 3};   // bottom-left

            // Rotation origin relative to rect's x="0" y="-3"
            // This should match the transform-origin in HTML (0px from x, 6px from y, which is y=-3+6=3)
            const rot_x = 0; // Rotate around x=0 (left edge)
            const rot_y = 3; // Rotate around y=3 (bottom edge)

            const theta = -tilt * Math.PI / 180; // Convert to radians (negative for clockwise rotation in SVG)
            const cos_theta = Math.cos(theta);
            const sin_theta = Math.sin(theta);

            // Calculate rotated corners
            const rp_tl = rotatePoint(p_tl.x, p_tl.y, rot_x, rot_y, cos_theta, sin_theta);
            const rp_tr = rotatePoint(p_tr.x, p_tr.y, rot_x, rot_y, cos_theta, sin_theta);
            const rp_br = rotatePoint(p_br.x, p_br.y, rot_x, rot_y, cos_theta, sin_theta);
            const rp_bl = rotatePoint(p_bl.x, p_bl.y, rot_x, rot_y, cos_theta, sin_theta);

            // Shadow projection vector (depends on tilt)
            // Shadow moves left as panel goes vertical, down as panel goes flat
            const shadow_proj_x = -1 * (tilt / 90) * 10; // Max 10px horizontal shift
            const shadow_proj_y = 1 * (1 - tilt / 90) * 5;  // Max 5px vertical shift

            // Shadow polygon points (bottom-left, bottom-right, projected top-right, projected top-left)
            const s_tl = {x: rp_tl.x + shadow_proj_x, y: rp_tl.y + shadow_proj_y};
            const s_tr = {x: rp_tr.x + shadow_proj_x, y: rp_tr.y + shadow_proj_y};

            tiltShadow.setAttribute('points', `${rp_bl.x},${rp_bl.y} ${rp_br.x},${rp_br.y} ${s_tr.x},${s_tr.y} ${s_tl.x},${s_tl.y}`);
        }
    }

    // Pokrycie s?oneczne: wi?kszy bojler = lepszy akumulator
    const volumeFactor    = 0.78 + Math.min(0.17, (vol - 50) / 1500);
    const tempEffLive     = getTemperatureEfficiencyFactor(weatherState.temperatureC, weatherState.radiationWm2);
    const calcMode        = calcModeEl ? calcModeEl.value : 'live';
    const tempEff         = calcMode === 'standard' ? 1 : tempEffLive;

    // Logika uwzgl?dniaj?ca liczb? paneli:
    const totalPowerKW = (panelsCount * panelPower) / 1000;
    // Szacowana produkcja w s?oneczny dzie? (kWh) uwzgl?dniaj?ca warunki monta?owe
    const productionPotential = totalPowerKW * 4.2 * tiltEff * orient * tempEff;
    // Czy moc paneli wystarcza na zagrzanie wody w ci?gu dnia?
    const powerFactor = Math.min(1, productionPotential / totalPerDay);
    const solarCoverage = (sunny / 365) * volumeFactor * powerFactor;

    const saving          = costPerYear * solarCoverage;

    const investmentCost  = 3200;
    const paybackYears    = saving > 0 ? investmentCost / saving : 0;

// Aktualizacja DOM (z null-check)
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
        else console.warn('Kalkulator: brak elementu #' + id);
    };

    const tempImpactEl = document.getElementById('calc-temp-impact');
    const liveTempEl = document.getElementById('val-live-temp');
    if (tempImpactEl) {
        if (calcMode === 'standard') {
            tempImpactEl.textContent = 'Wpływ temperatury paneli: tryb Standard (STC 25°C) - korekta temperaturowa = 0.0%';
            if (liveTempEl) liveTempEl.textContent = 'STC 25°C';
        } else if (Number.isFinite(weatherState.temperatureC) && Number.isFinite(weatherState.radiationWm2)) {
            const impactPct = (tempEff - 1) * 100;
            const sign = impactPct >= 0 ? '+' : '';
            tempImpactEl.textContent =
                `Wpływ temperatury paneli (na bazie bieżącej pogody): ${sign}${impactPct.toFixed(1)}% sprawności` +
                ` | T powietrza: ${Math.round(weatherState.temperatureC)}°C, promieniowanie: ${Math.round(weatherState.radiationWm2)} W/m²`;
            if (liveTempEl) liveTempEl.textContent = `${Math.round(weatherState.temperatureC)}°C`;
        } else {
            tempImpactEl.textContent = 'Wpływ temperatury paneli (na bazie bieżącej pogody): oczekiwanie na dane...';
            if (liveTempEl) liveTempEl.textContent = '--°C';
        }
    }

    set('result-energy',  Math.round(totalPerYear) + ' kWh');
    set('result-cost',    Math.round(costPerYear)  + ' zł');
    set('result-saving',  Math.round(saving)       + ' zł');
    set('result-payback', paybackYears > 0 ? paybackYears.toFixed(1) + ' lat' : '—');
    set('mobile-saving',  Math.round(saving)       + ' zł');
    set('mobile-payback', paybackYears > 0 ? paybackYears.toFixed(1) + ' lat' : '—');
    
// Globalna aktualizacja ceny prdu i wylicze zalenych
    const priceFmt = price.toFixed(2).replace('.', ',');

    // 1. Hero Section
    const heroPriceEl = document.getElementById('hero-price-val');
    if (heroPriceEl) heroPriceEl.textContent = priceFmt + ' zł/kWh';

    // 2. Banner w kalkulatorze
    const bannerPriceEl = document.getElementById('banner-price-val');
    if (bannerPriceEl) bannerPriceEl.textContent = priceFmt + ' zł/kWh brutto';

    // 3. Nag??wek sekcji Por?wnanie
    const cmpSubtitlePrice = document.getElementById('cmp-subtitle-price');
    if (cmpSubtitlePrice) cmpSubtitlePrice.textContent = priceFmt + ' zł/kWh';

// 4. Wykres şrde energii (pasek prdu)
    const energyPriceElec = document.getElementById('energy-price-electric');
    if (energyPriceElec) energyPriceElec.textContent = priceFmt + ' zł';
    
    const energyBarElec = document.getElementById('energy-bar-electric');
    if (energyBarElec) {
        // Skalowanie paska: 1.50 zł = 100% (zwi?kszona skala bo ceny surowc?w mog? by? wysokie)
        const widthPct = Math.min(100, (price / 1.50) * 100);
        energyBarElec.style.width = widthPct + '%';
        
        // Tooltip GJ (1 GJ = 277.78 kWh)
        const costGj = price * 277.78;
        const tip = `Koszt: ${costGj.toFixed(2)} zł / GJ`;
        if(energyBarElec.parentElement) energyBarElec.parentElement.setAttribute('data-tooltip', tip);
    }

    // 5. Tabela Por?wnawcza (Symulacja 10 lat)
    // Koszt roczny sieci = costPerYear (wyliczone wy?ej w kalkulatorze)
    const costNetwork10y = costPerYear * 10;
    
    // Koszt roczny solarny = Koszt sieci - Oszcz?dno??
    const costSolarYear = Math.max(0, costPerYear - saving);
    const investConst = 3500; // Sta?y koszt inwestycji do symulacji w tabeli
    const costSolar10y = investConst + (costSolarYear * 10);

    const fmtMoney = (n) => Math.round(n).toLocaleString('pl-PL').replace(/\u00A0/g,' ');

    set('cmp-annual-network', fmtMoney(costPerYear) + ' zł');
    set('cmp-annual-solar',   '~' + fmtMoney(costSolarYear) + ' zł');
    
    set('cmp-5yr-network',    fmtMoney(costPerYear * 5) + ' zł');
    set('cmp-5yr-solar',      fmtMoney(investConst + costSolarYear * 5) + ' zł');
    
    set('cmp-10yr-network',   fmtMoney(costNetwork10y) + ' zł');
    set('cmp-10yr-solar',     fmtMoney(costSolar10y) + ' zł');
    
    set('cmp-result-network', 'Strata: -' + fmtMoney(costNetwork10y) + ' zł');
    set('cmp-result-solar',   'Zyskasz: +' + fmtMoney(costNetwork10y - costSolar10y) + ' zł*');

    set('cmp-chart-network-val', fmtMoney(costNetwork10y) + ' zł');
    set('cmp-chart-solar-val',   fmtMoney(costSolar10y) + ' zł');
    const chartBarSolar = document.getElementById('cmp-chart-bar-solar');
    if (chartBarSolar) chartBarSolar.style.height = Math.max(1, Math.min(100, (costSolar10y / costNetwork10y) * 100)) + '%';

    const savingSub = document.getElementById('result-saving-sub');
    if (savingSub) {
        const modeTxt = calcMode === 'standard' ? 'Standard' : 'Na żywo';
        savingSub.textContent = `zł oszczędności (pokrycie ok. ${Math.round(solarCoverage * 100)}%, tryb: ${modeTxt})`;
    }

    const breakdownEl = document.getElementById('calc-factor-breakdown');
    if (breakdownEl) {
        const daysEff = sunny / 365;
        const pct = (v) => `${Math.round(v * 100)}%`;
        breakdownEl.innerHTML =
            `<div class="factor-row"><span>Słoneczne dni</span><strong>${pct(daysEff)}</strong></div>` +
            `<div class="factor-row"><span>Pojemność (akumulacja)</span><strong>${pct(volumeFactor)}</strong></div>` +
            `<div class="factor-row"><span>Wydajność zestawu (${panelsCount} szt.)</span><strong>${pct(powerFactor)}</strong></div>` +
            `<div class="factor-row"><span>Końcowe pokrycie</span><strong>${pct(solarCoverage)}</strong></div>`;
    }

// Aktualizacja sekcji "Przykad obliczeniowy"
    // Obliczamy energi? potrzebn? do podgrzania wody o 45 stopni (10 -> 55)
    // Wz?r: Litry * 4.186 * DeltaT / 3600 = kWh
    const exEnergy = (vol * 4.186 * 45) / 3600;
    const exCost   = exEnergy * price;

    const exTitle = document.getElementById('ex-title');
    if (exTitle) exTitle.textContent = `Przykład: Ile kosztuje jednorazowe podgrzanie bojlera ${vol} L?`;

    const exDesc = document.getElementById('ex-desc');
    if (exDesc) exDesc.innerHTML = `Aby podgrzać ${vol} litrów wody od 10°C do 55°C, potrzeba <strong>~${exEnergy.toFixed(1)} kWh</strong> energii. Zobacz, ile to kosztuje:`;

    const exSourceElec = document.getElementById('ex-source-elec');
    if (exSourceElec) exSourceElec.textContent = `⚡ Prąd z sieci (${price.toFixed(2)} zł/kWh):`;

    const exCostElec = document.getElementById('ex-cost-elec');
    if (exCostElec) {
        animateValue(exCostElec, animationState.previousExCost, exCost, 600, { prefix: '~', suffix: ' zł', decimals: 2 });
    }
    animationState.previousExCost = exCost; // Zapisz warto?? na nast?pny raz

// Nowe obliczenia: Czas i Wydajno

    // Rekomendacja mocy grza?ki (np. 1kW na 60L dla optymalnego czasu)
    const recPower = (vol / 60).toFixed(1);
    const recEl = document.getElementById('rec-heater');
    if (recEl) recEl.textContent = `${recPower} kW`;

    // Rekomendowana ilo?? paneli (dla ZALECANEJ mocy grza?ki - zale?nej od pojemno?ci)
    // U?ywamy parseFloat(recPower), aby rekomendacja paneli by?a sp?jna z rekomendacj? grza?ki powy?ej
    const panelsCountCalc = Math.ceil((parseFloat(recPower) * 1000) / panelPower);
    const recPanelsCalcEl = document.getElementById('rec-panels-calc');
    if (recPanelsCalcEl) recPanelsCalcEl.textContent = `${panelsCountCalc} szt. (${panelPower}W)`;

    // Walidacja mocy grza?ki (Ostrze?enie w kalkulatorze)
    const heaterWarningEl = document.getElementById('heater-warning');
    if (heaterWarningEl) {
        if (heaterPower < parseFloat(recPower)) {
            heaterWarningEl.style.display = 'block';
            heaterWarningEl.innerHTML = `⚠️ <strong>Uwaga:</strong> Wybrana moc (${heaterPower.toFixed(1)} kW) jest mniejsza niż zalecana (${recPower} kW). Czas nagrzewania może być zbyt długi.`;
        } else {
            heaterWarningEl.style.display = 'none';
        }
    }

    // Aktualizacja etykiety czasu (dynamiczna moc)
    const timeLabel = document.getElementById('ex-time-label');
    if (timeLabel) timeLabel.textContent = `Czas nagrzewania (razem ${heaterPower.toFixed(1)} kW)`;
    
    // 1. Czas nagrzewania (dla wybranej mocy grza?ki)
    const timeHoursTotal = exEnergy / heaterPower;
    const timeH = Math.floor(timeHoursTotal);
    const timeM = Math.round((timeHoursTotal - timeH) * 60);
    
    const exTime = document.getElementById('ex-time');
    if (exTime) exTime.textContent = `${timeH}h ${timeM}min`;

    // 1b. Sugerowana ilo?? paneli
    const panelsNeeded = Math.ceil((heaterPower * 1000) / panelPower);
    const exPanels = document.getElementById('ex-panels');
    if (exPanels) exPanels.textContent = `${panelsNeeded} szt. (${panelPower}W)`;

    // 1c. Info o du?ej mocy (zielony komunikat)
    const powerNote = document.getElementById('ex-power-note');
    if (powerNote) {
        if (heaterPower > parseFloat(recPower)) {
            powerNote.style.display = 'block';
            powerNote.className = 'power-note success';
            powerNote.innerHTML = `✅ <strong>Duża moc całkowita!</strong> Woda nagrzeje się bardzo szybko. Pamiętaj, że falownik musi obsłużyć tę moc (wymaga min. ${panelsNeeded} paneli ${panelPower}W).`;
        } else {
            powerNote.style.display = 'none';
        }
    }

    // 2. Ilo?? prysznic?w (uwzgl?dniamy orientacj? bojlera)
        const isVertical = animationState.boilerOrientation === 'vertical';
    const usableVolumeFactor = isVertical ? 0.90 : 0.65; // 90% dla pionowego, 65% dla poziomego
    const usableVolume = vol * usableVolumeFactor;
    const showersCount = Math.floor(usableVolume / 40);
    const exShowers = document.getElementById('ex-showers');
    if (exShowers) exShowers.textContent = `ok. ${showersCount} osób`;

    // 3. Kontekst użycia (osoby vs pojemność)
    const dailyNeed = persons * 50;
    const cyclesVal = dailyNeed / vol;
    const cycles = cyclesVal.toFixed(1);

    const exUsageNote = document.getElementById('ex-usage-note');
    if (exUsageNote) {
        exUsageNote.className = 'example-usage-note';
        let noteHTML = '';
        if (cyclesVal > 2.0) {
            exUsageNote.classList.add('warning');
            noteHTML = `⚠️ <strong>Uwaga: bojler może być za mały!</strong><br>Dla ${persons} osób potrzeba ok. ${dailyNeed} L wody. Przy tej pojemności trzeba ją grzać aż <strong>${cycles} razy</strong> na dobę.`;
        } else {
            noteHTML = `Dla <strong>${persons} osób</strong> potrzeba ok. <strong>${dailyNeed} L</strong> ciepłej wody na dobę. `;
            if (dailyNeed <= vol) {
                noteHTML += `Pojemność bojlera <strong>(${vol} L)</strong> jest wystarczająca na cały dzień bez dogrzewania.`;
            } else {
                noteHTML += `Przy pojemności <strong>${vol} L</strong> wodę trzeba podgrzać (wymienić) ok. <strong>${cycles} razy</strong> w ciągu doby.`;
            }
        }
        exUsageNote.innerHTML = noteHTML;
    }

    // 4. Informacje o stratyfikacji i orientacji bojlera
    const stratVisual = document.querySelector('.stratification-visual');
    if (stratVisual) {
        if (isVertical) stratVisual.classList.remove('horizontal');
        else stratVisual.classList.add('horizontal');
    }

    const insulationTexts = [
        'Przy 0 cm izolacji ciepło ucieka bardzo szybko i rano woda może być już chłodna.',
        'Przy 5 cm izolacji straty nadal są duże, ale zauważalnie mniejsze niż bez izolacji.',
        'Przy 10 cm izolacji bojler dobrze trzyma temperaturę przez noc w typowych warunkach.',
        'Przy 12 cm izolacji straty są niskie i zwykle wystarcza to dla komfortowego użytku.',
        'Przy 15 cm izolacji bojler zachowuje ciepło bardzo dobrze, ograniczając dogrzewanie rano.',
        'Przy 20 cm izolacji bojler działa jak termos i nocne straty są minimalne.'
    ];
    const insulationNote = insulationTexts[insulationLevel] || insulationTexts[2];

    const stratInfoEl = document.getElementById('stratification-info');
    if (stratInfoEl) {
        if (isVertical) {
            stratInfoEl.innerHTML = `<strong>Ważna uwaga o warstwach (stratyfikacji):</strong> W pionowym bojlerze woda układa się warstwami — najcieplejsza jest na górze. Dzięki temu masz dostęp do gorącej wody szybciej.<br><br>💡 <strong>Zachowanie w nocy:</strong> ${insulationNote}`;
            stratInfoEl.style.color = '';
            stratInfoEl.style.background = '';
            stratInfoEl.style.padding = '';
            stratInfoEl.style.borderRadius = '';
            stratInfoEl.style.border = '';
        } else {
            if (vol <= 60) {
                stratInfoEl.innerHTML = `⚠️ <strong>Krytyczna uwaga:</strong> Poziomy bojler o tak małej pojemności (<strong>${vol} L</strong>) jest <strong>bardzo nieefektywny</strong>. Mieszanie wody sprawi, że ilość dostępnej gorącej wody będzie znikoma.<br><br>🚨 <strong>Straty:</strong> ${insulationNote}`;
                stratInfoEl.style.color = '#b91c1c';
                stratInfoEl.style.background = 'rgba(239, 68, 68, 0.1)';
                stratInfoEl.style.padding = '12px';
                stratInfoEl.style.borderRadius = '8px';
                stratInfoEl.style.border = '1px solid rgba(239, 68, 68, 0.2)';
            } else {
                stratInfoEl.innerHTML = `<strong>Uwaga dla bojlera poziomego:</strong> W takim bojlerze zjawisko warstw jest słabsze. Woda szybciej się miesza, co zmniejsza ilość dostępnej „użytkowej” gorącej wody.<br><br>💡 <strong>Zachowanie w nocy:</strong> ${insulationNote}`;
                stratInfoEl.style.color = '';
                stratInfoEl.style.background = '';
                stratInfoEl.style.padding = '';
                stratInfoEl.style.borderRadius = '';
                stratInfoEl.style.border = '';
            }
        }
    }

    // -- Update Recommended Set Box --
    drawCoolingChart(vol, insulationLevel);

    const recTotalPowerW = panelsCountCalc * panelPower;
    const recTotalPowerKWp = (recTotalPowerW / 1000).toFixed(2);

    const recSetPanels = document.getElementById('rec-set-panels');
    if (recSetPanels) {
        recSetPanels.innerHTML = `<strong>Panele PV:</strong> ${panelsCountCalc} szt. (${panelPower}W) - łącznie ${recTotalPowerKWp} kWp`;
    }

    const recSetInverter = document.getElementById('rec-set-inverter');
    if (recSetInverter) {
        recSetInverter.innerHTML = `<strong>Falownik Off-Grid:</strong> 1 szt. (moc min. ${Math.ceil(recTotalPowerW / 1000)} kW)`;
    }

    const recSetWiring = document.getElementById('rec-set-wiring');
    if (recSetWiring) {
        recSetWiring.innerHTML = `<strong>Okablowanie i złącza:</strong> Kompletny zestaw solarny MC4`;
    }

    const recSetMount = document.getElementById('rec-set-mount');
    if (recSetMount) {
        recSetMount.innerHTML = `<strong>Montaż:</strong> Profesjonalna instalacja na dachu lub gruncie`;
    }

    saveCalculatorState();
}

// 4. Eventy na suwakach
Object.entries(inputs).forEach(([key, obj]) => {
    if (!obj.el) {
        console.warn('Kalkulator: brak suwaka dla klucza:', key);
        return;
    }

    // Handle non-range inputs (selects)
    if (obj.el.type !== 'range') {
        obj.el.addEventListener('input', () => {
            const val = obj.el.value;
            if (obj.out) {
                obj.out.textContent = (key === 'price')
                    ? parseFloat(val).toFixed(2) + obj.unit
                    : val + obj.unit;
            }
            calcUpdate();
        });
        // Initial update for non-range elements
        if (obj.out && obj.el.value !== undefined) {
            const val = obj.el.value;
            obj.out.textContent = (key === 'price')
                ? parseFloat(val).toFixed(2) + obj.unit
                : val + obj.unit;
        }
        return;
    }

    // Event listener na suwaku
    obj.el.addEventListener('input', () => {
        const val = parseFloat(obj.el.value);
        if (obj.out) {
            if (key === 'insulation') {
                obj.out.textContent = formatInsulationValue(val);
            } else {
            obj.out.textContent = (key === 'price')
                ? val.toFixed(2) + obj.unit
                : val + obj.unit;
            }
        }
        calcUpdate();
    });

    // Inicjalne ustawienie etykiety
    if (obj.out && obj.el.value !== undefined) {
        const val = parseFloat(obj.el.value);
        if (key === 'insulation') {
            obj.out.textContent = formatInsulationValue(val);
        } else {
            obj.out.textContent = (key === 'price')
                ? val.toFixed(2) + obj.unit
                : val + obj.unit;
        }
    }
});

// Animacja chlupotania wody przy zmianie pojemno?ci
const volumeSlider = document.getElementById('range-volume');
if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
        const waterEl = document.querySelector('.hot-water');
        if (waterEl) {
            waterEl.classList.remove('sloshing');
            void waterEl.offsetWidth; // Trigger reflow (restart animacji)
            waterEl.classList.add('sloshing');
            
            // Usu? klas? po zako?czeniu animacji (0.6s w CSS)
            setTimeout(() => {
                waterEl.classList.remove('sloshing');
            }, 600);
        }
    });
}

// MODE SWITCH LOGIC
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // UI Update
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const mode = btn.getAttribute('data-mode');
        animationState.currentMode = mode;

        const volSlider = inputs.volume.el;
        
        if (mode === 'buffer') {
            // Ustawienia dla Bufora
            volSlider.max = 2000;
            volSlider.step = 50;
            volSlider.value = 1000; // Domy?lnie 1000L
            
            // Domy?lne grza?ki dla bufora (zgodnie z pro?b?: 3kW + 4kW)
            animationState.heaters = [3.0, 4.0];
            
            // Zaktualizuj etykiet?
            document.querySelector('label[for="range-volume"]').innerHTML = 'Pojemność bufora <span id="val-volume">1000 L</span>';
            inputs.volume.out = document.getElementById('val-volume'); // Re-bind output

        } else {
            // Ustawienia dla Bojlera
            volSlider.max = 300;
            volSlider.step = 10;
            volSlider.value = 180;
            
            // Domy?lna grza?ka dla bojlera
            animationState.heaters = [3.0];

            document.querySelector('label[for="range-volume"]').innerHTML = 'Pojemność bojlera <span id="val-volume">180 L</span>';
            inputs.volume.out = document.getElementById('val-volume');
        }

        renderHeaters();
        volSlider.dispatchEvent(new Event('input')); // Trigger update
    });
});

// Boiler Orientation Switch Logic
document.querySelectorAll('.orientation-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.orientation-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        animationState.boilerOrientation = btn.getAttribute('data-orientation');
        calcUpdate();
    });
});

// Przycisk optymalizacji izolacji
document.getElementById('btn-optimize-insulation')?.addEventListener('click', () => {
    const persons = inputs.persons.el ? +inputs.persons.el.value : 4;
    const vol = inputs.volume.el ? +inputs.volume.el.value : 180;
    
    // Logika: większe zapotrzebowanie = grubsza izolacja
    let level = 2; // 10 cm
    if (persons >= 3 || vol >= 150) level = 3; // 12 cm
    if (persons >= 4 || vol >= 200) level = 4; // 15 cm
    if (persons >= 5 || vol >= 250) level = 5; // 20 cm
    
    if (inputs.insulation.el) {
        inputs.insulation.el.value = level;
        inputs.insulation.el.dispatchEvent(new Event('input', { bubbles: true }));
    }
});

// Obs?uga opcji "Bojler z w??ownic?"
const coilCheck = document.getElementById('check-coil');
const coilInfo = document.getElementById('coil-info');

if (coilCheck && coilInfo) {
    coilCheck.addEventListener('change', () => {
        if (coilCheck.checked) {
            coilInfo.style.display = 'block';
            coilInfo.innerHTML = `<strong>💡 Idealny układ hybrydowy:</strong><br>To świetna wiadomość! Możesz zintegrować system PV z obecnym piecem. Grzałka zasilana słońcem będzie grzać wodę <strong>od wiosny do jesieni (za darmo)</strong>, pozwalając Ci całkowicie wyłączyć piec. Zimą, gdy słońca jest mniej, wężownica z kotła C.O. przejmie podgrzewanie. To najbardziej ekonomiczne rozwiązanie całoroczne.`;
        } else {
            coilInfo.style.display = 'none';
        }
    });
}

// 5. KLUCZOWE: wywoaj przy starcie
renderHeaters(); // Inicjalizacja grza?ek
if (!restoreCalculatorState()) {
    calcUpdate();
}

// Przycisk automatycznego doboru
const autoSetBtn = document.getElementById('btn-auto-set');
if (autoSetBtn) {
    autoSetBtn.addEventListener('click', () => {
        // Optymalne warto?ci dla 4-osobowej rodziny
        const optimalValues = {
            persons: 4,
            volume: 200,
            tilt: 35,
            orient: "1.0",
            panelPower: 450,
        };
        
        // TODO: Reset mode to boiler if needed, or handle buffer auto-set

        // Ustaw warto?ci i wywo?aj zdarzenie 'input' dla ka?dego suwaka/selecta
        Object.entries(optimalValues).forEach(([key, value]) => {
            if (inputs[key] && inputs[key].el) {
                inputs[key].el.value = value;
                inputs[key].el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        
        // Reset heaters for auto-set
        animationState.heaters = [3.0];
        renderHeaters();
        calcUpdate();
    });
}

// FORM
const contactForm = document.getElementById('contact-form');
if (contactForm) {
    const phoneInput = contactForm.querySelector('input[type="tel"]');

    if (phoneInput) {
        phoneInput.addEventListener('input', function(e) {
            let val = e.target.value.replace(/\D/g, '');
            val = val.substring(0, 9);
            if (val.length > 6) {
                val = val.substring(0, 3) + ' ' + val.substring(3, 6) + ' ' + val.substring(6);
            } else if (val.length > 3) {
                val = val.substring(0, 3) + ' ' + val.substring(3);
            }
            e.target.value = val;
        });
    }

    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const phoneVal = phoneInput ? phoneInput.value.replace(/\D/g, '') : ''; // Usuwa wszystko co nie jest cyfr?

        if (phoneVal.length !== 9) {
            alert('Proszę podać poprawny numer telefonu (9 cyfr).');
            return;
        }

        const status = document.getElementById('form-status');
        const btn = this.querySelector('button[type="submit"]');
        const originalBtnText = btn.innerText;
        
        btn.innerText = 'Wysyłanie...';
        btn.disabled = true;
        if (status) status.innerHTML = '<span style="color:#F59E0B">Wysyłanie...</span>';

        fetch("https://formsubmit.co/ajax/zbyszekszczesny83@gmail.com", {
            method: "POST",
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                name: this.querySelector('input[type="text"]').value,
                phone: phoneVal,
                email: this.querySelector('input[type="email"]').value,
                boiler: this.querySelector('select').value,
                message: this.querySelector('textarea').value,
                _subject: "---> Słoneczny Bojler nowe zapytanie <---",
                _autoresponse: "Dziękujemy za wiadomość! Skontaktujemy się wkrótce."
            })
        })
        .then(response => {
            if (response.ok) {
                // Ukryj formularz i poka? podzi?kowanie
                const originalChildren = Array.from(this.children);
                originalChildren.forEach(child => child.style.display = 'none');
                
                // Ukryj status pod formularzem je?li istnieje
                if(status) status.style.display = 'none';

                const successDiv = document.createElement('div');
                successDiv.className = 'form-success';
                successDiv.style.textAlign = 'center';
                successDiv.style.padding = '20px';
                successDiv.innerHTML = `
                    <div style="font-size: 3rem; margin-bottom: 15px;">✅</div>
                    <h3 style="color: #fff; margin-bottom: 10px;">Dziękuję za wiadomość!</h3>
                    <p style="color: rgba(255,255,255,0.7); margin-bottom: 20px;">Otrzymałem Twoje zgłoszenie. Skontaktuję się w ciągu 24 godzin.</p>
                    <button type="button" id="new-msg-btn" class="btn-submit" style="background: transparent; border: 1px solid var(--sun); color: var(--sun); width: auto; padding: 10px 25px;">Wyślij kolejną wiadomość</button>
                `;
                this.appendChild(successDiv);

                document.getElementById('new-msg-btn').addEventListener('click', () => {
                    successDiv.remove();
                    originalChildren.forEach(child => child.style.display = '');
                    if(status) {
                        status.style.display = 'block';
                        status.innerHTML = '';
                    }
                    this.reset();
                });
            } else {
                throw new Error('Błąd wysyłki');
            }
        })
        .catch(error => {
            if (status) status.innerHTML = '<span style="color:#ef4444">Błąd wysyłania. Spróbuj zadzwonić: 574 322 909</span>';
        })
        .finally(() => {
            btn.innerText = originalBtnText;
            btn.disabled = false;
        });
    });
}

const clearCalcStateBtn = document.getElementById('btn-clear-calc-state');
if (clearCalcStateBtn) {
    clearCalcStateBtn.addEventListener('click', () => {
        localStorage.removeItem(CALC_STORAGE_KEY);
        location.reload();
    });
}

// FAQ
document.querySelectorAll('.faq-item').forEach(item => {
    item.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
    });
});

// SMOOTH SCROLL
document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
        e.preventDefault();
        const target = document.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
});

// ANIMATION ON SCROLL
const observerOptions = {
    root: null,
    // Trigger reveal a bit earlier to avoid "empty gap" while scrolling
    rootMargin: '140px 0px -40px 0px',
    threshold: 0.01
};

const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.fade-in-section').forEach(section => {
    observer.observe(section);
});

// BACK TO TOP
const backToTopBtn = document.getElementById('back-to-top');
const bgDimmerWrap = document.getElementById('bg-dimmer-wrapper');

window.addEventListener('scroll', () => {
    if (!backToTopBtn) return;
    if (window.scrollY > 300) {
        backToTopBtn.classList.add('visible');
        if(bgDimmerWrap) bgDimmerWrap.classList.add('visible');
    } else {
        backToTopBtn.classList.remove('visible');
        if(bgDimmerWrap) bgDimmerWrap.classList.remove('visible');
    }
});

if (calcModeEl) {
    calcModeEl.addEventListener('change', calcUpdate);
}

if (backToTopBtn) {
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// SECTION BACKGROUND DIMMER
const bgDimmer = document.getElementById('bg-dimmer');
const dimmerLabel = document.getElementById('dimmer-label');
if (bgDimmer) {
    // Select target sections
    const dimTargets = document.querySelectorAll('#realizacje, #kalkulator, #magazyn-energii, #porownanie, #faq, #osobiscie');
    
    // Store original background colors
    const originals = new Map();
    
    // Helper to parse rgb/rgba
    const getRgb = (el) => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor; // format: "rgb(255, 255, 255)"
        const match = bg.match(/\d+/g);
        if (!match || match.length < 3) return [255, 255, 255];
        return match.map(Number);
    };

    // Initialize originals on first interaction or load
    // We do it on mouseover/touchstart to ensure styles are computed, 
    // or immediately if we want. Let's do it immediately.
    dimTargets.forEach(el => {
        originals.set(el, getRgb(el));
    });

    // Target BG color: Ciep?y szary (przyjemny dla oka "papier")
    const targetColor = [200, 196, 188]; 

    // Interpolacja kolor?w (linear interpolation)
    const lerp = (start, end, t) => Math.round(start + (end - start) * t);
    const setRgb = (el, r, g, b) => el.style.color = `rgb(${r},${g},${b})`;

    bgDimmer.addEventListener('input', (e) => {
        const val = e.target.value;
        const factor = e.target.value / 100; // 0 to 1
        
        if(dimmerLabel) dimmerLabel.textContent = `${val}%`;

        dimTargets.forEach(el => {
            const start = originals.get(el);
            if (!start) return;

            // T?o
            const r = lerp(start[0], targetColor[0], factor);
            const g = lerp(start[1], targetColor[1], factor);
            const b = lerp(start[2], targetColor[2], factor);

            el.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            
            // Funkcja pomocnicza do zmiany koloru tekstu
            const updateColor = (selector, rStart, gStart, bStart, rEnd, gEnd, bEnd) => {
                const items = el.querySelectorAll(selector);
                items.forEach(item => {
                    // Pomi? elementy wewn?trz widgetu solarnego (on ma zawsze ciemne t?o)
                    if (item.closest('.solar-widget')) return;

                    if (factor <= 0) {
                        item.style.removeProperty('color'); // Przywr?? CSS
                    } else {
                        setRgb(item, 
                            lerp(rStart, rEnd, factor), 
                            lerp(gStart, gEnd, factor), 
                            lerp(bStart, bEnd, factor)
                        );
                    }
                });
            };

            // 1. Szary tekst (.section-sub) -> Czarny (0,0,0)
            updateColor('.section-sub', 120, 113, 108, 0, 0, 0);

            // 2. Jasny pomara?czowy (--sun) -> Atramentowy #1C1917
            const sunSelectors = [
                '.section-label',
                '.field label span',
                '.result-card.highlight .result-value',
                '.storage-chart-val',
                '.me-big-val',
                '.me-pv-card-val',
                '.example-icon',
                '#rec-heater',
                '#rec-panels-calc'
            ].join(',');
            updateColor(sunSelectors, 245, 158, 11, 28, 25, 23);

            // 3. Ciemny pomara?czowy (--sun-deep) -> Atramentowy #1C1917
            // Dotyczy m.in. .btn-auto
            const sunDeepSelectors = '.btn-auto';
            updateColor(sunDeepSelectors, 217, 119, 6, 28, 25, 23);
        });
    });
}

// COOKIE CONSENT
const initCookieConsent = () => {
    if (!localStorage.getItem('cookieConsent')) {
        const banner = document.createElement('div');
        banner.className = 'cookie-banner';
        banner.innerHTML = `
            <p>Strona korzysta z plików cookies w celu realizacji usług. Możesz określić warunki przechowywania lub dostępu do cookies w Twojej przeglądarce.</p>
            <div class="cookie-actions">
                <button id="cookie-reject" class="cookie-btn cookie-reject">Odrzuć</button>
                <button id="cookie-accept" class="cookie-btn cookie-accept">Akceptuj</button>
            </div>
        `;
        document.body.appendChild(banner);

        const handleConsent = (status) => {
            localStorage.setItem('cookieConsent', status);
            banner.remove();
        };

        document.getElementById('cookie-accept').addEventListener('click', () => handleConsent('accepted'));
        document.getElementById('cookie-reject').addEventListener('click', () => handleConsent('rejected'));
    }
};
initCookieConsent();

// PWA INSTALLATION
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.add('visible');
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            if (outcome === 'accepted') {
                installBtn.classList.remove('visible');
            }
        }
    });
}

window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.classList.remove('visible');
    deferredPrompt = null;
});

// Rejestracja Service Worker
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./service-worker.js');
}

// SHARE BUTTON
const shareBtn = document.getElementById('share-btn');
if (shareBtn) {
    shareBtn.addEventListener('click', () => {
        if (navigator.share) {
            navigator.share({
                title: document.title,
                text: 'Sprawdź darmowe grzanie wody ze słońca! ☀️',
                url: window.location.href
            }).catch(console.error);
        } else {
            prompt('Skopiuj link do strony:', window.location.href);
        }
    });
}

// MAP INTERACTIVITY
const mapTags = document.querySelectorAll('.area-tags span');
const mapDots = document.querySelectorAll('.city-dot');
const mapLabel = document.getElementById('map-city-label');

function activateCity(cityName) {
    // Reset
    mapTags.forEach(t => t.classList.remove('active'));
    mapDots.forEach(d => d.classList.remove('active'));
    
    if (!cityName) {
        if (mapLabel) mapLabel.classList.remove('visible');
        return;
    }

    // Activate tag
    const tag = Array.from(mapTags).find(t => t.getAttribute('data-city') === cityName);
    if (tag) tag.classList.add('active');

    // Activate dot
    const dot = document.querySelector(`.city-dot[data-city="${cityName}"]`);
    if (dot) {
        dot.classList.add('active');
        // Move and show label
        if (mapLabel) {
            mapLabel.setAttribute('x', dot.getAttribute('cx'));
            mapLabel.setAttribute('y', parseInt(dot.getAttribute('cy')) - 10);
            mapLabel.textContent = cityName;
            mapLabel.classList.add('visible');
        }
    }
}

mapTags.forEach(tag => {
    tag.addEventListener('click', () => {
        activateCity(tag.getAttribute('data-city'));
    });
});

mapDots.forEach(dot => {
    dot.addEventListener('click', () => {
        activateCity(dot.getAttribute('data-city'));
    });
});

const mapContainer = document.querySelector('.area-map-container');
if (mapContainer) {
    mapContainer.addEventListener('click', (e) => {
        if (e.target === mapContainer || e.target.tagName === 'svg') {
            activateCity(null);
        }
    });
}

// SOLAR WIDGET
const LAT        = 53.1789;  // szerokość geograficzna (Łomża)
const LNG        = 22.0593;  // długość geograficzna  (Łomża)
const PEAK_POWER = 3150;     // moc szczytowa Twoich paneli w Watach (7 x 450W)
let solarState   = null;     // Przechowywanie danych do interakcji
let currentForecastView = 'solar'; // 'solar' lub 'temp'
let solarTimeout;            // Timer do automatycznego od?wie?ania
let solarClockTimer = null;  // Lekki ticker do aktualizacji po aktualnym czasie
const SOLAR_WIDGET_TIMEZONE = 'Europe/Warsaw';

function getSeason(date) {
    const m = date.getMonth() + 1, d = date.getDate();
    if ((m === 3 && d >= 20) || m === 4 || m === 5 || (m === 6 && d < 21))
        return { label: '🌱 Wiosna', factor: 0.80 };
    if ((m === 6 && d >= 21) || m === 7 || m === 8 || (m === 9 && d < 23))
        return { label: '☀️ Lato',   factor: 1.00 };
    if ((m === 9 && d >= 23) || m === 10 || m === 11 || (m === 12 && d < 22))
        return { label: '🍂 Jesień', factor: 0.55 };
    return { label: '❄️ Zima', factor: 0.30 };
}

// Helper: fetch z timeoutem (8 sekund)
function fetchWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer'
    })
        .finally(() => clearTimeout(timer));
}

function setSolarApiDebug(message, tone = 'idle') {
    const el = document.getElementById('sw-api-debug');
    if (!el) return;

    const tones = {
        idle: 'rgba(255,255,255,0.55)',
        info: 'rgba(125,211,252,0.9)',
        success: '#86efac',
        warning: '#fbbf24',
        error: '#fca5a5'
    };

    el.style.color = tones[tone] || tones.idle;
    el.textContent = message;
}

// WANA POPRAWKA: formatTime
// Open-Meteo zwraca sunrise/sunset jako czas LOKALNY (nie UTC!)
function formatTime(input) {
    if (!input) return '--:--';

    // 1. Je?li to liczba (timestamp z hovera na wykresie)
    if (typeof input === 'number') {
        const ts = input < 1e12 ? input * 1000 : input;
        return new Date(ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }

    // 2. Je?li to string ISO z API (np. "2026-02-16T07:15")
    const str = String(input);
    const parts = str.split('T');
    if (parts.length > 1) {
        return parts[1].substring(0, 5);
    }
    return '--:--';
}

function parseSolarTime(input, timeZone = SOLAR_WIDGET_TIMEZONE) {
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number' && Number.isFinite(input)) return input < 1e12 ? input * 1000 : input;
    if (!input) return NaN;

    const raw = String(input).trim();
    if (!raw) return NaN;
    if (/[zZ]$/.test(raw) || /[+-]\d\d:\d\d$/.test(raw)) {
        return new Date(raw).getTime();
    }

    const [datePart, timePart = '00:00:00'] = raw.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour = '0', minute = '0', second = '0'] = timePart.split(':');
    if (![year, month, day].every(Number.isFinite)) return NaN;

    const wallClockUtcGuess = Date.UTC(year, month - 1, day, Number(hour), Number(minute), Number(second));

    try {
        const getOffsetMs = (ts) => {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone,
                timeZoneName: 'shortOffset',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour12: false
            }).formatToParts(new Date(ts));
            const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
            const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
            if (!match) return 0;
            const sign = match[1] === '+' ? 1 : -1;
            return sign * ((Number(match[2]) * 60) + Number(match[3] || 0)) * 60 * 1000;
        };

        let ts = wallClockUtcGuess - getOffsetMs(wallClockUtcGuess);
        ts = wallClockUtcGuess - getOffsetMs(ts);
        return ts;
    } catch (e) {
        // Awaryjnie: przynajmniej nie blokujemy całego widgetu.
        return new Date(raw).getTime();
    }
}

function getLocalDateKey(date, timeZone = SOLAR_WIDGET_TIMEZONE) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return y && m && d ? `${y}-${m}-${d}` : '';
}

function getTodayDailyIndex(daily, now = new Date(), timeZone = SOLAR_WIDGET_TIMEZONE) {
    const times = Array.isArray(daily?.time) ? daily.time : [];
    if (!times.length) return 0;

    const todayKey = getLocalDateKey(now, timeZone);
    for (let i = 0; i < times.length; i++) {
        const raw = times[i];
        const ts = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : new Date(raw).getTime();
        if (!Number.isFinite(ts)) continue;
        if (getLocalDateKey(new Date(ts), timeZone) === todayKey) return i;
    }

    return Math.min(1, times.length - 1);
}

function getDatePartsInTimeZone(date, timeZone = SOLAR_WIDGET_TIMEZONE) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return year && month && day ? { year, month, day } : null;
}

function getTimeZoneOffsetMinutes(date, timeZone = SOLAR_WIDGET_TIMEZONE) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour12: false
        }).formatToParts(date);
        const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
        const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
        if (!match) return 0;
        const sign = match[1] === '+' ? 1 : -1;
        return sign * ((Number(match[2]) * 60) + Number(match[3] || 0));
    } catch (e) {
        return 0;
    }
}

function getSolarTimesForDate(date, lat = LAT, lon = LNG, timeZone = SOLAR_WIDGET_TIMEZONE) {
    const parts = getDatePartsInTimeZone(date, timeZone);
    if (!parts) return null;

    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    if (![year, month, day].every(Number.isFinite)) return null;

    const localUtcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
    const dayOfYear = Math.floor((localUtcMidnight - Date.UTC(year, 0, 0)) / 86400000);
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
    const eqTime = 229.18 * (
        0.000075 +
        0.001868 * Math.cos(gamma) -
        0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) -
        0.040849 * Math.sin(2 * gamma)
    );
    const decl = 0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma);

    const latRad = deg2rad(lat);
    const zenith = deg2rad(90.833);
    const cosHa = (Math.cos(zenith) / (Math.cos(latRad) * Math.cos(decl))) - Math.tan(latRad) * Math.tan(decl);
    const hasSunrise = cosHa >= -1 && cosHa <= 1;
    const hourAngle = hasSunrise ? Math.acos(clamp(cosHa, -1, 1)) : (cosHa > 1 ? 0 : Math.PI);
    const daylightHours = hasSunrise ? (2 * rad2deg(hourAngle)) / 15 : (cosHa > 1 ? 0 : 24);
    const timezoneOffsetMin = getTimeZoneOffsetMinutes(date, timeZone);
    const solarNoonMin = 720 - (4 * lon) - eqTime + timezoneOffsetMin;
    const sunriseMin = solarNoonMin - rad2deg(hourAngle) * 4;
    const sunsetMin = solarNoonMin + rad2deg(hourAngle) * 4;

    const sunriseHour = Math.floor((sunriseMin % 1440 + 1440) % 1440 / 60);
    const sunriseMinute = Math.round((sunriseMin % 60 + 60) % 60);
    const sunsetHour = Math.floor((sunsetMin % 1440 + 1440) % 1440 / 60);
    const sunsetMinute = Math.round((sunsetMin % 60 + 60) % 60);

    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    const sunriseIso = `${dateKey}T${String(sunriseHour).padStart(2, '0')}:${String(sunriseMinute).padStart(2, '0')}`;
    const sunsetIso = `${dateKey}T${String(sunsetHour).padStart(2, '0')}:${String(sunsetMinute).padStart(2, '0')}`;

    return {
        sunriseIso,
        sunsetIso,
        sunriseTs: parseSolarTime(sunriseIso),
        sunsetTs: parseSolarTime(sunsetIso),
        daylightHours,
        dateKey
    };
}

function pseudoDayNoise(date) {
    const seed = date.getFullYear() * 1000 + (date.getMonth() + 1) * 37 + date.getDate() * 101;
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

function buildFallbackSolarData(now = new Date()) {
    const season = getSeason(now);
    const systemKWp = PEAK_POWER / 1000;
    const daily = {
        time: [],
        sunrise: [],
        sunset: [],
        shortwave_radiation_sum: [],
        temperature_2m_max: [],
        temperature_2m_min: [],
        precipitation_sum: [],
        weather_code: []
    };
    const hourly = {
        time: [],
        shortwave_radiation: []
    };

    const currentSolar = getSolarTimesForDate(now);
    const currentNoise = pseudoDayNoise(now);
    const currentClouds = Math.round(clamp(18 + currentNoise * 62 + (1 - season.factor) * 12, 10, 90));
    const currentHumidity = Math.round(clamp(42 + currentNoise * 45 + (1 - season.factor) * 18, 20, 98));
    const currentTemp = Math.round(clamp(
        (season.factor * 16) + (currentNoise * 10) - 2,
        -12,
        34
    ));
    const isDay = currentSolar ? Date.now() >= currentSolar.sunriseTs && Date.now() <= currentSolar.sunsetTs : false;
    const daylightFactor = currentSolar && Number.isFinite(currentSolar.daylightHours) ? clamp(currentSolar.daylightHours / 12, 0.45, 1.25) : 1;
    const cloudFactor = 1 - (currentClouds / 100) * 0.85;
    const currentRadiation = isDay ? Math.round(clamp(840 * season.factor * cloudFactor * daylightFactor, 40, 980)) : 0;

    for (let i = -1; i < 14; i++) {
        const day = new Date(now);
        day.setHours(12, 0, 0, 0);
        day.setDate(day.getDate() + i);
        const times = getSolarTimesForDate(day);
        const noise = pseudoDayNoise(day);
        const clouds = Math.round(clamp(20 + noise * 60 + (1 - season.factor) * 15 + Math.abs(i) * 1.2, 10, 95));
        const tempMin = Math.round(clamp((season.factor * 6) - 6 + noise * 6 - Math.max(0, i) * 0.2, -18, 24));
        const tempMax = Math.round(clamp(tempMin + 7 + season.factor * 10 + noise * 4, -8, 38));
        const rain = Math.max(0, Number((noise * (1 - season.factor) * 2.8).toFixed(1)));
        const dayLength = times && Number.isFinite(times.daylightHours) ? times.daylightHours : 12;
        const prodKwh = systemKWp * 4.2 * season.factor * clamp(1 - (clouds / 100) * 0.75, 0.2, 1) * clamp(dayLength / 12, 0.5, 1.3);
        const shortwaveSum = prodKwh * 3.6 / (systemKWp * 0.82);
        const weatherCode = clouds < 20 ? 0 : clouds < 35 ? 1 : clouds < 55 ? 2 : clouds < 75 ? 3 : 61;

        daily.time.push(times?.dateKey || getLocalDateKey(day));
        daily.sunrise.push(times?.sunriseIso || null);
        daily.sunset.push(times?.sunsetIso || null);
        daily.shortwave_radiation_sum.push(Number(shortwaveSum.toFixed(2)));
        daily.temperature_2m_max.push(tempMax);
        daily.temperature_2m_min.push(tempMin);
        daily.precipitation_sum.push(rain);
        daily.weather_code.push(weatherCode);
    }

    for (let h = -24; h < 24; h++) {
        const hourDate = new Date(now);
        hourDate.setMinutes(0, 0, 0);
        hourDate.setHours(hourDate.getHours() + h);
        const times = getSolarTimesForDate(hourDate);
        const noise = pseudoDayNoise(hourDate);
        const clouds = Math.round(clamp(18 + noise * 65 + (1 - season.factor) * 10, 8, 92));
        const factor = 1 - (clouds / 100) * 0.85;
        let radiation = 0;
        if (times && Number.isFinite(times.sunriseTs) && Number.isFinite(times.sunsetTs) && hourDate.getTime() >= times.sunriseTs && hourDate.getTime() <= times.sunsetTs) {
            const ratio = clamp((hourDate.getTime() - times.sunriseTs) / (times.sunsetTs - times.sunriseTs), 0, 1);
            radiation = Math.round(clamp(Math.sin(Math.PI * ratio) * 860 * season.factor * factor, 0, 1000));
        }
        hourly.time.push(Math.floor(hourDate.getTime() / 1000));
        hourly.shortwave_radiation.push(radiation);
    }

    return {
        current: {
            shortwave_radiation: currentRadiation,
            cloud_cover: currentClouds,
            is_day: isDay ? 1 : 0,
            temperature_2m: currentTemp,
            relative_humidity_2m: currentHumidity,
            weather_code: currentClouds < 20 ? 0 : currentClouds < 35 ? 1 : currentClouds < 55 ? 2 : currentClouds < 75 ? 3 : 61
        },
        daily,
        hourly,
        source: 'fallback'
    };
}

function getCurrentHourlyValue(hourly, field, now = new Date(), timeZone = SOLAR_WIDGET_TIMEZONE) {
    const times = Array.isArray(hourly?.time) ? hourly.time : [];
    const values = Array.isArray(hourly?.[field]) ? hourly[field] : [];
    if (!times.length || !values.length) return null;

    const nowKey = getLocalDateKey(now, timeZone);
    const nowHour = now.getHours();
    let bestIndex = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < times.length && i < values.length; i++) {
        const raw = times[i];
        const ts = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : new Date(raw).getTime();
        if (!Number.isFinite(ts)) continue;

        const tsDate = new Date(ts);
        if (getLocalDateKey(tsDate, timeZone) !== nowKey) continue;

        const diff = Math.abs(tsDate.getHours() - nowHour);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = i;
        }
    }

    if (bestIndex === -1) {
        bestIndex = Math.min(times.length - 1, Math.max(0, Math.floor(times.length / 2)));
    }

    const value = values[bestIndex];
    return Number.isFinite(value) ? value : null;
}

function updateSolarDailyValue() {
    if (!solarState) return;

    const { sunriseTs, sunsetTs, clouds } = solarState;
    const nowTs = Date.now();
    if (![sunriseTs, sunsetTs].every(Number.isFinite) || sunsetTs <= sunriseTs) return 0;

    const dayLengthHours = (sunsetTs - sunriseTs) / (1000 * 60 * 60);
    let nowRatio = (nowTs - sunriseTs) / (sunsetTs - sunriseTs);
    nowRatio = Math.max(0, Math.min(1, nowRatio));

    const cloudFactor = 1 - (Number(clouds) / 100) * 0.85;
    const integralFactor = (1 - Math.cos(Math.PI * nowRatio)) / Math.PI;
    const producedWh = PEAK_POWER * cloudFactor * 0.82 * dayLengthHours * integralFactor;
    const producedKWh = producedWh / 1000;
    const dailyValEl = document.getElementById('sw-daily-val');
    if (dailyValEl) dailyValEl.textContent = producedKWh.toFixed(2);
    solarState.currentProduction = producedKWh;
    return producedKWh;
}

function startSolarClock() {
    clearInterval(solarClockTimer);
    solarClockTimer = setInterval(() => {
        if (!solarState) return;
        updateSolarDailyValue();
        drawSolarCurve();
    }, 30000);
}

// SOLAR WIDGET: Gwiazdki nocne
const SKY_OBSERVER_LOMZA = { lat: 53.1781, lon: 22.0596 }; // deg, E dodatnie
const SKY_CATALOG_STARS_URL = './stars.6.json';
const SKY_CATALOG_CONSTELLATIONS_URL = './constellations.lines.json';

const starsData = { stars: [], lines: [] };
let starsAnimFrame = null; // zostawione dla kompatybilnosci ze starym kodem
let starsUpdateTimer = null;
let skyCatalogsPromise = null;

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function deg2rad(d) { return (d * Math.PI) / 180; }
function rad2deg(r) { return (r * 180) / Math.PI; }
function normDeg360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
function normDeg180(d) { d = ((d + 180) % 360) - 180; return d < -180 ? d + 360 : d; }

function julianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
}

function gmstDegrees(date) {
    const jd = julianDate(date);
    const T = (jd - 2451545.0) / 36525.0;
    const gmst = 280.46061837
        + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * T * T
        - (T * T * T) / 38710000.0;
    return normDeg360(gmst);
}

function raDecToAltAz(raDeg, decDeg, date, latDeg, lonDeg) {
    const lat = deg2rad(latDeg);
    const dec = deg2rad(decDeg);
    const lst = normDeg360(gmstDegrees(date) + lonDeg);
    const H = deg2rad(normDeg180(lst - normDeg360(raDeg)));

    const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(H);
    const alt = Math.asin(clamp(sinAlt, -1, 1));

    // Azymut od N w kierunku E
    const cosAlt = Math.cos(alt);
    const sinAz = (-Math.cos(dec) * Math.sin(H)) / Math.max(1e-9, cosAlt);
    const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) / Math.max(1e-9, (cosAlt * Math.cos(lat)));
    let az = Math.atan2(sinAz, cosAz);
    if (az < 0) az += Math.PI * 2;

    return { altRad: alt, azRad: az };
}

function bvToRgb(bvRaw) {
    const bv = Number.isFinite(bvRaw) ? bvRaw : parseFloat(bvRaw);
    if (!Number.isFinite(bv)) return [255, 255, 255];
    if (bv <= -0.2) return [180, 200, 255];
    if (bv <= 0.0) {
        const t = (bv + 0.2) / 0.2;
        return [Math.round(180 + (210 - 180) * t), Math.round(200 + (220 - 200) * t), 255];
    }
    if (bv <= 0.6) {
        const t = bv / 0.6;
        return [255, Math.round(255 - (255 - 245) * t), Math.round(255 - (255 - 230) * t)];
    }
    if (bv <= 1.5) {
        const t = (bv - 0.6) / 0.9;
        return [255, Math.round(245 - (245 - 200) * t), Math.round(230 - (230 - 160) * t)];
    }
    const t = clamp((bv - 1.5) / 1.2, 0, 1);
    return [255, Math.round(200 - 60 * t), Math.round(160 - 80 * t)];
}

async function loadSkyCatalogs() {
    if (skyCatalogsPromise) return skyCatalogsPromise;
    skyCatalogsPromise = (async () => {
        try {
            // Używamy Promise.allSettled, aby błąd jednego pliku nie blokował drugiego
            const results = await Promise.allSettled([
                fetch(SKY_CATALOG_STARS_URL, { cache: 'force-cache' }),
                fetch(SKY_CATALOG_CONSTELLATIONS_URL, { cache: 'force-cache' })
            ]);

            let starsJson = null;
            let constellationsJson = null;

            // Sprawdzamy wynik dla gwiazd
            if (results[0].status === 'fulfilled' && results[0].value.ok) {
                starsJson = await results[0].value.json().catch(() => null);
            } else {
                console.warn('Widżet: Nie znaleziono pliku stars.6.json, używam fallbacku.');
            }

            // Sprawdzamy wynik dla linii konstelacji
            if (results[1].status === 'fulfilled' && results[1].value.ok) {
                constellationsJson = await results[1].value.json().catch(() => null);
            } else {
                console.warn('Widżet: Nie znaleziono pliku constellations.lines.json - linie nie będą rysowane.');
            }

            return { stars: starsJson, constellations: constellationsJson };
        } catch (e) {
            console.error('Błąd krytyczny podczas ładowania danych nieba:', e);
            return { stars: null, constellations: null };
        }
    })();
    return skyCatalogsPromise;
}

function getStarsVisibilityFactor() {
    const clouds = (typeof solarState === 'object' && solarState && Number.isFinite(solarState.clouds)) ? solarState.clouds : null;
    const cloudFactor = clouds == null ? 1 : clamp(1 - (clouds / 100) * 0.85, 0.12, 1);
    const moon = typeof getMoonData === 'function' ? getMoonData(new Date()) : null;
    const moonIllum = moon && Number.isFinite(moon.illumination) ? moon.illumination : 0;
    const moonFactor = clamp(1 - moonIllum * 0.35, 0.65, 1);
    return cloudFactor * moonFactor;
}

function resizeStarsCanvas(canvas, widget) {
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const cssW = widget?.offsetWidth || 600;
    const cssH = widget?.offsetHeight || 220;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function projectAltAzToCanvas(altRad, azRad, width, height) {
    const horizonPadding = 0.06;
    const radiusX = width * (0.5 - horizonPadding);
    const radiusY = height * (0.52 - horizonPadding);
    const cx = width * 0.5;
    const cy = height * 0.56;

    const zenithAngle = (Math.PI / 2) - altRad;
    const r = clamp(zenithAngle / (Math.PI / 2), 0, 1);
    const x = cx + Math.sin(azRad) * r * radiusX;
    const y = cy - Math.cos(azRad) * r * radiusY;
    return { x, y };
}

function buildFallbackStars(width, height) {
    // Fallback gdy nie da si? pobra? katalog?w (np. uruchomienie z file://).
    // Statyczne kropki ? bez animacji.
    const count = Math.floor((width * height) / 2200);
    let seed = Math.floor(width * 1000 + height * 7) >>> 0;
    const rnd = () => {
        // LCG
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const stars = [];
    for (let i = 0; i < count; i++) {
        const x = rnd() * width;
        const y = rnd() * height * 0.78;
        const size = 0.6 + rnd() * 1.2;
        const alpha = 0.15 + rnd() * 0.55;
        stars.push({ x, y, size, alpha, rgb: [255, 255, 255] });
    }
    return stars;
}

async function initStars(date = new Date()) {
    const canvas = document.getElementById('sw-stars-canvas');
    if (!canvas) return;
    const widget = canvas.closest('.solar-widget');
    if (!widget) return;

    resizeStarsCanvas(canvas, widget);

    const width = Math.max(10, widget.offsetWidth || widget.clientWidth || 600);
    const height = Math.max(10, widget.offsetHeight || widget.clientHeight || 220);

    let stars = null;
    let constellations = null;
    try {
        const catalogs = await loadSkyCatalogs();
        stars = catalogs.stars;
        constellations = catalogs.constellations;
    } catch (e) {
        // W razie błędu: pokaż chociaż gwiazdki (bez konstelacji), zamiast pustego tła
        starsData.stars = buildFallbackStars(width, height);
        starsData.lines.length = 0;
        return;
    }
    const visFactor = getStarsVisibilityFactor();

    const area = Math.max(1, width * height);
    const areaScale = clamp(area / 200000, 0.35, 1);
    const magLimit = 4.2 + 0.8 * areaScale; // ~4.5..5.0

    const lat = SKY_OBSERVER_LOMZA.lat;
    const lon = SKY_OBSERVER_LOMZA.lon;

    starsData.stars.length = 0;
    starsData.lines.length = 0;

    const feats = Array.isArray(stars?.features) ? stars.features : [];
    for (let i = 0; i < feats.length; i++) {
        const f = feats[i];
        const raDeg = f?.geometry?.coordinates?.[0];
        const decDeg = f?.geometry?.coordinates?.[1];
        const mag = f?.properties?.mag;
        if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || !Number.isFinite(mag)) continue;
        if (mag > magLimit) continue;

        const { altRad, azRad } = raDecToAltAz(raDeg, decDeg, date, lat, lon);
        const altDeg = rad2deg(altRad);
        if (altDeg < 0) continue;

        const p = projectAltAzToCanvas(altRad, azRad, width, height);
        const horizonFade = clamp((altDeg - 3) / 18, 0, 1);

        const size = clamp(1.9 - mag * 0.28, 0.5, 1.7);
        const alphaBase = clamp(0.95 - mag * 0.12, 0.10, 0.90);
        const alpha = alphaBase * horizonFade * visFactor;
        if (alpha < 0.03) continue;

        const [r, g, b] = bvToRgb(f?.properties?.bv);
        starsData.stars.push({ x: p.x, y: p.y, size, alpha, rgb: [r, g, b] });
    }

    const conFeats = Array.isArray(constellations?.features) ? constellations.features : [];
    for (let i = 0; i < conFeats.length; i++) {
        const cf = conFeats[i];
        const rank = String(cf?.properties?.rank ?? '');
        if (rank && rank !== '1' && rank !== '2') continue;
        const multi = cf?.geometry?.coordinates;
        if (!Array.isArray(multi)) continue;

        for (const line of multi) {
            if (!Array.isArray(line) || line.length < 2) continue;
            for (let j = 0; j < line.length - 1; j++) {
                const a = line[j];
                const b = line[j + 1];
                const raA = a?.[0], decA = a?.[1];
                const raB = b?.[0], decB = b?.[1];
                if (!Number.isFinite(raA) || !Number.isFinite(decA) || !Number.isFinite(raB) || !Number.isFinite(decB)) continue;

                const aa = raDecToAltAz(raA, decA, date, lat, lon);
                const bb = raDecToAltAz(raB, decB, date, lat, lon);
                const altA = rad2deg(aa.altRad);
                const altB = rad2deg(bb.altRad);
                if (altA < 0 && altB < 0) continue;

                const pa = projectAltAzToCanvas(aa.altRad, aa.azRad, width, height);
                const pb = projectAltAzToCanvas(bb.altRad, bb.azRad, width, height);
                starsData.lines.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
            }
        }
    }
}

function drawStars() {
    const canvas = document.getElementById('sw-stars-canvas');
    const widget = canvas ? canvas.closest('.solar-widget') : null;
    if (!canvas || !widget) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(10, widget.offsetWidth || widget.clientWidth || 600);
    const height = Math.max(10, widget.offsetHeight || widget.clientHeight || 220);
    ctx.clearRect(0, 0, width, height);

    if (!widget.classList.contains('is-night')) return;

    const grad = ctx.createRadialGradient(width * 0.55, height * 0.15, 0, width * 0.55, height * 0.2, Math.max(width, height) * 0.85);
    grad.addColorStop(0, 'rgba(59,130,246,0.10)');
    grad.addColorStop(1, 'rgba(2,6,23,0.00)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Konstelacje
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    ctx.shadowBlur = 2;
    ctx.shadowColor = 'rgba(96,165,250,0.04)';
    ctx.beginPath();
    for (const ln of starsData.lines) {
        ctx.moveTo(ln.x1, ln.y1);
        ctx.lineTo(ln.x2, ln.y2);
    }
    ctx.stroke();
    ctx.restore();

    // Gwiazdy
    for (const s of starsData.stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        const [r, g, b] = s.rgb;
        ctx.fillStyle = `rgba(${r},${g},${b},${s.alpha.toFixed(3)})`;
        ctx.fill();
    }
}

function startStars() {
    // Bez ci?g?ej animacji: przelicz/rysuj od razu + rzadkie odswiezanie (powolny obr?t nieba)
    Promise.resolve()
        .then(() => initStars(new Date()))
        .then(() => drawStars())
        .catch(() => {});

    if (starsAnimFrame) cancelAnimationFrame(starsAnimFrame);
    starsAnimFrame = null;

    if (starsUpdateTimer) clearInterval(starsUpdateTimer);
    starsUpdateTimer = setInterval(() => {
        const canvas = document.getElementById('sw-stars-canvas');
        const widget = canvas ? canvas.closest('.solar-widget') : null;
        if (!canvas || !widget || !widget.classList.contains('is-night')) return;
        Promise.resolve()
            .then(() => initStars(new Date()))
            .then(() => drawStars())
            .catch(() => {});
    }, 10 * 60 * 1000);
}

function stopStars() {
    if (starsUpdateTimer) clearInterval(starsUpdateTimer);
    starsUpdateTimer = null;
    if (starsAnimFrame) cancelAnimationFrame(starsAnimFrame);
    starsAnimFrame = null;
    drawStars(); // wyczysci canvas (bo nie jest is-night) lub przerysuje
}

// ťť HERO: Realistyczne niebo (gwiazdy + konstelacje) ťťťťťťťťťťťťťťťťťťťťťťťťťťťť
const heroSkyData = { stars: [], lines: [] };
let heroSkyTimer = null;
let heroSkyAnimFrame = null;
let heroSkyLastDraw = 0;
let heroSkyNextSparkleAt = 0;

async function initHeroSky(date = new Date()) {
    const canvas = document.getElementById('hero-sky-canvas');
    const hero = document.querySelector('.hero');
    if (!canvas || !hero) return;

    resizeStarsCanvas(canvas, hero);

    const width = Math.max(10, hero.offsetWidth || hero.clientWidth || 1200);
    const height = Math.max(10, hero.offsetHeight || hero.clientHeight || 700);

    let stars = null;
    let constellations = null;
    try {
        const catalogs = await loadSkyCatalogs();
        stars = catalogs.stars;
        constellations = catalogs.constellations;
    } catch (_) {
        heroSkyData.stars = buildFallbackStars(width, height);
        heroSkyData.lines.length = 0;
        return;
    }

    const visFactor = getStarsVisibilityFactor();

    // W HERO pozwalamy na nieco ciemniejsze gwiazdy
    const area = Math.max(1, width * height);
    const areaScale = clamp(area / 700000, 0.35, 1);
    const magLimit = 4.6 + 0.8 * areaScale; // ~4.9..5.4

    const lat = SKY_OBSERVER_LOMZA.lat;
    const lon = SKY_OBSERVER_LOMZA.lon;

    heroSkyData.stars.length = 0;
    heroSkyData.lines.length = 0;

    const feats = Array.isArray(stars?.features) ? stars.features : [];
    for (let i = 0; i < feats.length; i++) {
        const f = feats[i];
        const raDeg = f?.geometry?.coordinates?.[0];
        const decDeg = f?.geometry?.coordinates?.[1];
        const mag = f?.properties?.mag;
        if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || !Number.isFinite(mag)) continue;
        if (mag > magLimit) continue;

        const { altRad, azRad } = raDecToAltAz(raDeg, decDeg, date, lat, lon);
        const altDeg = rad2deg(altRad);
        if (altDeg < 0) continue;

        const p = projectAltAzToCanvas(altRad, azRad, width, height);
        const horizonFade = clamp((altDeg - 2) / 14, 0, 1);

        const size = clamp(2.2 - mag * 0.30, 0.55, 2.0);
        const alphaBase = clamp(1.05 - mag * 0.13, 0.12, 0.95);
        const alpha = alphaBase * horizonFade * visFactor;
        if (alpha < 0.03) continue;

        const [r, g, b] = bvToRgb(f?.properties?.bv);

        // Migotanie: tylko cz??? ja?niejszych gwiazd, subtelnie i bez "p?ywania"
        const canTwinkle = alpha > 0.18 && size > 0.9;
        const twinkle = canTwinkle && Math.random() < 0.55;
        const twinkleAmp = twinkle ? (0.14 + Math.random() * 0.26) : 0; // 14%..40%
        const twinkleSpeed = twinkle ? (1.4 + Math.random() * 3.2) : 0; // rad/s
        const twinklePhase = twinkle ? (Math.random() * Math.PI * 2) : 0;

        heroSkyData.stars.push({
            x: p.x, y: p.y, size, alpha, rgb: [r, g, b],
            twinkleAmp, twinkleSpeed, twinklePhase,
            sparkleT0: 0, sparkleT1: 0, sparkleAmp: 0
        });
    }

    const conFeats = Array.isArray(constellations?.features) ? constellations.features : [];
    for (let i = 0; i < conFeats.length; i++) {
        const cf = conFeats[i];
        const rank = String(cf?.properties?.rank ?? '');
        if (rank && rank !== '1' && rank !== '2') continue;
        const multi = cf?.geometry?.coordinates;
        if (!Array.isArray(multi)) continue;

        for (const line of multi) {
            if (!Array.isArray(line) || line.length < 2) continue;
            for (let j = 0; j < line.length - 1; j++) {
                const a = line[j];
                const b = line[j + 1];
                const raA = a?.[0], decA = a?.[1];
                const raB = b?.[0], decB = b?.[1];
                if (!Number.isFinite(raA) || !Number.isFinite(decA) || !Number.isFinite(raB) || !Number.isFinite(decB)) continue;

                const aa = raDecToAltAz(raA, decA, date, lat, lon);
                const bb = raDecToAltAz(raB, decB, date, lat, lon);
                if (rad2deg(aa.altRad) < 0 || rad2deg(bb.altRad) < 0) continue;

                const pa = projectAltAzToCanvas(aa.altRad, aa.azRad, width, height);
                const pb = projectAltAzToCanvas(bb.altRad, bb.azRad, width, height);
                heroSkyData.lines.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
            }
        }
    }
}

function drawHeroSky(ts = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const canvas = document.getElementById('hero-sky-canvas');
    const hero = document.querySelector('.hero');
    if (!canvas || !hero) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(10, hero.offsetWidth || hero.clientWidth || 1200);
    const height = Math.max(10, hero.offsetHeight || hero.clientHeight || 700);
    ctx.clearRect(0, 0, width, height);

    if (!hero.classList.contains('is-night')) return;

    // Delikatna po?wiata nieba
    const grad = ctx.createRadialGradient(width * 0.55, height * 0.10, 0, width * 0.55, height * 0.20, Math.max(width, height) * 0.95);
    grad.addColorStop(0, 'rgba(59,130,246,0.10)');
    grad.addColorStop(1, 'rgba(2,6,23,0.00)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Konstelacje (subtelnie, ?eby nie zlewa?y si? z UI)
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = 'rgba(148,163,184,0.07)';
    ctx.shadowBlur = 2;
    ctx.shadowColor = 'rgba(96,165,250,0.04)';
    ctx.beginPath();
    for (const ln of heroSkyData.lines) {
        ctx.moveTo(ln.x1, ln.y1);
        ctx.lineTo(ln.x2, ln.y2);
    }
    ctx.stroke();
    ctx.restore();

    // Gwiazdy
    const t = ts / 1000;

    // "B?y?ni?cia" gwiazd: kontrolowana cz?stotliwo?? (nie zale?y od FPS)
    if (heroSkyData.stars.length) {
        if (!heroSkyNextSparkleAt) heroSkyNextSparkleAt = t + 0.15;
        if (t >= heroSkyNextSparkleAt) {
            // ok. 2?5 b?ysk?w na sekund?, zwykle 2?4 gwiazdy naraz
            const nextIn = 0.20 + Math.random() * 0.28; // 0.20..0.48s
            heroSkyNextSparkleAt = t + nextIn;

            const bursts = 2 + Math.floor(Math.random() * 3); // 2..4
            for (let k = 0; k < bursts; k++) {
                // kilka pr?b, ?eby trafi? w ja?niejsz? gwiazd?
                let picked = null;
                for (let tries = 0; tries < 8; tries++) {
                    const idx = Math.floor(Math.random() * heroSkyData.stars.length);
                    const cand = heroSkyData.stars[idx];
                    if (cand && cand.alpha > 0.14) { picked = cand; break; }
                }
                const s = picked || heroSkyData.stars[Math.floor(Math.random() * heroSkyData.stars.length)];
                if (!s || s.alpha <= 0.10) continue;

                const dur = 0.18 + Math.random() * 0.22; // 0.18..0.40s
                s.sparkleT0 = t;
                s.sparkleT1 = t + dur;
                s.sparkleAmp = 0.55 + Math.random() * 1.10; // 55%..165%
            }
        }
    }

    for (const s of heroSkyData.stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        const [r, g, b] = s.rgb;

// Migotanie: tylko rozjania (bez przygaszania), eby byo wyraşniejsze
        const tw = s.twinkleAmp && s.twinkleSpeed
            ? (1 + s.twinkleAmp * (0.55 + 0.45 * Math.sin(t * s.twinkleSpeed + s.twinklePhase)))
            : 1;

        // B?ysk: szybkie rozja?nienie i zanik
        let sparkle = 1;
        if (s.sparkleT1 && t < s.sparkleT1) {
            const p = (t - s.sparkleT0) / Math.max(1e-6, (s.sparkleT1 - s.sparkleT0)); // 0..1
            const bump = 1 - Math.abs(2 * p - 1); // tr?jk?t 0..1..0
            sparkle = 1 + (s.sparkleAmp || 0) * bump;
        }

        const a = clamp(s.alpha * tw * sparkle, 0, 1);
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
        ctx.fill();
    }
}

function startHeroSky() {
    Promise.resolve()
        .then(() => initHeroSky(new Date()))
        .then(() => drawHeroSky())
        .catch(() => {});

    // Delikatne migotanie (bez ruchu): limit FPS, ?eby by?o lekko
    if (heroSkyAnimFrame) cancelAnimationFrame(heroSkyAnimFrame);
    heroSkyLastDraw = 0;
    heroSkyNextSparkleAt = 0;
    const loop = (now) => {
        const hero = document.querySelector('.hero');
        if (!hero || !hero.classList.contains('is-night')) {
            heroSkyAnimFrame = null;
            return;
        }
        if (now - heroSkyLastDraw > 50) { // ~20 FPS
            drawHeroSky(now);
            heroSkyLastDraw = now;
        }
        heroSkyAnimFrame = requestAnimationFrame(loop);
    };
    heroSkyAnimFrame = requestAnimationFrame(loop);

    if (heroSkyTimer) clearInterval(heroSkyTimer);
    heroSkyTimer = setInterval(() => {
        const hero = document.querySelector('.hero');
        if (!hero || !hero.classList.contains('is-night')) return;
        Promise.resolve()
            .then(() => initHeroSky(new Date()))
            .then(() => drawHeroSky())
            .catch(() => {});
    }, 10 * 60 * 1000);
}

function stopHeroSky() {
    if (heroSkyTimer) clearInterval(heroSkyTimer);
    heroSkyTimer = null;
    if (heroSkyAnimFrame) cancelAnimationFrame(heroSkyAnimFrame);
    heroSkyAnimFrame = null;
    drawHeroSky();
}

(function() {
    const canvas = document.getElementById('hero-sky-canvas');
    const hero = document.querySelector('.hero');
    if (!canvas || !hero || typeof ResizeObserver === 'undefined') return;
    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (hero.classList.contains('is-night')) startHeroSky();
            else stopHeroSky();
        }, 180);
    });
    ro.observe(hero);
})();

// Reinicjalizuj canvas przy ka?dej zmianie rozmiaru widgetu
(function() {
    const canvas = document.getElementById('sw-stars-canvas');
    const widget = canvas ? canvas.closest('.solar-widget') : null;
    if (!widget) return;
    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (widget.classList.contains('is-night')) startStars();
            else {
                resizeStarsCanvas(canvas, widget);
                stopStars();
            }
        }, 140);
    });
    ro.observe(widget);
})();

// SOLAR WIDGET: Licznik mocy na zywo
let livePowerCurrent = 0;

function updateLivePower(targetW, isDay) {
    const wrap  = document.getElementById('sw-live-power');
    const valEl = document.getElementById('sw-live-val');
    if (!wrap || !valEl) return;
    if (!isDay || targetW <= 0) {
        wrap.style.display = 'none';
        livePowerCurrent = 0;
        return;
    }
    wrap.style.display = 'flex';
    const start = livePowerCurrent;
    const end   = targetW;
    const duration = 1200;
    let startTime = null;
    function step(ts) {
        if (!startTime) startTime = ts;
        const progress = Math.min((ts - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const val  = Math.round(start + (end - start) * ease);
        valEl.textContent = val.toLocaleString('pl-PL');
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            valEl.textContent = end.toLocaleString('pl-PL');
            livePowerCurrent = end;
            valEl.classList.remove('updated');
            void valEl.offsetWidth;
            valEl.classList.add('updated');
        }
    }
    requestAnimationFrame(step);
}

function drawSolarCurve(hoverX = null) {
    const canvas = document.getElementById('solarCanvas');
    if (!canvas || !solarState) return;
    const { sunriseTs, sunsetTs, clouds } = solarState;
    const nowTs = Date.now();

    const wrap   = canvas.parentElement;
    canvas.width  = wrap.clientWidth  || 800;
    canvas.height = wrap.clientHeight || 110;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const isNightMode = document.querySelector('.solar-widget')?.classList.contains('is-night');

    const pad   = { l: 12, r: 12, t: 18, b: 28 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    const isDaylight = nowTs >= sunriseTs && nowTs <= sunsetTs;
    const totalDay   = sunsetTs - sunriseTs;

// Siatka godzinowa
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const sunriseDate = new Date(sunriseTs);
    const startH = sunriseDate.getHours();
    for (let h = startH; h <= 23; h++) {
        const hTs = new Date(sunriseDate).setHours(h, 0, 0, 0);
        if (hTs < sunriseTs || hTs > sunsetTs) continue;
        const x = pad.l + ((hTs - sunriseTs) / totalDay) * plotW;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
    }

// Gradient pod krzyw
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    if (isNightMode) {
        grad.addColorStop(0, 'rgba(59, 130, 246, 0.25)'); // Niebieskawy w nocy
        grad.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
    } else {
        grad.addColorStop(0, 'rgba(245,158,11,0.35)'); // Pomara?czowy w dzie?
        grad.addColorStop(1, 'rgba(245,158,11,0.03)');
    }

// Sinusoida produkcji (zachmurzenie spaszcza krzyw)
    const cloudFactor = 1 - (clouds / 100) * 0.85;
    const steps = 300;

    // Wype?nienie gradientem
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
        const t   = i / steps;
        const sin = Math.sin(Math.PI * t);
        const y   = pad.t + plotH * (1 - sin * cloudFactor);
        const x   = pad.l + t * plotW;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(pad.l + plotW, H - pad.b);
    ctx.lineTo(pad.l, H - pad.b);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Linia krzywej
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
        const t   = i / steps;
        const sin = Math.sin(Math.PI * t) * cloudFactor;
        const y   = pad.t + plotH * (1 - sin);
        const x   = pad.l + t * plotW;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    
    // Gradient dla linii: Niebieski (rano) -> Pomara?czowy (po?udnie) -> Niebieski (wiecz?r)
    const strokeGrad = ctx.createLinearGradient(pad.l, 0, pad.l + plotW, 0);
    if (isNightMode) {
        strokeGrad.addColorStop(0.0, '#1e40af');
        strokeGrad.addColorStop(0.5, '#3b82f6'); // Ch?odny niebieski ?rodek
        strokeGrad.addColorStop(1.0, '#1e40af');
        ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
    } else {
        strokeGrad.addColorStop(0.0, '#3B82F6');
        strokeGrad.addColorStop(0.5, '#F59E0B'); // Ciep?y pomara?czowy ?rodek
        strokeGrad.addColorStop(1.0, '#3B82F6');
        ctx.shadowColor = 'rgba(245,158,11,0.6)';
    }
    ctx.strokeStyle = strokeGrad;

    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

// INTERAKCJA (HOVER)
    if (hoverX !== null) {
        const t = (hoverX - pad.l) / plotW;
        if (t >= 0 && t <= 1) {
            const hoverTime = sunriseTs + t * totalDay;
            const sinHover = Math.sin(Math.PI * t);
            // Moc w danym punkcie (szacunkowa)
            const hoverPower = Math.max(0, Math.round(sinHover * cloudFactor * PEAK_POWER * 0.82));
            const hoverY = pad.t + plotH * (1 - sinHover * cloudFactor);

            // Linia pionowa
            ctx.beginPath();
            ctx.moveTo(hoverX, pad.t);
            ctx.lineTo(hoverX, H - pad.b);
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // K??ko na krzywej
            ctx.beginPath(); ctx.arc(hoverX, hoverY, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();

            // Tooltip box
            const tipText = `${formatTime(hoverTime)} | ${hoverPower} W`;
            ctx.font = 'bold 11px sans-serif';
            const tipW = ctx.measureText(tipText).width + 16;
            const tipH = 24;
            let tipX = hoverX - tipW / 2;
            if (tipX < 0) tipX = 0; if (tipX + tipW > W) tipX = W - tipW;
            const tipY = Math.max(0, hoverY - 35);

            ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
            ctx.beginPath(); ctx.roundRect(tipX, tipY, tipW, tipH, 6); ctx.fill();
            ctx.strokeStyle = 'rgba(245,158,11,0.5)'; ctx.lineWidth = 1; ctx.stroke();
            
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
            ctx.fillText(tipText, tipX + tipW / 2, tipY + 16);
        }
    }

// Znacznik "TERAZ"
    const nowRatioRaw = (nowTs - sunriseTs) / totalDay;
    const nowRatio = Math.max(0, Math.min(1, nowRatioRaw));
    const nowX = pad.l + nowRatio * plotW;

    if (isDaylight) {
        // Przyciemnij przeszłość tylko w ciągu dnia
        ctx.save(); ctx.beginPath(); ctx.rect(pad.l, 0, nowX - pad.l, H); ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    // Pionowa linia
    ctx.beginPath(); ctx.moveTo(nowX, pad.t - 4); ctx.lineTo(nowX, H - pad.b + 4);
    ctx.strokeStyle = isDaylight ? 'rgba(255,255,255,0.5)' : 'rgba(148,163,184,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);

    const sinNow = Math.sin(Math.PI * nowRatio) * cloudFactor;
    const nowY   = pad.t + plotH * (1 - sinNow);

    // Kulka słońca z blaskiem i promyczkami
    ctx.save();
    var sunGrad = ctx.createRadialGradient(nowX, nowY, 0, nowX, nowY, 18);
    sunGrad.addColorStop(0,   'rgba(253,224,71,0.9)');
    sunGrad.addColorStop(0.4, 'rgba(245,158,11,0.5)');
    sunGrad.addColorStop(1,   'rgba(245,158,11,0)');
    ctx.beginPath(); ctx.arc(nowX, nowY, 18, 0, Math.PI * 2);
    ctx.fillStyle = sunGrad; ctx.fill();
    ctx.beginPath(); ctx.arc(nowX, nowY, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = 'rgba(253,224,71,1)'; ctx.shadowBlur = 16;
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(253,224,71,0.6)'; ctx.lineWidth = 1.5;
    for (var ang = 0; ang < Math.PI * 2; ang += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(nowX + Math.cos(ang) * 9,  nowY + Math.sin(ang) * 9);
        ctx.lineTo(nowX + Math.cos(ang) * 14, nowY + Math.sin(ang) * 14);
        ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    var labelX = Math.min(Math.max(nowX, 28), W - 28);
    ctx.fillText('TERAZ', labelX, nowY - 26);
    // Etykiety osi
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('🌅', pad.l, H - 8);
    ctx.textAlign = 'center'; ctx.fillText('🌞 południe', pad.l + plotW / 2, H - 8);
    ctx.textAlign = 'right'; ctx.fillText('🌇', pad.l + plotW, H - 8);
    // O? pozioma
    ctx.beginPath(); ctx.moveTo(pad.l, H - pad.b); ctx.lineTo(pad.l + plotW, H - pad.b);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
}

// Mapa kodw WMO emoji ikona i opis
function wmoIcon(code) {
    if (code === 0)               return { icon: '☀️',  label: 'Bezchmurnie' };
    if (code <= 2)                return { icon: '🌤️',  label: 'Częściowe zachmurzenie' };
    if (code === 3)               return { icon: '☁️',  label: 'Pochmurno' };
    if (code <= 49)               return { icon: '🌫️',  label: 'Mgła' };
    if (code <= 59)               return { icon: '🌦️',  label: 'Mżawka' };
    if (code <= 69)               return { icon: '🌧️',  label: 'Deszcz' };
    if (code <= 79)               return { icon: '❄️',  label: 'Śnieg' };
    if (code <= 84)               return { icon: '🌧️',  label: 'Przelotne opady' };
    if (code <= 94)               return { icon: '⛈️',  label: 'Burza' };
    return                               { icon: '⛈️',  label: 'Burza z gradem' };
}

// ============================================================
//  WYKRES PRODUKCJI DOBOWEJ – wykres godzinowy jak w SolarEdge
// ============================================================
let dayChartInstance = null;

function renderDayChart() {
    const wrap = document.getElementById('sw-daychart-wrap');
    const canvas = document.getElementById('sw-daychart');
    if (!wrap || !canvas || !solarState || !solarState.hourly) return;

    const hourly = solarState.hourly;
    const now = new Date();
    const efficiency = 0.82;
    const systemKWp = PEAK_POWER / 1000;

    // Buduj tablicę 24h dla dzisiejszego dnia (0:00 – 23:00)
    const todayKey = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' }); // "YYYY-MM-DD"
    const labels = [];
    const dataKW = [];
    const weatherIcons = [];

    // Wyciągnij hourly dane tylko dla dzisiaj
    for (let i = 0; i < hourly.time.length; i++) {
        const ts = hourly.time[i]; // Unix timestamp (s)
        const d = new Date(ts * 1000);
        const dayKey = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
        if (dayKey !== todayKey) continue;

        const hh = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
        labels.push(hh);

        const rad = hourly.shortwave_radiation[i] ?? 0;
        const kw = parseFloat(((rad / 1000) * systemKWp * efficiency).toFixed(3));
        dataKW.push(kw);
    }

    if (labels.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    // Ikony pogody co 4 godziny (na górze wykresu)
    const daily = solarState.daily;
    const wCode = daily?.weather_code?.[0] ?? 0;
    const wmoIcon = (code) => {
        if (code === 0) return '☀️';
        if (code <= 2) return '🌤️';
        if (code === 3) return '☁️';
        if (code <= 48) return '🌫️';
        if (code <= 57) return '🌦️';
        if (code <= 67) return '🌧️';
        if (code <= 77) return '❄️';
        if (code <= 82) return '🌧️';
        return '⛈️';
    };
    const weatherEl = document.getElementById('sw-daychart-weather');
    if (weatherEl) {
        // Pokaż ikonę co ~4 godziny (6 pozycji)
        const step = Math.floor(labels.length / 6) || 1;
        let html = '';
        for (let i = 0; i < labels.length; i += step) {
            html += `<span title="${labels[i]}">${wmoIcon(wCode)}</span>`;
        }
        weatherEl.innerHTML = html;
    }

    // Całkowita suma dzienna kWh (trapezy)
    const totalKWh = dataKW.reduce((s, v) => s + v, 0).toFixed(2);
    const price = (() => { const el = document.getElementById('range-price'); return el ? parseFloat(el.value) : 1.10; })();
    const totalEl = document.getElementById('sw-daychart-total');
    if (totalEl) totalEl.textContent = `Suma: ${totalKWh} kWh ≈ ${(totalKWh * price).toFixed(2)} zł`;

    // Linia "teraz" — aktualny indeks godziny
    const nowHour = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
    const nowIdx = labels.indexOf(nowHour);

    // Gradient fill pod wykresem
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 160);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.55)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.03)');

    // Zniszcz poprzedni wykres
    if (dayChartInstance) { dayChartInstance.destroy(); dayChartInstance = null; }

    dayChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Produkcja (kW)',
                data: dataKW,
                fill: true,
                backgroundColor: gradient,
                borderColor: 'rgba(96, 165, 250, 0.9)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#60a5fa',
                tension: 0.35,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.92)',
                    titleColor: 'rgba(255,255,255,0.6)',
                    bodyColor: '#60a5fa',
                    borderColor: 'rgba(96,165,250,0.3)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        title: (items) => `Godzina: ${items[0].label}`,
                        label: (item) => {
                            const kw = item.raw;
                            const kwh = kw.toFixed(2);
                            const zl = (kw * price).toFixed(2);
                            return [`Produkcja: ${kwh} kW`, `Zysk: ≈ ${zl} zł`];
                        }
                    }
                },
                // Pionowa linia "teraz"
                ...(nowIdx >= 0 ? {
                    annotation: undefined
                } : {})
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: 'rgba(255,255,255,0.4)',
                        font: { size: 10 },
                        maxTicksLimit: 8,
                        maxRotation: 0,
                    },
                    border: { color: 'rgba(255,255,255,0.1)' }
                },
                y: {
                    min: 0,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: 'rgba(255,255,255,0.4)',
                        font: { size: 10 },
                        callback: v => v.toFixed(1) + ' kW',
                        maxTicksLimit: 5,
                    },
                    border: { color: 'rgba(255,255,255,0.1)' }
                }
            }
        },
        plugins: [{
            // Pionowa linia "TERAZ"
            id: 'nowLine',
            afterDraw(chart) {
                if (nowIdx < 0) return;
                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
                const xPos = x.getPixelForIndex(nowIdx);
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([4, 3]);
                ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
                ctx.lineWidth = 1.5;
                ctx.moveTo(xPos, top);
                ctx.lineTo(xPos, bottom);
                ctx.stroke();
                ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('teraz', xPos, top - 4);
                ctx.restore();
            }
        }]
    });
}


function renderForecast(view) {
    const container = document.getElementById('sw-forecast');
    if (!container || !solarState || !solarState.daily) return;

    container.innerHTML = '';
    const titleEl = document.querySelector('.sw-forecast-title');
    const daily = solarState.daily;
    const DAYS_PL = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
    const MONTHS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
    const efficiency = 0.82;
    const n = daily.shortwave_radiation_sum?.length ?? 14;

    if (view === 'history') {
        const hourly = solarState.hourly;
        if (!hourly) {
            container.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:0.8rem; padding:20px;">Ładowanie historii...</div>';
            return;
        }
        const localNow = new Date();
        // API zwraca Unix timestamps (sekundy) z powodu &timeformat=unixtime
        // Szukamy godziny bieżącej przez porównanie Unix ts
        const nowHourTs = Math.floor(localNow.getTime() / 1000 / 3600) * 3600; // zaokrąglenie do godziny
        const isUnix = typeof hourly.time[0] === 'number';

        let currentIndex;
        if (isUnix) {
            currentIndex = hourly.time.findIndex(t => t >= nowHourTs);
            if (currentIndex === -1) currentIndex = hourly.time.length - 1;
            // cofnij jeśli wskazuje na przyszłość
            if (currentIndex > 0 && hourly.time[currentIndex] > nowHourTs) currentIndex--;
        } else {
            const year = localNow.getFullYear();
            const month = String(localNow.getMonth() + 1).padStart(2, '0');
            const day = String(localNow.getDate()).padStart(2, '0');
            const hour = String(localNow.getHours()).padStart(2, '0');
            const currentLocalIso = `${year}-${month}-${day}T${hour}:00`;
            currentIndex = hourly.time.findIndex(t => t === currentLocalIso);
            if (currentIndex === -1) currentIndex = hourly.time.length - 1;
        }

        // helper: Unix ts lub ISO string → "HH:MM"
        function tsToHourStr(t) {
            if (typeof t === 'number') {
                return new Date(t * 1000).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
            }
            return t.split('T')[1].substring(0, 5);
        }

        const startIndex = Math.max(0, currentIndex - 23);
        const dataSlice = hourly.shortwave_radiation.slice(startIndex, currentIndex + 1);
        const timeSlice = hourly.time.slice(startIndex, currentIndex + 1);
        const systemKWp = PEAK_POWER / 1000;
        const historyKWh = dataSlice.map(rad => (rad / 1000) * systemKWp * efficiency);

        const total24h = historyKWh.reduce((sum, val) => sum + val, 0);
        const currentPrice = inputs.price.el ? parseFloat(inputs.price.el.value) : 1.10;
        const totalSaved = total24h * currentPrice;
        const maxHourVal = Math.max(...historyKWh);
        const maxHourIdx = historyKWh.indexOf(maxHourVal);
        const maxHourStr = tsToHourStr(timeSlice[maxHourIdx]);

        if (titleEl) {
            titleEl.innerHTML = `Ostatnie 24h <span style="color:#60a5fa; margin-left:8px; text-transform:none; font-weight:600; font-size:0.8rem;">(Suma: ${total24h.toFixed(2)} kWh ≈ ${totalSaved.toFixed(2)} zł)</span>` +
                               `<div style="font-size:0.65rem; color:rgba(255,255,255,0.4); margin-top:2px; text-transform:none;">Szczyt: ${maxHourVal.toFixed(2)} kWh o godz. ${maxHourStr}</div>`;
        }

        const maxKWh = Math.max(...historyKWh, 0.5);

        timeSlice.forEach((iso, i) => {
            const val = historyKWh[i];
            const hourStr = tsToHourStr(iso);
            const heightPct = Math.max((val / maxKWh) * 100, 2);
            const hourlySaved = val * currentPrice;
            const tooltip = `Godzina: ${hourStr}\nProdukcja: ${val.toFixed(2)} kWh\nZysk: ${hourlySaved.toFixed(2)} zł`;
            const isNow = i === dataSlice.length - 1 ? 'today' : '';
            const html = `
                <div class="sw-day ${isNow} sw-animate-in" style="animation-delay:${i * 0.02}s; min-width:44px;" data-tooltip="${tooltip}">
                    <div class="sw-bar-wrap" style="height:100px;">
                        <div class="sw-day-val" style="font-size:0.6rem;">${val > 0.05 ? val.toFixed(1) : ''}</div>
                        <div class="sw-bar" style="height:${heightPct}%; background:linear-gradient(to top, rgba(59, 130, 246, 0.3), rgba(59, 130, 246, 0.7)); border-top-color:#60a5fa; ${val <= 0.05 ? 'opacity:0.2' : ''} ${i === maxHourIdx && val > 0 ? 'box-shadow: 0 0 15px rgba(96, 165, 250, 0.4); border-top-width:3px;' : ''}"></div>
                    </div>
                    <div class="sw-day-name" style="font-size:0.55rem; margin-top:4px;">${hourStr}</div>
                </div>`;
            container.insertAdjacentHTML('beforeend', html);
        });
    } else if (view === 'solar') {
        if (titleEl) titleEl.textContent = 'Prognoza produkcji (14 dni)';
// WIDOK PRODUKCJI supki + ikona pogody + opady
        const dailyRad  = daily.shortwave_radiation_sum;
        const wCodes    = daily.weather_code ?? [];
        const precip    = daily.precipitation_sum ?? [];
        const systemKWp = PEAK_POWER / 1000;
        const dailyKWh  = dailyRad.map(mj => (mj / 3.6) * systemKWp * efficiency);
        const maxKWh    = Math.max(...dailyKWh, 5);

        dailyKWh.forEach((val, i) => {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dayName  = i === 0 ? 'Dziś' : DAYS_PL[date.getDay()];
            const dateStr  = `${date.getDate()} ${MONTHS_PL[date.getMonth()]}`;
            const heightPct = Math.max((val / maxKWh) * 100, 2);
            const wmo      = wmoIcon(wCodes[i] ?? 0);
            const rain     = precip[i] > 0.1 ? `<div class="sw-rain">${precip[i].toFixed(1)} mm</div>` : '';
            const isToday  = i === 0 ? 'today' : '';
            const isFar    = i >= 10 ? 'sw-far' : '';
            const tooltip  = `${dateStr} — ${wmo.label}\nProdukcja: ${val.toFixed(2)} kWh${precip[i] > 0.1 ? `\nOpady: ${precip[i].toFixed(1)} mm` : ''}`;

            const html = `
                <div class="sw-day ${isToday} ${isFar} sw-animate-in" style="animation-delay:${i * 0.04}s" data-tooltip="${tooltip}">
                    <div class="sw-wmo">${wmo.icon}</div>
                    <div class="sw-bar-wrap">
                        <div class="sw-day-val">${val.toFixed(1)}</div>
                        <div class="sw-bar" style="height:${heightPct}%"></div>
                    </div>
                    ${rain}
                    <div class="sw-day-name">${dayName}</div>
                    <div class="sw-day-date">${dateStr}</div>
                </div>`;
            container.insertAdjacentHTML('beforeend', html);
        });

    } else {
        if (titleEl) titleEl.textContent = 'Prognoza temperatury (14 dni)';
// WIDOK TEMPERATURY SVG linia
        const tMax     = daily.temperature_2m_max;
        const tMin     = daily.temperature_2m_min;
        const wCodes   = daily.weather_code ?? [];
        const globalMax = Math.max(...tMax) + 3;
        const globalMin = Math.min(...tMin) - 3;
        const range    = globalMax - globalMin || 1;
        const colWidth = 100 / n;

        let pointsMax = '', pointsMin = '';
        let tempLabels = '', dayLabels = '', iconLabels = '';

        tMax.forEach((val, i) => {
            const x    = (i + 0.5) * colWidth;
            const yMax = 100 - ((val - globalMin) / range) * 100;
            const yMin = 100 - ((tMin[i] - globalMin) / range) * 100;
            pointsMax += `${x.toFixed(2)},${yMax.toFixed(2)} `;
            pointsMin += `${x.toFixed(2)},${yMin.toFixed(2)} `;

            const date = new Date();
            date.setDate(date.getDate() + i);
            const dayName = i === 0 ? 'Dziś' : DAYS_PL[date.getDay()];
            const dateStr = `${date.getDate()} ${MONTHS_PL[date.getMonth()]}`;
            const wmo = wmoIcon(wCodes[i] ?? 0);
            const isFar = i >= 10 ? 'opacity:0.45;' : '';

            iconLabels  += `<div style="position:absolute;left:${(i * colWidth).toFixed(2)}%;top:0;width:${colWidth.toFixed(2)}%;text-align:center;font-size:0.85rem;${isFar}">${wmo.icon}</div>`;
            tempLabels  += `<div style="position:absolute;left:${(i * colWidth).toFixed(2)}%;top:${yMax.toFixed(2)}%;width:${colWidth.toFixed(2)}%;text-align:center;transform:translateY(-115%);font-size:0.65rem;font-weight:700;color:#ef4444;${isFar}">${Math.round(val)}°</div>`;
            tempLabels  += `<div style="position:absolute;left:${(i * colWidth).toFixed(2)}%;top:${yMin.toFixed(2)}%;width:${colWidth.toFixed(2)}%;text-align:center;margin-top:4px;font-size:0.65rem;font-weight:700;color:#60a5fa;${isFar}">${Math.round(tMin[i])}°</div>`;
            dayLabels   += `<div style="position:absolute;left:${(i * colWidth).toFixed(2)}%;bottom:14px;width:${colWidth.toFixed(2)}%;text-align:center;font-size:0.6rem;color:rgba(255,255,255,0.5);text-transform:uppercase;${isFar}">${dayName}</div>`;
            dayLabels   += `<div style="position:absolute;left:${(i * colWidth).toFixed(2)}%;bottom:0;width:${colWidth.toFixed(2)}%;text-align:center;font-size:0.55rem;color:rgba(255,255,255,0.25);${isFar}">${dateStr}</div>`;
        });

        // Pionowe linie co 7 dni (separator tydzie? 1 / tydzie? 2)
        const sepX = (7 * colWidth).toFixed(2);

        container.innerHTML = `
            <div style="position:relative;width:100%;height:100%;">
                <div style="position:absolute;top:22px;left:0;right:0;bottom:32px;">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible;">
                        <line x1="${sepX}" y1="-5" x2="${sepX}" y2="105" stroke="rgba(255,255,255,0.08)" stroke-width="0.5" vector-effect="non-scaling-stroke" stroke-dasharray="3,3"/>
                        <polyline points="${pointsMax}" fill="none" stroke="#ef4444" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
                        <polyline points="${pointsMin}" fill="none" stroke="#60a5fa" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
                    </svg>
                    ${tempLabels}
                </div>
                <div style="position:absolute;top:0;left:0;right:0;height:22px;">${iconLabels}</div>
                ${dayLabels}
                <div style="position:absolute;top:4px;right:0;font-size:0.55rem;color:rgba(255,255,255,0.2);letter-spacing:.04em;">Tydzień 2 →</div>
            </div>`;
        container.style.position = 'relative';
    }
}

function getMoonData(date) {
    const SYNODIC_MONTH = 29.530588853;
    // Astronomical reference new moon: 2000-01-06 18:14 UTC
    const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);
    const daysSinceNew = (date.getTime() - KNOWN_NEW_MOON_UTC) / 86400000;
    const age = ((daysSinceNew % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
    const phase = age / SYNODIC_MONTH; // 0..1
    const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * phase)); // 0..1
    const waxing = phase < 0.5; // true = przybywa
    const phaseIndex = Math.round(phase * 8) % 8; // zgodne z istniej?cymi klasami CSS

    return { phase, age, illumination, waxing, phaseIndex };
}

// Tryb nocny tylko dla localhost/127.0.0.1 (bezpieczny debug)
const DEBUG_FORCE_NIGHT = (
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    new URLSearchParams(window.location.search).get('night') === '1'
);

function applyMoonVisuals(sunWrapper, moon) {
    if (!sunWrapper || !moon) return;
    sunWrapper.setAttribute('data-phase', moon.phaseIndex);
    const haloAlpha = (0.14 + moon.illumination * 0.58).toFixed(3);
    sunWrapper.style.setProperty('--moon-halo-alpha', haloAlpha);
}

// LICZNIK ZAROBKU OD MONTAU
// Ustaw datę pierwszego uruchomienia systemu (RRRR, MM-1, DD)
const SYSTEM_START_DATE = new Date(2025, 0, 1); // Styczeń 2025 - zmień na swoją datę!
const ANNUAL_PRODUCTION_KWH = 6200; // Szacowana roczna produkcja kWh (7 paneli x 450W, Łomża)

let earnedAnimFrame = null;
let earnedCurrentVal = 0;

function updateEarnedCounter() {
    const box = document.getElementById('sw-earned-box');
    if (!box) return;

    // Pobierz aktualn? cen? pr?du z kalkulatora
    const priceEl  = document.getElementById('range-price');
    const price    = priceEl ? parseFloat(priceEl.value) : 1.10;

    // Oblicz ile dni min??o od monta?u
    const now      = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRun  = Math.max(0, Math.floor((now - SYSTEM_START_DATE) / msPerDay));

    // Szacowana ??czna produkcja (proporcjonalnie do dni)
    // Uwzgl?dniamy sezonowo??: lato produkuje wi?cej, zima mniej
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / msPerDay);
    // Wsp??czynnik sezonowy (sinusoida: max w czerwcu ~dzie? 172)
    const seasonFactor = 0.55 + 0.45 * Math.sin(((dayOfYear - 80) / 365) * 2 * Math.PI);

// Roczna produkcja — uamek roku ktry min (z korekcj sezonow)
    const totalKwh = (ANNUAL_PRODUCTION_KWH / 365) * daysRun * (0.7 + seasonFactor * 0.3);

// Zarobek = produkcja — cena prdu
    const totalEarned = totalKwh * price;

    // Dzisiaj: kWh z solar widgetu
    const todayKwhEl = document.getElementById('sw-daily-val');
    const todayKwh   = todayKwhEl ? parseFloat(todayKwhEl.textContent) || 0 : 0;
    const todayEarned = todayKwh * price;

    // Aktualizuj etykiet? ceny
    const priceLabel = document.getElementById('sw-earned-price');
    if (priceLabel) priceLabel.textContent = price.toFixed(2).replace('.', ',');

    // Aktualizuj dni
    const daysEl = document.getElementById('sw-earned-days');
    if (daysEl) daysEl.textContent = daysRun.toLocaleString('pl-PL');

    // Aktualizuj kWh
    const kwhEl = document.getElementById('sw-earned-kwh');
    if (kwhEl) kwhEl.textContent = Math.round(totalKwh).toLocaleString('pl-PL');

    // Aktualizuj dzi?
    const todayEl = document.getElementById('sw-earned-today-val');
    if (todayEl) {
        todayEl.textContent = todayEarned > 0
            ? todayEarned.toFixed(2).replace('.', ',')
            : '--';
    }

    // Pasek post?pu (cel: roczna oszcz?dno?? = ANNUAL_PRODUCTION_KWH * price)
    const annualGoal = ANNUAL_PRODUCTION_KWH * price;
    const progressPct = Math.min(100, Math.round((totalEarned % annualGoal) / annualGoal * 100));
    const barEl = document.getElementById('sw-earned-bar');
    if (barEl) barEl.style.width = progressPct + '%';

    // Animuj licznik złot?wek (od poprzedniej do nowej warto?ci)
    const valEl = document.getElementById('sw-earned-val');
    if (!valEl) return;

    const startVal = earnedCurrentVal;
    const endVal   = totalEarned;
    const duration = 1800;
    let startTime  = null;

    if (earnedAnimFrame) cancelAnimationFrame(earnedAnimFrame);

    function animStep(ts) {
        if (!startTime) startTime = ts;
        const progress = Math.min((ts - startTime) / duration, 1);
        const ease     = 1 - Math.pow(1 - progress, 4); // easeOutQuart
        const current  = startVal + (endVal - startVal) * ease;
        valEl.textContent = current.toLocaleString('pl-PL', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) + ' zł';
        if (progress < 1) {
            earnedAnimFrame = requestAnimationFrame(animStep);
        } else {
            earnedCurrentVal = endVal;
        }
    }
    earnedAnimFrame = requestAnimationFrame(animStep);
}

// Uruchom przy starcie i po ka?dej zmianie ceny pr?du
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(updateEarnedCounter, 800);

    // Reaguj na zmian? ceny pr?du w kalkulatorze
    const priceSlider = document.getElementById('range-price');
    if (priceSlider) {
        priceSlider.addEventListener('input', function() {
            setTimeout(updateEarnedCounter, 50);
        });
    }
});

// Odświeżaj co 60 sekund (aktualizacja licznika zarobku)
let earnedCounterInterval = setInterval(function() {
    if (typeof updateEarnedCounter === 'function') updateEarnedCounter();
}, 60000);

// Zatrzymaj gdy karta niewidoczna (oszczędność CPU)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        clearInterval(earnedCounterInterval);
        earnedCounterInterval = null;
    } else if (!earnedCounterInterval) {
        earnedCounterInterval = setInterval(function() {
            if (typeof updateEarnedCounter === 'function') updateEarnedCounter();
        }, 60000);
    }
});

async function loadSolarData() {
    clearTimeout(solarTimeout);

    const refreshBtn = document.getElementById('sw-refresh-btn');
    if(refreshBtn) refreshBtn.classList.add('loading');
    setSolarApiDebug('API: łączenie...', 'info');

    const now = new Date();
    const season = getSeason(now);
    const seasonEl = document.getElementById('sw-season');
    if(seasonEl) seasonEl.textContent = season.label;
    const loadingEl = document.getElementById('sw-loading');

    // Upewnij si? ?e loading jest widoczny na start
    if (loadingEl) {
        loadingEl.style.display = 'flex';
        loadingEl.innerHTML = '<div class="sw-spinner"></div> Pobieranie danych...';
    }

    try {
        const url = `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${LAT}&longitude=${LNG}` +
            `&current=shortwave_radiation,cloud_cover,is_day,temperature_2m,weather_code,relative_humidity_2m` +
            `&hourly=shortwave_radiation` +
            `&daily=shortwave_radiation_sum,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,weather_code` +
            `&timeformat=unixtime` +
            `&timezone=Europe/Warsaw` +
            `&forecast_days=14&past_days=1`;

        const response = await fetchWithTimeout(url, 8000);

        if (!response.ok) {
            setSolarApiDebug(`API: HTTP ${response.status} ${response.statusText}`, 'warning');
            throw new Error(`API HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        setSolarApiDebug(`API: OK (${response.status}) • źródło live`, 'success');


// Wschd / Zachd
        const dailyIndex = getTodayDailyIndex(data.daily, now, SOLAR_WIDGET_TIMEZONE);
        const sunriseIso = data.daily?.sunrise?.[dailyIndex];
        const sunsetIso  = data.daily?.sunset?.[dailyIndex];
        const dailyTime   = data.daily?.time?.[dailyIndex];

        if (!sunriseIso || !sunsetIso) {
            throw new Error('Brak danych sunrise/sunset w odpowiedzi API');
        }

// WANE: Open-Meteo zwraca czas lokalny uywamy formatTime bez konwersji
        const sunriseTs = parseSolarTime(sunriseIso);
        const sunsetTs  = parseSolarTime(sunsetIso);
        if (!Number.isFinite(sunriseTs) || !Number.isFinite(sunsetTs)) {
            throw new Error('Nie udało się przeliczyć sunrise/sunset na czas lokalny');
        }
        const nowTs     = now.getTime();
        
        const elSunrise = document.getElementById('sw-sunrise');
        const elSunset  = document.getElementById('sw-sunset');
        if (elSunrise) elSunrise.textContent = formatTime(sunriseIso);
        if (elSunset)  elSunset.textContent  = formatTime(sunsetIso);

        
// Dane meteo
        const currentRadiation = Number.isFinite(data.current?.shortwave_radiation)
            ? data.current.shortwave_radiation
            : getCurrentHourlyValue(data.hourly, 'shortwave_radiation', now) ?? 0;
        const radiation = Math.round(currentRadiation);
        const clouds    = Math.round(data.current?.cloud_cover ?? 0);
        const isDay     = data.current?.is_day === 1;
        const visualIsDay = DEBUG_FORCE_NIGHT ? false : isDay;
        const currentTemp = Math.round(data.current?.temperature_2m ?? 0);
        const humidity  = Math.round(data.current?.relative_humidity_2m ?? 0);

        // Dane do korekty temperaturowej kalkulatora
        weatherState.temperatureC = currentTemp;
        weatherState.radiationWm2 = radiation;
        calcUpdate();

        const efficiency = 0.82;
        const panelOutput = isDay
            ? Math.round((radiation / 1000) * PEAK_POWER * efficiency)
            : 0;

        // Aktualizacja wygl?du s?o?ca (Dzie?/Noc)
        const sunWrapper = document.getElementById('sun-wrapper');
        const heroSection = document.querySelector('.hero');
        const solarWidget = document.querySelector('.solar-widget');
        const titleText = document.getElementById('sw-title-text');

        if (sunWrapper) {
            if (visualIsDay) {
                sunWrapper.classList.remove('is-night');
                sunWrapper.removeAttribute('data-phase'); // Reset fazy w dzie?
                sunWrapper.style.removeProperty('--moon-halo-alpha');
            } else {
                sunWrapper.classList.add('is-night');
                
// OBLICZANIE FAZY KSIYCA (Lokalnie)
                const moon = getMoonData(new Date());
                applyMoonVisuals(sunWrapper, moon);
            }
        }
        if (heroSection) {
            if (visualIsDay) {
                heroSection.classList.remove('is-night');
                stopHeroSky();
            } else {
                heroSection.classList.add('is-night');
                startHeroSky();
            }
            
// EFEKT MGY (FOG)
            // W??cz mg?? je?li wilgotno?? > 90% LUB kod pogody to mg?a (45, 48)
            const wCode = data.current?.weather_code ?? 0;
            const isFoggy = humidity >= 90 || (wCode >= 45 && wCode <= 48);
            
            if (isFoggy) heroSection.classList.add('is-foggy');
            else heroSection.classList.remove('is-foggy');
        }
        if (solarWidget) {
            if (visualIsDay) {
                solarWidget.classList.remove('is-night');
                stopStars();
            } else {
                solarWidget.classList.add('is-night');
                startStars();
            }
        }

        if (titleText) {
            titleText.textContent = visualIsDay ? 'Nasłonecznienie dzisiaj' : 'Warunki nocne';
        }

        // Aktualizacja Favicon (S?o?ce / Ksi??yc)
        const favicon = document.querySelector("link[rel~='icon']");
        if (favicon) {
            const svgAnim = `<style>text{animation:f 1.5s ease-out}@keyframes f{from{opacity:0}to{opacity:1}}</style>`;
            favicon.href = visualIsDay
                ? `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>${svgAnim}<text y=%22.9em%22 font-size=%2290%22>☀️</text></svg>`
                : `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>${svgAnim}<text y=%22.9em%22 font-size=%2290%22>🌙</text></svg>`;
        }

        // Aktualizacja Theme Color (Pasek adresu)
        const themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) {
            themeMeta.content = visualIsDay ? '#F7F3EC' : '#0f172a';
        }


        const elRadiation = document.getElementById('sw-radiation');
        const elClouds    = document.getElementById('sw-clouds');
        const elPanels    = document.getElementById('sw-panels');
        if (elRadiation) elRadiation.textContent = radiation + ' W/m²';
        if (elClouds)    elClouds.textContent    = clouds + '%';
        if (elPanels)    elPanels.textContent    = panelOutput + ' W';

        // Licznik mocy na zywo
        updateLivePower(panelOutput, visualIsDay);

        const elTemp = document.getElementById('sw-current-temp');
        if (elTemp) {
            elTemp.textContent = `${currentTemp}°C`;
            if (currentTemp < 0) elTemp.style.color = '#3b82f6';       // Niebieski (mróz)
            else if (currentTemp > 25) elTemp.style.color = '#ef4444'; // Czerwony (upał)
            else elTemp.style.color = 'var(--sun)';                    // Domyślny (pomarańczowy)
        }

// Produkcja dzienna (cakowanie)
        solarState = {
            sunriseTs, sunsetTs,
            radiation, clouds,
            daily: data.daily,
            hourly: data.hourly,
            currentProduction: 0
        };

        const producedKWh = updateSolarDailyValue();

        // Od?wie? licznik zarobku po za?adowaniu danych dziennych
        if (typeof updateEarnedCounter === 'function') updateEarnedCounter();


// Badges (Weather Code)
        const wCode = data.current?.weather_code ?? 0;
        let wIcon = '', wText = '';

        // Mapowanie kod?w WMO na ikony i tekst
        if (wCode === 0) {
            wIcon = visualIsDay ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            wText = 'Bezchmurnie';
        } else if (wCode === 1 || wCode === 2) {
            wIcon = visualIsDay ? '<i class="fas fa-cloud-sun"></i>' : '<i class="fas fa-cloud-moon"></i>';
            wText = 'Małe zachmurzenie';
        } else if (wCode === 3) {
            wIcon = '<i class="fas fa-cloud"></i>';
            wText = 'Pochmurno';
        } else if (wCode >= 45 && wCode <= 48) {
            wIcon = '<i class="fas fa-smog"></i>';
            wText = 'Mgła';
        } else if (wCode >= 51 && wCode <= 67) {
            wIcon = '<i class="fas fa-cloud-rain"></i>';
            wText = 'Deszcz';
        } else if (wCode >= 71 && wCode <= 77) {
            wIcon = '<i class="fas fa-snowflake"></i>';
            wText = 'Śnieg';
        } else if (wCode >= 80 && wCode <= 82) {
            wIcon = '<i class="fas fa-cloud-showers-heavy"></i>';
            wText = 'Ulewa';
        } else if (wCode >= 95) {
            wIcon = '<i class="fas fa-bolt"></i>';
            wText = 'Burza';
        } else {
            wIcon = '<i class="fas fa-cloud"></i>';
            wText = 'Pochmurno';
        }

        const badgesEl = document.getElementById('sw-badges');
        if (badgesEl) {
            badgesEl.innerHTML =
                `<span class="sw-season-badge sw-animate-in">${season.label}</span>` +
                `<span class="sw-season-badge sw-animate-in" style="background:rgba(125,211,252,0.1);border-color:rgba(125,211,252,0.25);color:#7DD3FC;">${wIcon} ${wText} (${clouds}%)</span>`;
        }
        
// Ukryj loading, poka canvas
        if (loadingEl) loadingEl.style.display = 'none';
        
        const canvas = document.getElementById('solarCanvas');
        if (canvas) {
            canvas.style.display = 'block'; 
            canvas.classList.remove('sw-animate-in');
            void canvas.offsetWidth; // trigger reflow
            canvas.classList.add('sw-animate-in');

            drawSolarCurve(); 
            startSolarClock();
            window.dispatchEvent(new CustomEvent('solarDataLoaded'));
        } else {
            console.warn('☀️ Nie znaleziono elementu #solarCanvas!');
        }
        
        // Animacja warto?ci statystyk
        document.querySelectorAll('.sw-stat-val').forEach(el => {
            el.classList.remove('sw-animate-in');
            void el.offsetWidth;
            el.classList.add('sw-animate-in');
        });
        
        // Prognoza
        if (typeof renderForecast === 'function') {
            renderForecast(currentForecastView);
        }
        if (typeof renderDayChart === 'function') {
            renderDayChart();
        }

        // Auto-odswiezanie co 10 min
        solarTimeout = setTimeout(loadSolarData, 10 * 60 * 1000);

    } catch (err) {
        // Rozróżniamy timeout od innych błędów
        const isTimeout = err.name === 'AbortError';
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const errName = err?.name || 'Error';
        const msg = isTimeout
            ? '⏱ Timeout — serwer nie odpowiedział w 8 s'
            : `⚠️ ${err.message}`;

        if (isTimeout) {
            setSolarApiDebug('API: timeout po 8 s', 'error');
        } else if (isOffline) {
            setSolarApiDebug('API: brak internetu / offline', 'error');
        } else if (errName === 'TypeError' && /fetch/i.test(String(err.message || ''))) {
            setSolarApiDebug('API: fetch error (CORS / blokada przeglądarki)', 'error');
        } else {
            setSolarApiDebug(`API: błąd (${errName})`, 'error');
        }

        console.error('☀️ Solar widget błąd:', err);

        const fallbackData = buildFallbackSolarData(now);
        const fallbackDailyIndex = getTodayDailyIndex(fallbackData.daily, now, SOLAR_WIDGET_TIMEZONE);
        const fallbackSeason = getSeason(now);
        const solarWidget = document.querySelector('.solar-widget');
        const heroSection = document.querySelector('.hero');
        const sunWrapper = document.getElementById('sun-wrapper');
        const titleText = document.getElementById('sw-title-text');
        const isDayFallback = fallbackData.current?.is_day === 1;
        const visualIsDay = DEBUG_FORCE_NIGHT ? false : isDayFallback;

        if (sunWrapper) {
            if (visualIsDay) {
                sunWrapper.classList.remove('is-night');
                sunWrapper.removeAttribute('data-phase');
                sunWrapper.style.removeProperty('--moon-halo-alpha');
            } else {
                sunWrapper.classList.add('is-night');
                const moon = getMoonData(new Date());
                applyMoonVisuals(sunWrapper, moon);
            }
        }
        if (heroSection) {
            if (visualIsDay) {
                heroSection.classList.remove('is-night');
                stopHeroSky();
            } else {
                heroSection.classList.add('is-night');
                startHeroSky();
            }
            const wCode = fallbackData.current?.weather_code ?? 0;
            const humidity = Math.round(fallbackData.current?.relative_humidity_2m ?? 0);
            const isFoggy = humidity >= 90 || (wCode >= 45 && wCode <= 48);
            if (isFoggy) heroSection.classList.add('is-foggy');
            else heroSection.classList.remove('is-foggy');
        }
        if (solarWidget) {
            if (visualIsDay) {
                solarWidget.classList.remove('is-night');
                stopStars();
            } else {
                solarWidget.classList.add('is-night');
                startStars();
            }
        }

        if (titleText) {
            titleText.textContent = visualIsDay ? 'Nasłonecznienie dzisiaj' : 'Warunki nocne';
        }

        const elSunrise = document.getElementById('sw-sunrise');
        const elSunset = document.getElementById('sw-sunset');
        const elRadiation = document.getElementById('sw-radiation');
        const elClouds = document.getElementById('sw-clouds');
        const elPanels = document.getElementById('sw-panels');
        const elTemp = document.getElementById('sw-current-temp');

        if (elSunrise) elSunrise.textContent = formatTime(fallbackData.daily?.sunrise?.[fallbackDailyIndex]);
        if (elSunset) elSunset.textContent = formatTime(fallbackData.daily?.sunset?.[fallbackDailyIndex]);
        if (elRadiation) elRadiation.textContent = `${fallbackData.current?.shortwave_radiation ?? 0} W/m²`;
        if (elClouds) elClouds.textContent = `${fallbackData.current?.cloud_cover ?? 0}%`;

        const fallbackRadiation = Number(fallbackData.current?.shortwave_radiation ?? 0);
        const fallbackPanelOutput = visualIsDay ? Math.round((fallbackRadiation / 1000) * PEAK_POWER * 0.82) : 0;
        if (elPanels) elPanels.textContent = `${fallbackPanelOutput} W`;
        if (elTemp) {
            const temp = Math.round(fallbackData.current?.temperature_2m ?? 0);
            elTemp.textContent = `${temp}°C`;
            if (temp < 0) elTemp.style.color = '#3b82f6';
            else if (temp > 25) elTemp.style.color = '#ef4444';
            else elTemp.style.color = 'var(--sun)';
        }

        weatherState.temperatureC = Math.round(fallbackData.current?.temperature_2m ?? 0);
        weatherState.radiationWm2 = fallbackRadiation;
        calcUpdate();
        updateLivePower(fallbackPanelOutput, visualIsDay);

        solarState = {
            sunriseTs: parseSolarTime(fallbackData.daily?.sunrise?.[fallbackDailyIndex]),
            sunsetTs: parseSolarTime(fallbackData.daily?.sunset?.[fallbackDailyIndex]),
            radiation: Math.round(fallbackRadiation),
            clouds: Math.round(fallbackData.current?.cloud_cover ?? 0),
            daily: fallbackData.daily,
            hourly: fallbackData.hourly,
            currentProduction: 0,
            source: 'fallback'
        };

        updateSolarDailyValue();
        if (typeof updateEarnedCounter === 'function') updateEarnedCounter();
        if (typeof renderForecast === 'function') renderForecast(currentForecastView);
        if (typeof renderDayChart === 'function') renderDayChart();
        startSolarClock();
        window.dispatchEvent(new CustomEvent('solarDataLoaded'));

        const badgesEl = document.getElementById('sw-badges');
        if (badgesEl) {
            const wmo = fallbackData.current?.weather_code ?? 0;
            let wIcon = '<i class="fas fa-cloud"></i>';
            let wText = 'Pochmurno';
            if (wmo === 0) {
                wIcon = visualIsDay ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
                wText = 'Bezchmurnie';
            } else if (wmo === 1 || wmo === 2) {
                wIcon = visualIsDay ? '<i class="fas fa-cloud-sun"></i>' : '<i class="fas fa-cloud-moon"></i>';
                wText = 'Małe zachmurzenie';
            } else if (wmo >= 45 && wmo <= 48) {
                wIcon = '<i class="fas fa-smog"></i>';
                wText = 'Mgła';
            }
            badgesEl.innerHTML =
                `<span class="sw-season-badge sw-animate-in">${fallbackSeason.label}</span>` +
                `<span class="sw-season-badge sw-animate-in" style="background:rgba(125,211,252,0.1);border-color:rgba(125,211,252,0.25);color:#7DD3FC;">${wIcon} ${wText} (${fallbackData.current?.cloud_cover ?? 0}%)</span>` +
                `<span class="sw-season-badge sw-animate-in" style="background:rgba(250,204,21,0.1);border-color:rgba(250,204,21,0.25);color:#fde68a;">Tryb awaryjny</span>`;
        }

        if (loadingEl) {
            loadingEl.style.display = 'flex';
            loadingEl.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                    <span style="color:rgba(255,255,255,0.92); font-size:0.85rem;">Brak połączenia z API. Pokazuję lokalne szacunki produkcji.</span>
                    <span style="color:rgba(255,255,255,0.6); font-size:0.75rem;">${msg}</span>
                    <button id="sw-retry-btn" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:rgba(255,255,255,0.9); padding:5px 14px; border-radius:100px; font-size:0.75rem; cursor:pointer;">
                        Spróbuj ponownie ↻
                    </button>
                </div>
            `;
            const retryBtn = document.getElementById('sw-retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    loadingEl.innerHTML = '<div class="sw-spinner"></div> Pobieranie danych...';
                    loadSolarData();
                });
            }
        }

        const canvas = document.getElementById('solarCanvas');
        if (canvas) {
            canvas.style.display = 'block';
            drawSolarCurve();
        }

        solarTimeout = setTimeout(loadSolarData, 10 * 60 * 1000);

    } finally {
        const btn = document.getElementById('sw-refresh-btn');
        if (btn) btn.classList.remove('loading');
    }
}
const solarCanvasEl = document.getElementById('solarCanvas');
if (solarCanvasEl) {
    loadSolarData();

    window.addEventListener('resize', () => {
        if (solarCanvasEl.style.display !== 'none' && solarState) {
            drawSolarCurve();
        }
    });

    // Obs?uga myszy na wykresie
    solarCanvasEl.addEventListener('mousemove', (e) => {
        const rect = solarCanvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        drawSolarCurve(x);
    });
    solarCanvasEl.addEventListener('mouseleave', () => {
        drawSolarCurve(null);
    });

    // Obs?uga przycisku od?wie?ania
    const refreshBtnEl = document.getElementById('sw-refresh-btn');
    if (refreshBtnEl) {
        refreshBtnEl.addEventListener('click', () => {
            loadSolarData();
        });
    }

    // Obs?uga prze??czania widoku prognozy
    document.querySelectorAll('.sw-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sw-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentForecastView = btn.getAttribute('data-view');
            renderForecast(currentForecastView);
        });
    });
}

// SUN PARALLAX EFFECT
const sunWrapper = document.getElementById('sun-wrapper');
if (sunWrapper) {
    document.addEventListener('mousemove', (e) => {
        // Oblicz przesuni?cie wzgl?dem ?rodka ekranu (subtelny efekt: mno?nik 0.02)
        const x = (e.clientX - window.innerWidth / 2) * -0.02;
        const y = (e.clientY - window.innerHeight / 2) * -0.02;
        sunWrapper.style.transform = `translate(${x}px, ${y}px)`;
    });
}

// HERO SAVINGS ANIMATION
const heroSavingsEl = document.getElementById('hero-savings-val');
if (heroSavingsEl) {
    // Warto?? docelowa zgodna z kalkulatorem (180L, 4 os, 1.10z?)
    const targetSavings = 1640; 
    const animDuration = 2500;
    let animStart = null;

    function animateHeroSavings(timestamp) {
        if (!animStart) animStart = timestamp;
        const progress = Math.min((timestamp - animStart) / animDuration, 1);
        
        // Easing (easeOutExpo)
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        
        const currentVal = Math.floor(ease * targetSavings);
        // Formatowanie z spacj? jako separatorem tysi?cy
        heroSavingsEl.textContent = `≈ ${currentVal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} zł`;

        if (progress < 1) requestAnimationFrame(animateHeroSavings);
    }
    requestAnimationFrame(animateHeroSavings);
}

// BOILER ANIMATION ON SCROLL
let boilerAnimFrame;
const boilerObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const tempEl = document.getElementById('boiler-temp');
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-boiler');
            
            // Animacja licznika temperatury (10 -> 55)
            if (tempEl) {
                if (boilerAnimFrame) cancelAnimationFrame(boilerAnimFrame);
                let start = null;
                const duration = 4000; // 4s (zgodnie z CSS)
                
                const step = (timestamp) => {
                    if (!start) start = timestamp;
                    const progress = Math.min((timestamp - start) / duration, 1);
                    const ease = 1 - Math.pow(1 - progress, 3);
                    const val = Math.floor(10 + (55 - 10) * ease);
                    tempEl.textContent = val + '°C';
                    
                    // Efekt pary wodnej
                    const visualEl = entry.target; // .stratification-visual
                    if (visualEl) {
                        if (val > 50) {
                            visualEl.classList.add('steaming');
                        } else {
                            visualEl.classList.remove('steaming');
                        }
                    }

                    if (progress < 1) boilerAnimFrame = requestAnimationFrame(step);
                };
                boilerAnimFrame = requestAnimationFrame(step);
            }
        } else {
            entry.target.classList.remove('animate-boiler');
            // Usu? par?, gdy bojler znika z widoku
            entry.target.classList.remove('steaming');
            if (boilerAnimFrame) cancelAnimationFrame(boilerAnimFrame);
            if (tempEl) tempEl.textContent = '10°C';
        }
    });
}, { threshold: 0.9 }); // Uruchom, gdy widoczne w 90%

const boilerVisual = document.querySelector('.stratification-visual');
if (boilerVisual) {
    boilerObserver.observe(boilerVisual);
}

// HERO COUNTERS ANIMATION
function initHeroCounters() {
    const counters = document.querySelectorAll('.js-counter');
    if (counters.length === 0) return;

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const target = parseFloat(el.dataset.target) || 0;
                const prefix = el.dataset.prefix || '';
                const suffix = el.dataset.suffix || '';
                const decimals = (el.dataset.decimals && parseInt(el.dataset.decimals)) || 0;

                // U?ywamy istniej?cej, zaawansowanej funkcji animateValue
                animateValue(el, 0, target, 2000, { prefix, suffix, decimals });

                observer.unobserve(el);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}
initHeroCounters();

// HERO PARTICLES
function initHeroParticles() {
    const container = document.getElementById('hero-particles');
    if (!container) return;

    const particleCount = 50;
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('span');
        const size = Math.random() * 3 + 1; // 1px to 4px
        const duration = Math.random() * 10 + 8; // 8s to 18s
        const delay = Math.random() * 8; // 0s to 8s
        const xStart = Math.random() * 100; // vw
        const xEndDrift = (Math.random() - 0.5) * 20; // -10vw to +10vw

        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${xStart}vw`;
        particle.style.top = '100%'; // Start from the bottom
        particle.style.animationDuration = `${duration}s`;
        particle.style.animationDelay = `${delay}s`;

        particle.style.setProperty('--x-start', `${(Math.random() - 0.5) * 10}vw`);
        particle.style.setProperty('--x-end', `${xEndDrift}vw`);
        particle.style.setProperty('--scale-start', String(Math.random() * 0.5 + 0.5));
        particle.style.setProperty('--scale-end', String(Math.random() * 0.5 + 0.8));

        fragment.appendChild(particle);
    }
    container.appendChild(fragment);
}
initHeroParticles();

// IDEA POPOVER (Zgo pomys)
const ideaBtn = document.getElementById('btn-idea');
const ideaPopover = document.getElementById('idea-popover');
const ideaClose = document.getElementById('idea-close');
const ideaForm = document.getElementById('idea-form');

if (ideaBtn && ideaPopover && ideaClose) {
    const togglePopover = () => {
        ideaPopover.classList.toggle('open');
    };
    const closePopover = () => {
        ideaPopover.classList.remove('open');
    };

    ideaBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Zapobiega natychmiastowemu zamkni?ciu przez document click
        togglePopover();
    });
    ideaClose.addEventListener('click', closePopover);
    
    // Zamknij po klikni?ciu poza formularz
    document.addEventListener('click', (e) => {
        if (ideaPopover.classList.contains('open') && !ideaPopover.contains(e.target) && e.target !== ideaBtn) {
            closePopover();
        }
    });

    if (ideaForm) {
        ideaForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const textarea = ideaForm.querySelector('textarea');
            const text = textarea.value.trim();
            if (!text) return;

            // Generuj prosty hash tekstu, aby wykry? duplikaty
            const hash = Array.from(text).reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0) | 0, 0);
            
            // Sprawdź LocalStorage
            const storageKey = 'sloneczny_ideas_sent';
            let sentHashes = [];
            try { sentHashes = JSON.parse(localStorage.getItem(storageKey)) || []; } catch(err){}

            if (sentHashes.includes(hash)) {
                alert('Ten pomysł już nam zgłosiłeś/aś. Dziękujemy za zaangażowanie!');
                textarea.value = '';
                closePopover();
                return;
            }

            // Poka? status wysy?ania
            const btn = ideaForm.querySelector('button[type="submit"]');
            const originalText = btn.textContent;
            btn.textContent = 'Wysyłanie...';
            btn.disabled = true;

            const nameInput = ideaForm.querySelector('input[type="text"]');
            const emailInput = ideaForm.querySelector('input[type="email"]');

            fetch("https://formsubmit.co/ajax/zbyszekszczesny83@gmail.com", {
                method: "POST",
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    _subject: "💡 Słoneczny Bojler - Zgłoszony Pomysł",
                    message: text,
                    name: nameInput ? (nameInput.value || "Anonim") : "Anonim",
                    email: emailInput ? (emailInput.value || "") : "",
                    _autoresponse: "Dziękujemy za Twój pomysł! Przeanalizujemy go."
                })
            })
            .then(response => {
                if (response.ok) {
                    // Zapisz hash jako wys?any dopiero po sukcesie
                    sentHashes.push(hash);
                    localStorage.setItem(storageKey, JSON.stringify(sentHashes));

                    btn.textContent = '✨ Wysłano! Dziękujemy';
                    btn.style.background = '#16a34a'; // Zielony kolor sukcesu

                    setTimeout(() => {
                        closePopover();
                        setTimeout(() => {
                            ideaForm.reset();
                            btn.textContent = originalText;
                            btn.style.background = '';
                            btn.disabled = false;
                        }, 500);
                    }, 1500);
                } else {
                    throw new Error('Błąd wysyłki');
                }
            })
            .catch(error => {
                alert('Wystąpił błąd podczas wysyłania. Spróbuj później.');
                btn.textContent = originalText;
                btn.disabled = false;
            });
        });
    }
}

// ROI CHART PDF EXPORT
let roiChartInstance = null;

function initROIChart() {
    const ctx = document.getElementById('roiChart');
    if (!ctx) return;

    // Elementy wej?ciowe (suwaki)
    const inputs = {
        cost: document.getElementById('roi-cost'),
        saving: document.getElementById('roi-saving'),
        inflation: document.getElementById('roi-inflation'),
        deposit: document.getElementById('roi-deposit-rate'),
        years: document.getElementById('roi-years')
    };

    // Je?li brak kluczowych element?w, przerwij
    if (!inputs.cost || !inputs.saving || !inputs.years) return;

    // Elementy wy?wietlaj?ce warto?ci suwak?w
    const displays = {
        cost: document.getElementById('roi-cost-val'),
        saving: document.getElementById('roi-saving-val'),
        inflation: document.getElementById('roi-inflation-val'),
        deposit: document.getElementById('roi-deposit-val'),
        years: document.getElementById('roi-years-val')
    };

    // Karty podsumowania i info box
    const summary = {
        payback: document.getElementById('roi-payback-val'),
        gain: document.getElementById('roi-total-gain'),
        gainBadge: document.getElementById('roi-years-badge'),
        vsDeposit: document.getElementById('roi-vs-deposit'),
        irr: document.getElementById('roi-irr'),
        infoPayback: document.getElementById('roi-info-payback'),
        infoYears: document.getElementById('roi-info-years'),
        infoTotal: document.getElementById('roi-info-total')
    };

    // Domy?lne warto?ci do resetu
    const defaults = {
        cost: 3500,
        saving: 1640,
        inflation: 8,
        deposit: 5,
        years: 15
    };

    let currentPaybackYear = null;
    let previousTotalGain = 0; // Przechowuje poprzedni? warto?? dla animacji

    function updateChart() {
        const cost = parseFloat(inputs.cost.value);
        const saving = parseFloat(inputs.saving.value);
        const inflation = parseFloat(inputs.inflation.value) / 100;
        const deposit = parseFloat(inputs.deposit.value) / 100;
        const years = parseInt(inputs.years.value);

        // Aktualizacja wy?wietlanych warto?ci
        if(displays.cost) displays.cost.textContent = cost.toLocaleString('pl-PL') + ' zł';
        if(displays.saving) displays.saving.textContent = saving.toLocaleString('pl-PL') + ' zł';
        if(displays.inflation) displays.inflation.textContent = (inflation * 100).toFixed(1) + '%';
        if(displays.deposit) displays.deposit.textContent = (deposit * 100).toFixed(1) + '%';
        if(displays.years) displays.years.textContent = years + ' lat';
        if(summary.gainBadge) summary.gainBadge.textContent = years;
        if(summary.infoYears) summary.infoYears.textContent = years + ' latach';

        const labels = Array.from({length: years + 1}, (_, i) => i); // Lata 0..N
        
        // 1. Skumulowany zysk z instalacji (Oszcz?dno?ci - Inwestycja)
        // Rok 0: -3500 zł
        // Rok 1: -3500 + Oszcz?dno?? (z uwzgl. wzrostu cen pr?du)
        const dataSolar = [ -cost ];
        
        // 2. Alternatywa: Lokata (Gdyby? nie kupi? bojlera, tylko wp?aci? 3500 na lokat?)
        // Rok 0: 0 (punkt odniesienia - masz got?wk?)
        // Rok 1: 3500 * 5%
// UWAGA: eby porwna "jabka do jabek" na wykresie zysku netto:
        // Lokata to zysk z odsetek od kwoty inwestycji.
        const dataDeposit = [ 0 ];
        
        let cumSolar = -cost;
        let cumDeposit = 0;
        let depositCapital = cost;
        let paybackYear = null;

        for (let i = 1; i <= years; i++) {
            // Wzrost ceny pr?du zwi?ksza oszcz?dno?? w kolejnym roku
            const currentSaving = saving * Math.pow(1 + inflation, i - 1);
            const prevSolar = cumSolar;
            cumSolar += currentSaving;
            dataSolar.push(cumSolar);

            // Obliczanie roku zwrotu (interpolacja)
            if (prevSolar < 0 && cumSolar >= 0 && paybackYear === null) {
                const fraction = -prevSolar / (cumSolar - prevSolar);
                paybackYear = (i - 1) + fraction;
            }

            // Lokata (procent sk?adany)
            const interestCalc = depositCapital * deposit;
            depositCapital += interestCalc;
            cumDeposit += interestCalc;
            dataDeposit.push(cumDeposit);
        }
        currentPaybackYear = paybackYear;

        // Aktualizacja kart podsumowania
        const pbText = paybackYear !== null ? paybackYear.toFixed(1) + ' lata' : '> ' + years + ' lat';
        if(summary.payback) summary.payback.textContent = pbText;
        if(summary.infoPayback) summary.infoPayback.textContent = pbText;

        if(summary.gain) {
            animateValue(summary.gain, previousTotalGain, cumSolar, 800, {
                prefix: cumSolar > 0 ? '+' : '',
                suffix: ' zł',
                formatter: (n) => Math.round(n).toLocaleString('pl-PL').replace(/\u00A0/g, ' ')
            });
        }
        previousTotalGain = cumSolar;

        const diff = cumSolar - cumDeposit;
        const diffText = (diff > 0 ? '+' : '') + Math.round(diff).toLocaleString('pl-PL') + ' zł';
        if(summary.vsDeposit) summary.vsDeposit.textContent = diffText;
        if(summary.infoTotal) summary.infoTotal.textContent = Math.round(Math.abs(diff)).toLocaleString('pl-PL') + ' zł';

        // Uproszczone ROI (roczna stopa zwrotu w 1. roku)
        const simpleRoi = (saving / cost) * 100;
        if(summary.irr) summary.irr.textContent = '~' + simpleRoi.toFixed(1) + '%';

        if (roiChartInstance) {
            roiChartInstance.data.labels = labels;
            roiChartInstance.data.datasets[0].data = dataSolar;
            roiChartInstance.data.datasets[1].data = dataDeposit;
            roiChartInstance.update();
        } else {
            roiChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Słoneczny Bojler (Zysk netto)',
                            data: dataSolar,
                            borderColor: '#16a34a', // Green
                            backgroundColor: 'rgba(22, 163, 74, 0.1)',
                            borderWidth: 3,
                            tension: 0.3,
                            fill: true,
                            pointRadius: 0,
                            pointHoverRadius: 6
                        },
                        {
                            label: 'Lokata bankowa 5% (Zysk)',
                            data: dataDeposit,
                            borderColor: '#F59E0B', // Sun/Orange
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            tension: 0.3,
                            pointRadius: 0,
                            pointHoverRadius: 6
                        }
                    ]
                },
                plugins: [{
                    id: 'breakEvenLine',
                    afterDraw: (chart) => {
                        if (currentPaybackYear === null) return;
                        const ctx = chart.ctx;
                        const xAxis = chart.scales.x;
                        const yAxis = chart.scales.y;
                        
                        // Interpolacja pozycji X dla dok?adnego roku (np. 2.4)
                        const idx = Math.floor(currentPaybackYear);
                        const dec = currentPaybackYear - idx;
                        const x1 = xAxis.getPixelForValue(idx);
                        const x2 = xAxis.getPixelForValue(idx + 1);
                        // Zabezpieczenie na wypadek ko?ca wykresu
                        const x = x1 + (x2 ? (x2 - x1) * dec : 0);

                        if (x < xAxis.left || x > xAxis.right) return;

                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(x, yAxis.top);
                        ctx.lineTo(x, yAxis.bottom);
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = '#16a34a'; // Green
                        ctx.setLineDash([6, 4]); // Przerywana linia
                        ctx.stroke();
                        
                        // Etykieta przy linii
                        ctx.fillStyle = '#16a34a';
                        ctx.textAlign = 'right';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.fillText('ZWROT', x - 6, yAxis.top + 20);
                        ctx.fillText(currentPaybackYear.toFixed(1) + ' lat', x - 6, yAxis.top + 34);
                        ctx.restore();
                    }
                }],
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'top' },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.raw).toLocaleString()} zł`
                            }
                        }
                    },
                    scales: {
                        y: {
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { callback: (val) => val.toLocaleString() + ' zł' }
                        },
                        x: {
                            grid: { display: false },
                            title: { display: true, text: 'Lata' }
                        }
                    }
                }
            });
        }
    }

    // Pod??cz zdarzenia do wszystkich suwak?w
    Object.values(inputs).forEach(el => {
        if(el) el.addEventListener('input', updateChart);
    });

    // Obs?uga przycisku reset ROI
    const resetBtn = document.getElementById('btn-reset-roi');
    if(resetBtn) {
        resetBtn.addEventListener('click', () => {
            if(inputs.cost) inputs.cost.value = defaults.cost;
            if(inputs.saving) inputs.saving.value = defaults.saving;
            if(inputs.inflation) inputs.inflation.value = defaults.inflation;
            if(inputs.deposit) inputs.deposit.value = defaults.deposit;
            if(inputs.years) inputs.years.value = defaults.years;
            updateChart(); // Przelicz wykres
        });
    }

    // Start
    updateChart();
}
// Init chart when script loads (and DOM is ready)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initROIChart);
} else {
    initROIChart();
}

// COMMODITY PRICES (Paliwa)
function updateCommodityPrices() {
    // Parametry energetyczne paliw (kaloryczno?? * sprawno?? kot?a)
    const config = {
        wood:   { kwh: 1450, eff: 0.70, def: 400 }, // def = cena domy?lna
        coal:   { kwh: 7000, eff: 0.80, def: 1600 },
        gas:    { kwh: 10.5, eff: 0.95, def: 3.80 },
        pellet: { kwh: 4900, eff: 0.85, def: 1400 }
    };

    const updateRow = (type) => {
        const row = document.getElementById(`row-${type}`);
        const input = document.getElementById(`input-${type}`);
        if(!row || !input) return;
        
        const price = parseFloat(input.value) || 0;
        const data = config[type];
        
        // Koszt 1 kWh ciep?a = Cena / (Energia * Sprawno??)
        const costPerKwh = price / (data.kwh * data.eff);
        const costGj = costPerKwh * 277.78;

        // Aktualizacja DOM
        const valEl = row.querySelector('.energy-value');
        const barEl = row.querySelector('.energy-bar');
        
        if(valEl) valEl.textContent = `~${costPerKwh.toFixed(2)} zł`;
        
        // Skalowanie paska (wzgl?dem max ceny ok 1.50 zł)
        if(barEl) {
            const pct = Math.min(100, (costPerKwh / 1.50) * 100);
            barEl.style.width = `${pct}%`;
            
            const tip = `Koszt: ${costGj.toFixed(2)} zł / GJ`;
            if(barEl.parentElement) barEl.parentElement.setAttribute('data-tooltip', tip);
        }
    };

    ['wood', 'coal', 'gas', 'pellet'].forEach(type => {
        const input = document.getElementById(`input-${type}`);
        if(input) {
            input.addEventListener('input', () => updateRow(type));
            // Oblicz na starcie
            updateRow(type);
        }
    });

    // Obs?uga przycisku reset
    const resetBtn = document.getElementById('btn-reset-fuel');
    if(resetBtn) {
        resetBtn.addEventListener('click', () => {
            ['wood', 'coal', 'gas', 'pellet'].forEach(type => {
                const input = document.getElementById(`input-${type}`);
                if(input) {
                    input.value = config[type].def;
                    updateRow(type); // Przelicz od nowa
                }
            });
        });
    }
}

// Uruchom aktualizacj? cen przy starcie
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateCommodityPrices);
} else {
    updateCommodityPrices();
}

// PDF EXPORT
document.getElementById('btn-export-pdf')?.addEventListener('click', async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Logo / Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(245, 158, 11); // Sun color
    doc.text("Sloneczny Bojler", 20, 20);
    doc.setFontSize(12);
    doc.setTextColor(60, 60, 60);
    doc.text("Raport Oszczednosci", 20, 30);

    // Dane
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const today = new Date().toLocaleDateString('pl-PL');
    doc.text(`Data: ${today}`, 150, 20);

    let y = 50;
    doc.text("Parametry Twojej symulacji:", 20, y);
    y += 10;
    
    const fields = [
        `Cena prądu: ${document.getElementById('val-price')?.textContent || '-'}`,
        `Osoby w domu: ${document.getElementById('val-persons')?.textContent || '-'}`,
        `Pojemność bojlera: ${document.getElementById('val-volume')?.textContent || '-'}`,
        `Roczna oszczędność: ${document.getElementById('result-saving')?.textContent || '-'}`,
        `Prognozowany wzrost cen prądu: ${document.getElementById('roi-inflation')?.value}%`
    ];

    fields.forEach(line => {
        doc.text(`- ${line}`, 25, y);
        y += 7;
    });

    // Wykres
    const canvas = document.getElementById('roiChart');
    if (canvas) {
        const imgData = canvas.toDataURL('image/png');
        y += 10;
        doc.addImage(imgData, 'PNG', 15, y, 180, 100);
        y += 110;
    }

    // Stopka
    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text("slonecznyboiler.pages.dev | tel: 574 322 909", 105, 280, null, null, "center");

    doc.save("Raport_SlonecznyBojler.pdf");
});

// MOBILE NAVIGATION (HAMBURGER)
const nav = document.querySelector('nav');
const hamburgerBtn = document.getElementById('hamburger-btn');
const navLinksContainer = document.querySelector('.nav-links');

if (hamburgerBtn && nav && navLinksContainer) {
    hamburgerBtn.addEventListener('click', () => {
        nav.classList.toggle('nav-open');
        // Zablokuj przewijanie t?a, gdy menu jest otwarte
        document.body.style.overflow = nav.classList.contains('nav-open') ? 'hidden' : '';
    });

    // Zamknij menu po klikni?ciu w link
    navLinksContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') {
            nav.classList.remove('nav-open');
            document.body.style.overflow = '';
        }
    });
}

// MAGAZYN ENERGII (zakadki + kalkulatory)
(function initEnergyStorageSection() {
    const root = document.getElementById('magazyn-energii');
    if (!root) return;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const toNum = (v, fallback) => {
        const n = typeof v === 'string' ? parseFloat(v) : Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const formatIntPl = (n) => Math.round(n).toLocaleString('pl-PL').replace(/\u00A0/g, ' ');
    const format1Pl = (n) => toNum(n, 0).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/\u00A0/g, ' ');
    const formatKwp = (n) => `${format1Pl(n)} kWp`;
    const formatKw = (n) => `${format1Pl(n)} kW`;
    const formatKwh = (n) => `${format1Pl(n)} kWh`;
    
    let currentBatteryResult = null; // Przechowuje dane do interakcji z wykresem

    const el = {
        tabButtons: root.querySelectorAll('.me-tab-btn'),
        panels: {
            battery: document.getElementById('me-panel-battery'),
            inverter: document.getElementById('me-panel-inverter'),
            pv: document.getElementById('me-panel-pv'),
            guide: document.getElementById('me-panel-guide')
        },
        // Battery
        kwhSlider: document.getElementById('me-sl-kwh'),
        kwhOut: document.getElementById('me-val-kwh'),
        hpCheck: document.getElementById('me-check-hp'), // Checkbox pompy ciep?a
        goalSelect: document.getElementById('me-sel-goal'),
        autonomyWrap: document.getElementById('me-autonomy-wrap'),
        autonomySlider: document.getElementById('me-sl-auto'),
        autonomyOut: document.getElementById('me-val-auto'),
        resCap: document.getElementById('me-res-cap'),
        resUsable: document.getElementById('me-res-usable'),
        resModules: document.getElementById('me-res-modules'),
        resCover: document.getElementById('me-res-cover'),
        battTip: document.getElementById('me-batt-tip'),
        profileSelect: document.getElementById('me-sel-profile'),
        profileDesc:   document.getElementById('me-profile-desc'),
        seasonSelect:  document.getElementById('me-sel-season'),
        barNight:      document.getElementById('me-bar-night'),
        barNightLbl:   document.getElementById('me-bar-night-lbl'),
        barWaste:      document.getElementById('me-bar-waste'),
        barWasteLbl:   document.getElementById('me-bar-waste-lbl'),
        barCover:      document.getElementById('me-bar-cover'),
        barCoverLbl:   document.getElementById('me-bar-cover-lbl'),
        dayCanvas:     document.getElementById('me-chart-day'),
        // Inverter
        pvSlider: document.getElementById('me-sl-pv'),
        pvOut: document.getElementById('me-val-pv'),
        loadSlider: document.getElementById('me-sl-load'),
        loadOut: document.getElementById('me-val-load'),
        invTypeSelect: document.getElementById('me-sel-inv-type'),
        invCards: document.getElementById('me-inv-cards'),
        invTip: document.getElementById('me-inv-tip'),
        // PV
        pvKwpSlider: document.getElementById('me-sl-pvkwp'),
        pvKwpOut: document.getElementById('me-val-pvkwp'),
        panelSelect: document.getElementById('me-sel-panel'),
        orientSelect: document.getElementById('me-sel-orient'),
        tiltSlider: document.getElementById('me-sl-tilt'),
        tiltOut: document.getElementById('me-val-tilt'),
        pvCards: document.getElementById('me-pv-cards'),
        pvTip: document.getElementById('me-pv-tip'),
        prodCanvas: document.getElementById('me-chart-prod')
    };

    const state = {
        annualKwh: toNum(el.kwhSlider?.value, 4500),
        heatPump: el.hpCheck?.checked || false,
        goal: el.goalSelect?.value || 'auto',
        autonomyH: toNum(el.autonomySlider?.value, 8),
        profile: el.profileSelect?.value || 'working',
        season:  el.seasonSelect?.value  || 'annual',
        pvKwp: toNum(el.pvSlider?.value, toNum(el.pvKwpSlider?.value, 5)),
        peakLoadKw: toNum(el.loadSlider?.value, 3),
        invType: el.invTypeSelect?.value || 'hybrid',
        panelW: toNum(el.panelSelect?.value, 450),
        orientPct: toNum(el.orientSelect?.value, 100),
        tiltDeg: toNum(el.tiltSlider?.value, 35)
    };

    function setActiveTab(tabKey) {
        el.tabButtons.forEach((b) => {
            const isActive = b.dataset.tab === tabKey;
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-selected', String(isActive));
            b.tabIndex = isActive ? 0 : -1;
        });
        Object.entries(el.panels).forEach(([key, panel]) => {
            if (!panel) return;
            panel.classList.toggle('active', key === tabKey);
        });

        if (tabKey === 'pv') requestAnimationFrame(() => renderPv());
    }

    function initTabs() {
        el.tabButtons.forEach((btn) => {
            btn.setAttribute('aria-selected', String(btn.classList.contains('active')));
            btn.tabIndex = btn.classList.contains('active') ? 0 : -1;
            btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
        });
    }

// Profil dobowy
    const PROFILE_DATA = {
        working: {
            direct: 0.22,
            desc: 'Dom pusty ok. 7:00-16:00. PV produkuje, ale nikt nie korzysta - bez baterii wiekszosc energii sie marnuje. Wieczor (17-22) to szczyt zuzycia.',
            hourly: [0.20,0.15,0.15,0.15,0.20,0.40,0.85,0.65,0.28,0.22,0.22,0.22,0.28,0.22,0.28,0.60,1.00,1.20,1.10,0.90,0.75,0.55,0.38,0.22]
        },
        mixed: {
            direct: 0.45,
            desc: 'Ktos bywa w domu w ciagu dnia. Czesc energii PV zuzywana od razu, czesc trafia do baterii na wieczor.',
            hourly: [0.20,0.15,0.15,0.15,0.20,0.40,0.75,0.65,0.50,0.50,0.50,0.50,0.55,0.50,0.50,0.65,0.90,1.05,0.95,0.80,0.65,0.50,0.33,0.22]
        },
        home: {
            direct: 0.60,
            desc: 'Zawsze ktos w domu - emeryt, praca zdalna. Duzo energii PV zuzywane bezposrednio. Bateria mniej krytyczna niz przy pustym domu.',
            hourly: [0.20,0.15,0.15,0.15,0.20,0.40,0.65,0.75,0.70,0.65,0.65,0.65,0.75,0.65,0.65,0.75,0.90,0.95,0.85,0.75,0.65,0.50,0.33,0.22]
        }
    };

// Dane sezonowe
    const SEASON_DATA = {
        annual: { pvFactor:0.85, nightMul:1.00, pvHours:10, pvShape:[0,0,0,0,0,0,0.10,0.30,0.55,0.75,0.90,1.00,1.00,0.90,0.75,0.55,0.30,0.10,0,0,0,0,0,0] },
        summer: { pvFactor:1.30, nightMul:0.72, pvHours:14, pvShape:[0,0,0,0,0,0.05,0.20,0.50,0.75,0.90,1.00,1.00,1.00,1.00,0.90,0.75,0.55,0.35,0.15,0.05,0,0,0,0] },
        spring: { pvFactor:0.85, nightMul:0.90, pvHours:11, pvShape:[0,0,0,0,0,0,0.10,0.35,0.60,0.80,0.95,1.00,1.00,0.95,0.80,0.60,0.35,0.10,0,0,0,0,0,0] },
        winter: { pvFactor:0.30, nightMul:1.32, pvHours: 7, pvShape:[0,0,0,0,0,0,0,0.10,0.35,0.65,0.90,1.00,1.00,0.90,0.65,0.35,0.10,0,0,0,0,0,0,0] }
    };

    function calcBattery() {
        let dailyAvg = state.annualKwh / 365;

        // Korekta dla pompy ciep?a (nier?wnomierny rozk?ad roczny)
        if (state.heatPump) {
            if (state.season === 'winter') dailyAvg *= 2.4; // Zim? zu?ycie znacznie wy?sze ni? ?rednia
            else if (state.season === 'spring') dailyAvg *= 1.1;
            else if (state.season === 'summer') dailyAvg *= 0.5; // Latem tylko CWU + ch?odzenie (mniej ni? ?rednia roczna z ogrzewaniem)
        }

        let livePvSeries = null;
        if (state.season === 'live' && solarState && solarState.hourly) {
            // Pobierz dane promieniowania dla dzisiejszej doby (indeksy 24-47 przy past_days=1)
            const todayRad = solarState.hourly.shortwave_radiation.slice(24, 48);
            if (todayRad && todayRad.length === 24) {
                const efficiency = 0.82;
                // Przelicz promieniowanie na kW dla mocy PV wybranej w magazynie (state.pvKwp)
                livePvSeries = todayRad.map(rad => (rad / 1000) * state.pvKwp * efficiency);
            }
        }

        const pData = PROFILE_DATA[state.profile] || PROFILE_DATA.working;
        const sData = SEASON_DATA[state.season]   || SEASON_DATA.annual;

        const nightShare  = clamp(0.55 * sData.nightMul, 0.28, 0.85);
        const nightEnergy = dailyAvg * nightShare;
        const wastedPct   = Math.round((1 - pData.direct) * 100);

        let target;
        if (state.goal === 'backup') {
            target = Math.max(5, (dailyAvg / 24) * state.autonomyH);
        } else {
            target = Math.max(5, nightEnergy / 0.9);
            if (state.season === 'winter') target *= 1.25;
            if (state.season === 'summer') target *= 0.85;
        }

        const cap     = Math.ceil(target / 5) * 5;
        const usable  = cap * 0.9;
        const modules = Math.round(cap / 5);
        const effective = usable * 0.80;
        const cover = nightEnergy > 0 ? clamp((effective / nightEnergy) * 100, 0, 99) : 0;

        return { cap, usable, modules, cover, dailyAvg, nightShare, wastedPct, pData, sData, livePvSeries };
    }

    function drawDailyChart(r, hoverX = null) {
        const canvas = el.dayCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = Math.max(1, canvas.clientWidth);
        const h = Math.max(1, canvas.clientHeight);
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        // Fix for rendering loop issues if size is 0
        if (w === 0 || h === 0) return;
        
        ctx.clearRect(0, 0, w, h);
        const padL = 26, padR = 8, padT = 8, padB = 18;
        const plotW = w - padL - padR;
        const plotH = h - padT - padB;
        if (plotW <= 0 || plotH <= 0) return;

        const loadMax = r.dailyAvg / 13;
        const n = 24;

        let pvSeries;
        if (r.livePvSeries) {
            pvSeries = r.livePvSeries;
        } else {
            const pvMax = r.dailyAvg * r.sData.pvFactor * 0.55;
            pvSeries = r.sData.pvShape.map(function(s) { return pvMax * s; });
        }

        const loadSeries = r.pData.hourly.map(function(s)  { return loadMax * s; });
        const battSeries = loadSeries.map(function(l, i)   { return (i < 6 || i >= 17) ? Math.min(l, r.cap * 0.9 / 12) : 0; });
        const maxVal = Math.max(1, Math.max.apply(null, pvSeries), Math.max.apply(null, loadSeries));
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, padT + plotH);
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();
        var drawArea = function(series, strokeColor, fillColor, dashed) {
            var pts = series.map(function(v, i) {
                return { x: padL + (i / (n-1)) * plotW, y: padT + plotH - (v / maxVal) * plotH };
            });
            ctx.beginPath();
            ctx.setLineDash(dashed ? [4, 3] : []);
            ctx.moveTo(pts[0].x, pts[0].y);
            for (var i = 1; i < pts.length; i++) {
                var mx = (pts[i-1].x + pts[i].x) / 2;
                var my = (pts[i-1].y + pts[i].y) / 2;
                ctx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, mx, my);
            }
            ctx.lineTo(pts[n-1].x, pts[n-1].y);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineTo(pts[n-1].x, padT + plotH);
            ctx.lineTo(pts[0].x, padT + plotH);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
        };
        drawArea(pvSeries,   '#F59E0B', 'rgba(245,158,11,0.18)', false);
        drawArea(loadSeries, '#3b82f6', 'rgba(59,130,246,0.12)', false);
        drawArea(battSeries, '#16a34a', 'rgba(22,163,74,0.22)',  true);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        [0, 6, 12, 18, 23].forEach(function(hr) {
            ctx.fillText(hr + ':00', padL + (hr / (n-1)) * plotW, padT + plotH + 4);
        });

// INTERAKTYWNA LEGENDA (TOOLTIP)
        if (hoverX !== null && hoverX >= padL && hoverX <= padL + plotW) {
            const ratio = (hoverX - padL) / plotW;
            const idx = Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
            
            // Pionowa linia
            const lineX = padL + (idx / (n - 1)) * plotW;
            ctx.beginPath();
            ctx.moveTo(lineX, padT);
            ctx.lineTo(lineX, padT + plotH);
            ctx.strokeStyle = 'rgba(28, 25, 23, 0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Pobranie warto?ci dla danej godziny
            const vPV = pvSeries[idx];
            const vLoad = loadSeries[idx];
            const vBatt = battSeries[idx];

            // Rysowanie pude?ka z legend?
            const tipW = 120;
            const tipH = vBatt > 0.01 ? 75 : 60; // Wy?szy je?li jest bateria
            let tipX = lineX + 10;
            if (tipX + tipW > w) tipX = lineX - tipW - 10;
            const tipY = padT + 5;

            // T?o dymka
            ctx.shadowColor = 'rgba(0,0,0,0.15)';
            ctx.shadowBlur = 8;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
            ctx.fillRect(tipX, tipY, tipW, tipH);
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(tipX, tipY, tipW, tipH);

            // Teksty
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillStyle = '#1C1917';
            ctx.fillText(`Godzina ${String(idx).padStart(2, '0')}:00`, tipX + 10, tipY + 8);

            ctx.font = '10px sans-serif';
            let rowY = tipY + 26;
            const drawRow = (color, label, val) => {
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(tipX + 14, rowY + 4, 3, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#44403C';
                ctx.fillText(`${label}: ${val.toFixed(2)} kW`, tipX + 22, rowY);
                rowY += 15;
            };

            drawRow('#F59E0B', 'PV', vPV);
            drawRow('#3b82f6', 'Zu?ycie', vLoad);
            if (vBatt > 0.01) drawRow('#16a34a', 'Bateria', vBatt);
        }
    }

    function renderBattery() {
        if (el.kwhOut)       el.kwhOut.textContent       = formatIntPl(state.annualKwh) + ' kWh';
        if (el.autonomyOut)  el.autonomyOut.textContent  = formatIntPl(state.autonomyH) + ' h';
        if (el.autonomyWrap) el.autonomyWrap.style.display = state.goal === 'backup' ? 'block' : 'none';

        if (el.profileDesc) {
            var pDataDesc = PROFILE_DATA[state.profile] || PROFILE_DATA.working;
            el.profileDesc.textContent = pDataDesc.desc;
        }

        var r = calcBattery();
        currentBatteryResult = r; // Zapisz dane do interakcji

        if (el.resCap)     el.resCap.textContent     = formatKwh(r.cap);
        if (el.resUsable)  el.resUsable.textContent  = formatKwh(r.usable);
        if (el.resModules) el.resModules.textContent = r.modules + ' szt.';
        if (el.resCover)   el.resCover.textContent   = Math.round(r.cover) + '%';

        var nightPct = Math.round(r.nightShare * 100);
        if (el.barNight)    el.barNight.style.width    = Math.min(100, nightPct * 1.15) + '%';
        if (el.barNightLbl) el.barNightLbl.textContent = nightPct + '%';
        if (el.barWaste)    el.barWaste.style.width    = r.wastedPct + '%';
        if (el.barWasteLbl) el.barWasteLbl.textContent = r.wastedPct + '%';
        if (el.barCover)    el.barCover.style.width    = Math.min(100, r.cover) + '%';
        if (el.barCoverLbl) el.barCoverLbl.textContent = Math.round(r.cover) + '%';

        drawDailyChart(r);

        if (el.battTip) {
            el.battTip.classList.remove('success', 'warning');
            if (state.goal === 'backup') {
                el.battTip.innerHTML = 'Backup: bateria <strong>' + formatKwh(r.cap) + '</strong> zapewni zasilanie przez <strong>' + formatIntPl(state.autonomyH) + ' h</strong>. Policz tez "krytyczne obciazenie" (lodowka, pompy, internet) i dodaj zapas.';
                el.battTip.classList.add('success');
            } else if (state.season === 'winter') {
                el.battTip.innerHTML = 'Zima: tylko ~' + r.sData.pvHours + ' h produkcji PV dziennie, wiecej zuzycia wieczorami. Bateria <strong>' + formatKwh(r.cap) + '</strong> pokryje ok. <strong>' + Math.round(r.cover) + '%</strong> nocy - reszta dobierana z sieci.';
                el.battTip.classList.add('warning');
            } else if (state.season === 'summer' && state.profile === 'working') {
                el.battTip.innerHTML = 'Lato + praca poza domem = <strong>najlepszy scenariusz dla baterii!</strong> PV produkuje ~' + r.sData.pvHours + ' h, dom pusty - bez baterii tracisz <strong>' + r.wastedPct + '%</strong> energii. Bateria laduje sie w dzien i zasila wieczorem.';
                el.battTip.classList.add('success');
            } else if (r.cover >= 80) {
                el.battTip.innerHTML = 'Bateria <strong>' + formatKwh(r.cap) + '</strong> pokryje ok. <strong>' + Math.round(r.cover) + '%</strong> nocnego zuzycia - wysoka autokonsumpcja!';
                el.battTip.classList.add('success');
            } else if (r.cover >= 55) {
                el.battTip.innerHTML = 'Bateria pokryje ok. <strong>' + Math.round(r.cover) + '%</strong> zuzycia wieczorno-nocnego. Przy duzych odbiornikach moze zabraknac energii pod koniec nocy.';
            } else {
                el.battTip.innerHTML = 'Pokrycie nocne: <strong>' + Math.round(r.cover) + '%</strong>. Rozwaz wieksza baterie lub zmniejszenie nocnych odbiornikow.';
                el.battTip.classList.add('warning');
            }
        }
    }
    function pickStep(value, steps) {
        for (const s of steps) if (value <= s) return s;
        return steps[steps.length - 1];
    }

    function renderInverter() {
        if (el.pvOut) el.pvOut.textContent = formatKwp(state.pvKwp);
        if (el.loadOut) el.loadOut.textContent = formatKw(state.peakLoadKw);

        if (!el.invCards || !el.invTip) return;

        const steps = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
        const base = Math.max(state.pvKwp, state.peakLoadKw);

        let target = base;
        let tip = 'Dobierz falownik do mocy PV i szczytowego obciążenia.';

        if (state.invType === 'hybrid') {
            target = Math.max(base, 5);
            target = Math.min(target, 12);
            tip = 'Hybrydowy: zwykle minimum 5 kW, a moc dobiera się do PV i obciążenia.';
        } else if (state.invType === 'ongrid') {
            target = Math.max(state.pvKwp * 0.9, 2);
            tip = 'On-grid: falownik dobiera się głównie do mocy PV (często DC/AC ~1.0-1.2).';
        } else {
            target = Math.max(state.peakLoadKw * 1.3, 2);
            tip = 'Off-grid: dolicz zapas na rozruch (silniki, pompy, sprężarki) i ograniczenia mocy chwilowej.';
        }

        const recommended = pickStep(target, steps);
        const minimum = pickStep(target * 0.75, steps);
        const reserve = pickStep(target * 1.25, steps);

        const options = Array.from(new Set([minimum, recommended, reserve])).sort((a, b) => a - b);
        const normalized = (opts) => {
            if (opts.length === 3) return opts;
            if (opts.length === 2) return [opts[0], opts[0], opts[1]];
            return [opts[0], opts[0], opts[0]];
        };
        const [optMin, optRec, optMax] = normalized(options);

        const card = (kw, label, isRecommended) => `
            <div class="me-inv-card${isRecommended ? ' recommended' : ''}">
                ${isRecommended ? '<div class="me-inv-badge">REKOMENDOWANY</div>' : ''}
                <div class="me-inv-kw">${formatIntPl(kw)} kW</div>
                <div class="me-inv-label">${label}</div>
            </div>
        `;

        el.invCards.innerHTML = [
            card(optMin, 'Minimalny', optMin === optRec && optMin === optMax),
            card(optRec, 'Rekomendowany', true),
            card(optMax, 'Z zapasem', false)
        ].join('');

        el.invTip.textContent = tip;
        el.invTip.classList.remove('success', 'warning');
        el.invTip.classList.add('success');
    }

    function getTiltFactor(tiltDeg) {
        const diff = Math.abs(tiltDeg - 35);
        const penalty = Math.min(0.15, (diff / 25) * 0.15);
        return 1 - penalty;
    }

    function drawProdChart(canvas, seriesA, seriesB) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, width, height);

        const padL = 26;
        const padR = 10;
        const padT = 10;
        const padB = 22;

        const plotW = width - padL - padR;
        const plotH = height - padT - padB;
        if (plotW <= 0 || plotH <= 0) return;

        const maxVal = Math.max(1, ...seriesA, ...seriesB);
        const months = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, padT + plotH);
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();

        const groupW = plotW / 12;
        const barW = Math.max(6, groupW * 0.26);
        const gap = Math.max(3, groupW * 0.10);

        for (let i = 0; i < 12; i++) {
            const x0 = padL + i * groupW + (groupW - (barW * 2 + gap)) / 2;

            const hA = (seriesA[i] / maxVal) * plotH;
            const hB = (seriesB[i] / maxVal) * plotH;

            ctx.fillStyle = '#F59E0B';
            ctx.fillRect(x0, padT + plotH - hA, barW, hA);

            ctx.fillStyle = '#D1CAC0';
            ctx.fillRect(x0 + barW + gap, padT + plotH - hB, barW, hB);

            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(months[i], padL + i * groupW + groupW / 2, padT + plotH + 6);
        }
    }

    function renderPv() {
        if (el.pvKwpOut) el.pvKwpOut.textContent = formatKwp(state.pvKwp);
        if (el.tiltOut) el.tiltOut.textContent = `${formatIntPl(state.tiltDeg)}°`;

        if (!el.pvCards || !el.pvTip) return;

        const baseYieldPerKwp = 1000; // Łomża ~950-1050 kWh/kWp/rok
        const tiltFactor = getTiltFactor(state.tiltDeg);
        const orientFactor = clamp(state.orientPct / 100, 0.4, 1.0);

        const annualProd = state.pvKwp * baseYieldPerKwp * orientFactor * tiltFactor;
        const annualNorth = state.pvKwp * baseYieldPerKwp * 0.65 * tiltFactor;

        const panelsCount = Math.ceil((state.pvKwp * 1000) / state.panelW);
        const actualKwp = (panelsCount * state.panelW) / 1000;

        const suggestedPv = Math.ceil(((state.annualKwh / 1000) * 1.2) * 2) / 2; // skok co 0.5 kWp

        el.pvCards.innerHTML = `
            <div class="me-pv-card">
                <div class="me-pv-card-val">${formatIntPl(panelsCount)} szt.</div>
                <div class="me-pv-card-label">Panele ${formatIntPl(state.panelW)}W (~${format1Pl(actualKwp)} kWp)</div>
            </div>
            <div class="me-pv-card">
                <div class="me-pv-card-val">~${formatIntPl(annualProd)} kWh</div>
                <div class="me-pv-card-label">Szacowana produkcja roczna</div>
            </div>
            <div class="me-pv-card">
                <div class="me-pv-card-val">${format1Pl(suggestedPv)} kWp</div>
                <div class="me-pv-card-label">Sugerowana moc dla ${formatIntPl(state.annualKwh)} kWh/rok</div>
            </div>
        `;

        el.pvTip.classList.remove('success', 'warning');
        if (state.pvKwp < suggestedPv * 0.8) {
            el.pvTip.textContent = `⚠️ Dla zużycia ${formatIntPl(state.annualKwh)} kWh sugerowana moc PV to ok. ${format1Pl(suggestedPv)} kWp (z zapasem na ładowanie baterii i straty).`;
            el.pvTip.classList.add('warning');
        } else {
            el.pvTip.textContent = `✅ Parametry wyglądają dobrze. Szacowana produkcja: ~${formatIntPl(annualProd)} kWh/rok (orientacja ${formatIntPl(state.orientPct)}%, kąt ${formatIntPl(state.tiltDeg)}°).`;
            el.pvTip.classList.add('success');
        }

        const monthShare = [0.03, 0.05, 0.08, 0.11, 0.13, 0.14, 0.14, 0.12, 0.09, 0.06, 0.03, 0.02];
        const monthlyA = monthShare.map((s) => (annualProd * s));
        const monthlyB = monthShare.map((s) => (annualNorth * s));
        drawProdChart(el.prodCanvas, monthlyA, monthlyB);
    }

    function syncPvValue(newValue) {
        state.pvKwp = clamp(newValue, 1, 20);
        if (el.pvSlider) el.pvSlider.value = String(state.pvKwp);
        if (el.pvKwpSlider) el.pvKwpSlider.value = String(state.pvKwp);
    }

    function bindEvents() {
        window.addEventListener('solarDataLoaded', () => {
            if (state.season === 'live') renderBattery();
        });

        if (el.dayCanvas) {
            el.dayCanvas.addEventListener('mousemove', (e) => {
                if (!currentBatteryResult) return;
                const rect = el.dayCanvas.getBoundingClientRect();
                drawDailyChart(currentBatteryResult, e.clientX - rect.left);
            });
            el.dayCanvas.addEventListener('mouseleave', () => {
                if (!currentBatteryResult) return;
                drawDailyChart(currentBatteryResult, null);
            });
        }

        if (el.kwhSlider) {
            el.kwhSlider.addEventListener('input', () => {
                state.annualKwh = toNum(el.kwhSlider.value, state.annualKwh);
                renderBattery();
                renderPv();
            });
        }

        if (el.hpCheck) {
            el.hpCheck.addEventListener('change', () => {
                state.heatPump = el.hpCheck.checked;
                renderBattery();
            });
        }

        if (el.goalSelect) {
            el.goalSelect.addEventListener('change', () => {
                state.goal = el.goalSelect.value;
                renderBattery();
            });
        }

        if (el.autonomySlider) {
            el.autonomySlider.addEventListener('input', () => {
                state.autonomyH = toNum(el.autonomySlider.value, state.autonomyH);
                renderBattery();
            });
        }

        if (el.profileSelect) {
            el.profileSelect.addEventListener('change', () => {
                state.profile = el.profileSelect.value;
                renderBattery();
            });
        }

        if (el.seasonSelect) {
            el.seasonSelect.addEventListener('change', () => {
                state.season = el.seasonSelect.value;
                renderBattery();
            });
        }

        if (el.pvSlider) {
            el.pvSlider.addEventListener('input', () => {
                syncPvValue(toNum(el.pvSlider.value, state.pvKwp));
                renderInverter();
                renderPv();
            });
        }

        if (el.pvKwpSlider) {
            el.pvKwpSlider.addEventListener('input', () => {
                syncPvValue(toNum(el.pvKwpSlider.value, state.pvKwp));
                renderInverter();
                renderPv();
            });
        }

        if (el.loadSlider) {
            el.loadSlider.addEventListener('input', () => {
                state.peakLoadKw = toNum(el.loadSlider.value, state.peakLoadKw);
                renderInverter();
            });
        }

        if (el.invTypeSelect) {
            el.invTypeSelect.addEventListener('change', () => {
                state.invType = el.invTypeSelect.value;
                renderInverter();
            });
        }

        if (el.panelSelect) {
            el.panelSelect.addEventListener('change', () => {
                state.panelW = toNum(el.panelSelect.value, state.panelW);
                renderPv();
            });
        }

        if (el.orientSelect) {
            el.orientSelect.addEventListener('change', () => {
                state.orientPct = toNum(el.orientSelect.value, state.orientPct);
                renderPv();
            });
        }

        if (el.tiltSlider) {
            el.tiltSlider.addEventListener('input', () => {
                state.tiltDeg = toNum(el.tiltSlider.value, state.tiltDeg);
                renderPv();
            });
        }

        let resizeRaf = null;
        window.addEventListener('resize', () => {
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                renderPv();
                renderBattery(); // Przerysuj te? wykres baterii po zmianie rozmiaru
            });
        });
    }

    initTabs();
    // Upewnij si?, ?e oba suwaki PV startuj? z tej samej warto?ci
    syncPvValue(state.pvKwp);

    bindEvents();
    renderBattery();
    renderInverter();
    renderPv();
})();

// BLOG TAG FILTERING
const filtersContainer = document.querySelector('.blog-filters');
const blogCards = document.querySelectorAll('.blog-card[data-tags]');

if (filtersContainer && blogCards.length > 0) {
    filtersContainer.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;

        // Update active button
        filtersContainer.querySelector('.active')?.classList.remove('active');
        e.target.classList.add('active');

        const filter = e.target.getAttribute('data-filter');

        blogCards.forEach(card => {
            const tags = card.getAttribute('data-tags');
            if (filter === 'all' || tags.includes(filter)) {
                card.classList.remove('hidden');
            } else {
                card.classList.add('hidden');
            }
        });
    });
}

// SHOOTING STAR LOGIC
function scheduleShootingStar() {
    const hero = document.querySelector('.hero');
    const star = document.getElementById('shooting-star');
    
    if (hero && star && hero.classList.contains('is-night')) {
        // Losowa pozycja startowa (g?rna prawa ?wiartka)
        star.style.top = (Math.random() * 40) + '%';
        star.style.right = (Math.random() * 40) + '%';
        
        star.classList.remove('animate');
        void star.offsetWidth; // Trigger reflow
        star.classList.add('animate');
    }
    setTimeout(scheduleShootingStar, Math.random() * 15000 + 10000); // Co 10-25s
}
setTimeout(scheduleShootingStar, 5000);

// IMAGE LIGHTBOX
function initImageLightbox() {
    const items = document.querySelectorAll('.js-lightbox-item');
    if (!items.length) return;

    if (!document.getElementById('image-lightbox')) {
        const lightbox = document.createElement('div');
        lightbox.id = 'image-lightbox';
        lightbox.className = 'image-lightbox';
        lightbox.innerHTML = `
            <button type="button" class="image-lightbox-close" aria-label="Zamknij podgląd">&times;</button>
            <button type="button" class="image-lightbox-nav prev" aria-label="Poprzednie zdjęcie">&#10094;</button>
            <button type="button" class="image-lightbox-nav next" aria-label="Następne zdjęcie">&#10095;</button>
            <div class="image-lightbox-inner">
                <img class="image-lightbox-img" src="" alt="">
                <div class="image-lightbox-caption"></div>
            </div>
        `;
        document.body.appendChild(lightbox);
    }

    const lightboxEl = document.getElementById('image-lightbox');
    const lightboxImg = lightboxEl.querySelector('.image-lightbox-img');
    const lightboxCaption = lightboxEl.querySelector('.image-lightbox-caption');
    const lightboxClose = lightboxEl.querySelector('.image-lightbox-close');
    const prevBtn = lightboxEl.querySelector('.image-lightbox-nav.prev');
    const nextBtn = lightboxEl.querySelector('.image-lightbox-nav.next');
    const images = Array.from(items);
    let currentIndex = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let prevOverflow = '';

    const showByIndex = (index) => {
        if (!images.length) return;
        if (index < 0) index = images.length - 1;
        if (index >= images.length) index = 0;
        currentIndex = index;
        const imgEl = images[currentIndex];
        lightboxImg.src = imgEl.currentSrc || imgEl.src;
        lightboxImg.alt = imgEl.alt || '';
        lightboxCaption.textContent = imgEl.getAttribute('data-caption') || imgEl.alt || '';
    };

    const openLightbox = (imgEl) => {
        const foundIndex = images.indexOf(imgEl);
        currentIndex = foundIndex >= 0 ? foundIndex : 0;
        showByIndex(currentIndex);
        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        lightboxEl.classList.add('open');
    };

    const closeLightbox = () => {
        lightboxEl.classList.remove('open');
        lightboxImg.src = '';
        document.body.style.overflow = prevOverflow;
    };

    const showPrev = () => showByIndex(currentIndex - 1);
    const showNext = () => showByIndex(currentIndex + 1);

    items.forEach((imgEl) => {
        imgEl.addEventListener('click', () => openLightbox(imgEl));
    });

    lightboxClose.addEventListener('click', closeLightbox);
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showPrev();
    });
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showNext();
    });
    lightboxEl.addEventListener('click', (e) => {
        if (e.target === lightboxEl) closeLightbox();
    });
    lightboxEl.addEventListener('touchstart', (e) => {
        if (!lightboxEl.classList.contains('open')) return;
        const t = e.changedTouches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
    }, { passive: true });
    lightboxEl.addEventListener('touchend', (e) => {
        if (!lightboxEl.classList.contains('open')) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) showNext();
            else showPrev();
        }
    }, { passive: true });
    document.addEventListener('keydown', (e) => {
        if (!lightboxEl.classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') showPrev();
        if (e.key === 'ArrowRight') showNext();
    });
}
initImageLightbox();
