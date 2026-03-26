// ── CALCULATOR ───────────────────────────────────────
// ── 1. Definicja inputs (sprawdź czy ID zgadzają się z HTML!) ──
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
};
const calcModeEl = document.getElementById('select-calc-mode');
const CALC_STORAGE_KEY = 'solarBoilerCalcStateV1';
let isRestoringCalculatorState = false;

// ── 2. Sprawdź czy wszystkie elementy istnieją ──────
// (jeśli któryś zwróci null w konsoli — masz błąd ID w HTML)

// ── State for animations & Helpers ────────────────
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
                panelsCount: inputs.panelsCount.el
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

// ── HEATER MANAGEMENT ───────────────────────────────
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
    // Dodaj nową grzałkę (domyślnie 3kW)
    const defaultPower = 3.0;
    animationState.heaters.push(defaultPower);
    renderHeaters();
    calcUpdate();
});

// ── Globalne przyciski − / + dla statycznych suwaków ──
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
    // Zaokrągl do precyzji stepu
    const precision = (step.toString().split('.')[1] || '').length;
    slider.value = newVal.toFixed(precision);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
});

// ── 3. Funkcja obliczeniowa ─────────────────────────
function calcUpdate() {
    // Bezpieczne odczytanie — jeśli element nie istnieje, użyj domyślnej wartości
    const vol     = inputs.volume.el  ? +inputs.volume.el.value  : 180;
    
    // Sumuj moc wszystkich grzałek
    const heaterPower = animationState.heaters.reduce((sum, val) => sum + val, 0);
    
    // Aktualizuj etykietę sumy
    const totalLabel = document.getElementById('val-heater-total');
    if (totalLabel) totalLabel.textContent = heaterPower.toFixed(1) + ' kW';

    const persons = inputs.persons.el ? +inputs.persons.el.value : 4;
    const price   = inputs.price.el   ? +inputs.price.el.value   : 1.10;
    const sunny   = inputs.sunny.el   ? +inputs.sunny.el.value   : 180;
    const tilt    = inputs.tilt.el    ? +inputs.tilt.el.value    : 35;
    const orient  = inputs.orient.el  ? +inputs.orient.el.value  : 1.0;
    const panelPower = inputs.panelPower.el ? +inputs.panelPower.el.value : 450;
    const panelsCount = inputs.panelsCount.el ? +inputs.panelsCount.el.value : 7;

    // Energia do podgrzania wody: Q = m × c × ΔT / 3600
    // ~50L/os/dzień, ΔT = 35°C, c = 4.186 kJ/(kg·K)
    const litersPerDay    = persons * 50;
    const kwhUsagePerDay  = (litersPerDay * 4.186 * 35) / 3600;

    // Straty postojowe: ~0.8 kWh / 100L / dobę
    const standbyPerDay   = (vol / 100) * 0.8;

    const totalPerDay     = kwhUsagePerDay + standbyPerDay;
    const totalPerYear    = totalPerDay * 365;
    const costPerYear     = totalPerYear * price;

    // Współczynnik wydajności w zależności od kąta nachylenia (uproszczony model dla Polski)
    // Optimum ~35 stopni (1.0). Płasko (0) ~0.85. Pionowo (90) ~0.7.
    let tiltEff = 1.0;
    if (tilt < 30) tiltEff = 0.85 + (tilt / 30) * 0.15; // Wzrost od 0.85 do 1.0
    else if (tilt > 45) tiltEff = 1.0 - ((tilt - 45) / 45) * 0.3; // Spadek od 1.0 do 0.7
    // (Pomiędzy 30 a 45 uznajemy za optimum = 1.0)

    // Aktualizacja wizualizacji kąta nachylenia (SVG)
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

    // Pokrycie słoneczne: większy bojler = lepszy akumulator
    const volumeFactor    = 0.78 + Math.min(0.17, (vol - 50) / 1500);
    const tempEffLive     = getTemperatureEfficiencyFactor(weatherState.temperatureC, weatherState.radiationWm2);
    const calcMode        = calcModeEl ? calcModeEl.value : 'live';
    const tempEff         = calcMode === 'standard' ? 1 : tempEffLive;

    // Logika uwzględniająca liczbę paneli:
    const totalPowerKW = (panelsCount * panelPower) / 1000;
    // Szacowana produkcja w słoneczny dzień (kWh) uwzględniająca warunki montażowe
    const productionPotential = totalPowerKW * 4.2 * tiltEff * orient * tempEff;
    // Czy moc paneli wystarcza na zagrzanie wody w ciągu dnia?
    const powerFactor = Math.min(1, productionPotential / totalPerDay);
    const solarCoverage = (sunny / 365) * volumeFactor * powerFactor;

    const saving          = costPerYear * solarCoverage;

    const investmentCost  = 3200;
    const paybackYears    = saving > 0 ? investmentCost / saving : 0;

    // ── Aktualizacja DOM (z null-check) ──────────────
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
    
    // ── Globalna aktualizacja ceny prądu i wyliczeń zależnych ──
    const priceFmt = price.toFixed(2).replace('.', ',');

    // 1. Hero Section
    const heroPriceEl = document.getElementById('hero-price-val');
    if (heroPriceEl) heroPriceEl.textContent = priceFmt + ' zł/kWh';

    // 2. Banner w kalkulatorze
    const bannerPriceEl = document.getElementById('banner-price-val');
    if (bannerPriceEl) bannerPriceEl.textContent = priceFmt + ' zł/kWh brutto';

    // 3. Nagłówek sekcji Porównanie
    const cmpSubtitlePrice = document.getElementById('cmp-subtitle-price');
    if (cmpSubtitlePrice) cmpSubtitlePrice.textContent = priceFmt + ' zł/kWh';

    // 4. Wykres źródeł energii (pasek prądu)
    const energyPriceElec = document.getElementById('energy-price-electric');
    if (energyPriceElec) energyPriceElec.textContent = priceFmt + ' zł';
    
    const energyBarElec = document.getElementById('energy-bar-electric');
    if (energyBarElec) {
        // Skalowanie paska: 1.50 zł = 100% (zwiększona skala bo ceny surowców mogą być wysokie)
        const widthPct = Math.min(100, (price / 1.50) * 100);
        energyBarElec.style.width = widthPct + '%';
        
        // Tooltip GJ (1 GJ = 277.78 kWh)
        const costGj = price * 277.78;
        const tip = `Koszt: ${costGj.toFixed(2)} zł / GJ`;
        if(energyBarElec.parentElement) energyBarElec.parentElement.setAttribute('data-tooltip', tip);
    }

    // 5. Tabela Porównawcza (Symulacja 10 lat)
    // Koszt roczny sieci = costPerYear (wyliczone wyżej w kalkulatorze)
    const costNetwork10y = costPerYear * 10;
    
    // Koszt roczny solarny = Koszt sieci - Oszczędność
    const costSolarYear = Math.max(0, costPerYear - saving);
    const investConst = 3500; // Stały koszt inwestycji do symulacji w tabeli
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

    // ── Aktualizacja sekcji "Przykład obliczeniowy" ──
    // Obliczamy energię potrzebną do podgrzania wody o 45 stopni (10 -> 55)
    // Wzór: Litry * 4.186 * DeltaT / 3600 = kWh
    const exEnergy = (vol * 4.186 * 45) / 3600;
    const exCost   = exEnergy * price;

    const exTitle = document.getElementById('ex-title');
    if (exTitle) exTitle.textContent = `Przykład: Ile kosztuje jednorazowe podgrzanie bojlera ${vol}L?`;

    const exDesc = document.getElementById('ex-desc');
    if (exDesc) exDesc.innerHTML = `Aby podgrzać ${vol} litrów wody od 10°C do 55°C, potrzeba <strong>~${exEnergy.toFixed(1)} kWh</strong> energii. Zobacz, ile to kosztuje:`;

    const exSourceElec = document.getElementById('ex-source-elec');
    if (exSourceElec) exSourceElec.textContent = `⚡ Prąd z sieci (${price.toFixed(2)} zł/kWh):`;

    const exCostElec = document.getElementById('ex-cost-elec');
    if (exCostElec) {
        animateValue(exCostElec, animationState.previousExCost, exCost, 600, { prefix: '~', suffix: ' zł', decimals: 2 });
    }
    animationState.previousExCost = exCost; // Zapisz wartość na następny raz

    // ── Nowe obliczenia: Czas i Wydajność ──

    // Rekomendacja mocy grzałki (np. 1kW na 60L dla optymalnego czasu)
    const recPower = (vol / 60).toFixed(1);
    const recEl = document.getElementById('rec-heater');
    if (recEl) recEl.textContent = `${recPower} kW`;

    // Rekomendowana ilość paneli (dla ZALECANEJ mocy grzałki - zależnej od pojemności)
    // Używamy parseFloat(recPower), aby rekomendacja paneli była spójna z rekomendacją grzałki powyżej
    const panelsCountCalc = Math.ceil((parseFloat(recPower) * 1000) / panelPower);
    const recPanelsCalcEl = document.getElementById('rec-panels-calc');
    if (recPanelsCalcEl) recPanelsCalcEl.textContent = `${panelsCountCalc} szt. (${panelPower}W)`;

    // Walidacja mocy grzałki (Ostrzeżenie w kalkulatorze)
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
    
    // 1. Czas nagrzewania (dla wybranej mocy grzałki)
    const timeHoursTotal = exEnergy / heaterPower;
    const timeH = Math.floor(timeHoursTotal);
    const timeM = Math.round((timeHoursTotal - timeH) * 60);
    
    const exTime = document.getElementById('ex-time');
    if (exTime) exTime.textContent = `${timeH}h ${timeM}min`;

    // 1b. Sugerowana ilość paneli
    const panelsNeeded = Math.ceil((heaterPower * 1000) / panelPower);
    const exPanels = document.getElementById('ex-panels');
    if (exPanels) exPanels.textContent = `${panelsNeeded} szt. (${panelPower}W)`;

    // 1c. Info o dużej mocy (zielony komunikat)
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

    // 2. Ilość pryszniców (uwzględniamy orientację bojlera)
    const isVertical = animationState.boilerOrientation === 'vertical';
    const usableVolumeFactor = isVertical ? 0.90 : 0.65; // 90% dla pionowego, 65% dla poziomego
    const usableVolume = vol * usableVolumeFactor;
    const showersCount = Math.floor(usableVolume / 40);
    const exShowers = document.getElementById('ex-showers');
    if (exShowers) exShowers.textContent = `ok. ${showersCount} osób`;

    // 3. Kontekst użycia (Osoby vs Pojemność)
    const dailyNeed = persons * 50;
    const cyclesVal = dailyNeed / vol;
    const cycles    = cyclesVal.toFixed(1);
    
    const exUsageNote = document.getElementById('ex-usage-note');
    if (exUsageNote) {
        exUsageNote.className = 'example-usage-note'; // Reset klasy
        let noteHTML = '';
        if (cyclesVal > 2.0) {
            exUsageNote.classList.add('warning');
            noteHTML = `⚠️ <strong>Uwaga: Bojler może być za mały!</strong><br>Dla ${persons} osób potrzeba ok. ${dailyNeed}L wody. Przy tej pojemności trzeba ją grzać aż <strong>${cycles} razy</strong> na dobę.`;
        } else {
            noteHTML = `Dla <strong>${persons} osób</strong> potrzeba ok. <strong>${dailyNeed}L</strong> ciepłej wody na dobę. `;
            if (dailyNeed <= vol) {
                noteHTML += `Pojemność bojlera <strong>(${vol}L)</strong> jest wystarczająca na cały dzień bez dogrzewania.`;
            } else {
                noteHTML += `Przy pojemności <strong>${vol}L</strong> woda musi zostać podgrzana (wymieniona) ok. <strong>${cycles} razy</strong> w ciągu doby.`;
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

    const stratInfoEl = document.getElementById('stratification-info');
    if (stratInfoEl) {
        if (isVertical) {
            stratInfoEl.innerHTML = `<strong>Ważna uwaga o warstwach (stratyfikacji):</strong> W pionowym bojlerze woda naturalnie układa się warstwami — najcieplejsza gromadzi się na górze. Dzięki temu masz dostęp do gorącej wody, nawet gdy słońce ogrzało tylko górną część zbiornika. Pełne "naładowanie" całego bojlera nie jest konieczne do komfortowego użytkowania.`;
            stratInfoEl.style.color = '';
            stratInfoEl.style.background = '';
            stratInfoEl.style.padding = '';
            stratInfoEl.style.borderRadius = '';
            stratInfoEl.style.border = '';
        } else { // Horizontal
            if (vol <= 60) {
                stratInfoEl.innerHTML = `⚠️ <strong>KRYTYCZNA UWAGA:</strong> Poziomy bojler o tak małej pojemności (<strong>${vol}L</strong>) jest <strong>bardzo nieefektywny</strong>. Mieszanie się wody sprawi, że ilość dostępnej gorącej wody będzie znikoma (realnie ${Math.round(usableVolume)}L). Zdecydowanie zalecany jest bojler pionowy.`;
                stratInfoEl.style.color = '#b91c1c';
                stratInfoEl.style.background = 'rgba(239, 68, 68, 0.1)';
                stratInfoEl.style.padding = '12px';
                stratInfoEl.style.borderRadius = '8px';
                stratInfoEl.style.border = '1px solid rgba(239, 68, 68, 0.2)';
            } else {
                stratInfoEl.innerHTML = `<strong>Uwaga dla bojlera poziomego:</strong> W takim bojlerze zjawisko stratyfikacji (układania warstw) jest znacznie słabsze. Ciepła woda szybciej miesza się z zimną przy poborze, co <strong>zmniejsza ilość dostępnej "użytkowej" gorącej wody</strong>. Efektywna pojemność jest niższa niż w bojlerze pionowym o tym samym litrażu.`;
                stratInfoEl.style.color = '';
                stratInfoEl.style.background = '';
                stratInfoEl.style.padding = '';
                stratInfoEl.style.borderRadius = '';
                stratInfoEl.style.border = '';
            }
        }
    }

    // -- Update Recommended Set Box --
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

// ── 4. Eventy na suwakach ───────────────────────────
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
            obj.out.textContent = (key === 'price')
                ? val.toFixed(2) + obj.unit
                : val + obj.unit;
        }
        calcUpdate();
    });

    // Inicjalne ustawienie etykiety
    if (obj.out && obj.el.value !== undefined) {
        const val = parseFloat(obj.el.value);
        obj.out.textContent = (key === 'price')
            ? val.toFixed(2) + obj.unit
            : val + obj.unit;
    }
});

// Animacja chlupotania wody przy zmianie pojemności
const volumeSlider = document.getElementById('range-volume');
if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
        const waterEl = document.querySelector('.hot-water');
        if (waterEl) {
            waterEl.classList.remove('sloshing');
            void waterEl.offsetWidth; // Trigger reflow (restart animacji)
            waterEl.classList.add('sloshing');
            
            // Usuń klasę po zakończeniu animacji (0.6s w CSS)
            setTimeout(() => {
                waterEl.classList.remove('sloshing');
            }, 600);
        }
    });
}

// ── MODE SWITCH LOGIC ───────────────────────────────
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
            volSlider.value = 1000; // Domyślnie 1000L
            
            // Domyślne grzałki dla bufora (zgodnie z prośbą: 3kW + 4kW)
            animationState.heaters = [3.0, 4.0];
            
            // Zaktualizuj etykietę
            document.querySelector('label[for="range-volume"]').innerHTML = 'Pojemność bufora <span id="val-volume">1000 L</span>';
            inputs.volume.out = document.getElementById('val-volume'); // Re-bind output

        } else {
            // Ustawienia dla Bojlera
            volSlider.max = 300;
            volSlider.step = 10;
            volSlider.value = 180;
            
            // Domyślna grzałka dla bojlera
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

// Obsługa opcji "Bojler z wężownicą"
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

// ── 5. ★ KLUCZOWE: wywołaj przy starcie ─────────────
renderHeaters(); // Inicjalizacja grzałek
if (!restoreCalculatorState()) {
    calcUpdate();
}

// ── Przycisk automatycznego doboru ───────────────────
const autoSetBtn = document.getElementById('btn-auto-set');
if (autoSetBtn) {
    autoSetBtn.addEventListener('click', () => {
        // Optymalne wartości dla 4-osobowej rodziny
        const optimalValues = {
            persons: 4,
            volume: 200,
            tilt: 35,
            orient: "1.0",
            panelPower: 450,
        };
        
        // TODO: Reset mode to boiler if needed, or handle buffer auto-set

        // Ustaw wartości i wywołaj zdarzenie 'input' dla każdego suwaka/selecta
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

// ── FORM ─────────────────────────────────────────────
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
        
        const phoneVal = phoneInput ? phoneInput.value.replace(/\D/g, '') : ''; // Usuwa wszystko co nie jest cyfrą

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
                // Ukryj formularz i pokaż podziękowanie
                const originalChildren = Array.from(this.children);
                originalChildren.forEach(child => child.style.display = 'none');
                
                // Ukryj status pod formularzem jeśli istnieje
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

// ── FAQ ───────────────────────────────────────────────
document.querySelectorAll('.faq-item').forEach(item => {
    item.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
    });
});

// ── SMOOTH SCROLL ─────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
        e.preventDefault();
        const target = document.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
});

// ── ANIMATION ON SCROLL ───────────────────────────────
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

// ── BACK TO TOP ───────────────────────────────────────
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

// ── SECTION BACKGROUND DIMMER ─────────────────────────
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

    // Target BG color: Ciepły szary (przyjemny dla oka "papier")
    const targetColor = [200, 196, 188]; 

    // Interpolacja kolorów (linear interpolation)
    const lerp = (start, end, t) => Math.round(start + (end - start) * t);
    const setRgb = (el, r, g, b) => el.style.color = `rgb(${r},${g},${b})`;

    bgDimmer.addEventListener('input', (e) => {
        const val = e.target.value;
        const factor = e.target.value / 100; // 0 to 1
        
        if(dimmerLabel) dimmerLabel.textContent = `${val}%`;

        dimTargets.forEach(el => {
            const start = originals.get(el);
            if (!start) return;

            // Tło
            const r = lerp(start[0], targetColor[0], factor);
            const g = lerp(start[1], targetColor[1], factor);
            const b = lerp(start[2], targetColor[2], factor);

            el.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            
            // Funkcja pomocnicza do zmiany koloru tekstu
            const updateColor = (selector, rStart, gStart, bStart, rEnd, gEnd, bEnd) => {
                const items = el.querySelectorAll(selector);
                items.forEach(item => {
                    // Pomiń elementy wewnątrz widgetu solarnego (on ma zawsze ciemne tło)
                    if (item.closest('.solar-widget')) return;

                    if (factor <= 0) {
                        item.style.removeProperty('color'); // Przywróć CSS
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

            // 2. Jasny pomarańczowy (--sun) -> Atramentowy #1C1917
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

            // 3. Ciemny pomarańczowy (--sun-deep) -> Atramentowy #1C1917
            // Dotyczy m.in. .btn-auto
            const sunDeepSelectors = '.btn-auto';
            updateColor(sunDeepSelectors, 217, 119, 6, 28, 25, 23);
        });
    });
}

// ── COOKIE CONSENT ───────────────────────────────────
const initCookieConsent = () => {
    if (!localStorage.getItem('cookieConsent')) {
        const banner = document.createElement('div');
        banner.className = 'cookie-banner';
        banner.innerHTML = `
            <p>Strona korzysta z plików cookies w celu realizacji usług. Możesz określić warunki przechowywania lub dostępu do cookies w Twojej przeglądarce.</p>
            <div class="cookie-actions">
                <button id="cookie-reject" class="cookie-btn cookie-reject">Odrzuć</button>
                <button id="cookie-accept" class="cookie-btn cookie-accept">Akceptuję</button>
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

// ── PWA INSTALLATION ─────────────────────────────────
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
    console.log('Aplikacja została zainstalowana');
});

// Rejestracja Service Worker
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./service-worker.js');
}

// ── SHARE BUTTON ─────────────────────────────────────
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

// ── MAP INTERACTIVITY ────────────────────────────────
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

// ── SOLAR WIDGET ─────────────────────────────────────
const LAT        = 53.1789;  // szerokość geograficzna (Łomża)
const LNG        = 22.0593;  // długość geograficzna  (Łomża)
const PEAK_POWER = 3150;     // moc szczytowa Twoich paneli w Watach (7 × 450W)
let solarState   = null;     // Przechowywanie danych do interakcji
let currentForecastView = 'solar'; // 'solar' lub 'temp'
let solarTimeout;            // Timer do automatycznego odświeżania

function getSeason(date) {
    const m = date.getMonth() + 1, d = date.getDate();
    if ((m === 3 && d >= 20) || m === 4 || m === 5 || (m === 6 && d < 21))
        return { label: '🌱 Wiosna', factor: 0.80 };
    if ((m === 6 && d >= 21) || m === 7 || m === 8 || (m === 9 && d < 23))
        return { label: '☀ Lato',   factor: 1.00 };
    if ((m === 9 && d >= 23) || m === 10 || m === 11 || (m === 12 && d < 22))
        return { label: '🍂 Jesień', factor: 0.55 };
    return { label: '❄ Zima', factor: 0.30 };
}

// ── Helper: fetch z timeoutem (8 sekund) ─────────────
function fetchWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

// ── WAŻNA POPRAWKA: formatTime ───────────────────────
// Open-Meteo zwraca sunrise/sunset jako czas LOKALNY (nie UTC!)
function formatTime(input) {
    if (!input) return '--:--';

    // 1. Jeśli to liczba (timestamp z hovera na wykresie)
    if (typeof input === 'number') {
        return new Date(input).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }

    // 2. Jeśli to string ISO z API (np. "2026-02-16T07:15")
    const str = String(input);
    const parts = str.split('T');
    if (parts.length > 1) {
        return parts[1].substring(0, 5);
    }
    return '--:--';
}

// ── SOLAR WIDGET: Gwiazdki nocne ────────────────────────────
const starsData = [];
let starsAnimFrame = null;

function initStars() {
    const canvas = document.getElementById('sw-stars-canvas');
    if (!canvas) return;
    const widget = canvas.closest('.solar-widget');
    if (!widget) return;
    canvas.width  = widget.offsetWidth  || 600;
    canvas.height = widget.offsetHeight || 200;
    starsData.length = 0;
    const count = Math.floor((canvas.width * canvas.height) / 1800);
    for (let i = 0; i < count; i++) {
        starsData.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height * 0.75,
            r: Math.random() * 1.2 + 0.3,
            speed: Math.random() * 0.008 + 0.003,
            phase: Math.random() * Math.PI * 2
        });
    }
}

function drawStars(timestamp) {
    const canvas = document.getElementById('sw-stars-canvas');
    const widget = canvas ? canvas.closest('.solar-widget') : null;
    if (!canvas || !widget || !widget.classList.contains('is-night')) {
        starsAnimFrame = requestAnimationFrame(drawStars);
        return;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = timestamp / 1000;
    starsData.forEach(function(s) {
        const alpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.speed * 6 + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(2) + ')';
        ctx.fill();
    });
    starsAnimFrame = requestAnimationFrame(drawStars);
}

function startStars() {
    initStars();
    if (starsAnimFrame) cancelAnimationFrame(starsAnimFrame);
    starsAnimFrame = requestAnimationFrame(drawStars);
}

// Reinicjalizuj canvas przy każdej zmianie rozmiaru widgetu
(function() {
    const canvas = document.getElementById('sw-stars-canvas');
    const widget = canvas ? canvas.closest('.solar-widget') : null;
    if (!widget) return;
    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            initStars();
        }, 120);
    });
    ro.observe(widget);
})();

// ── SOLAR WIDGET: Licznik mocy na zywo ──────────────────────
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
    const { sunriseTs, sunsetTs, nowTs, clouds } = solarState;

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

    // ── Siatka godzinowa ─────────────────────────────────────
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

    // ── Gradient pod krzywą ──────────────────────────────────
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    if (isNightMode) {
        grad.addColorStop(0, 'rgba(59, 130, 246, 0.25)'); // Niebieskawy w nocy
        grad.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
    } else {
        grad.addColorStop(0, 'rgba(245,158,11,0.35)'); // Pomarańczowy w dzień
        grad.addColorStop(1, 'rgba(245,158,11,0.03)');
    }

    // ── Sinusoida produkcji (zachmurzenie spłaszcza krzywą) ──
    const cloudFactor = 1 - (clouds / 100) * 0.85;
    const steps = 300;

    // Wypełnienie gradientem
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
    
    // Gradient dla linii: Niebieski (rano) -> Pomarańczowy (południe) -> Niebieski (wieczór)
    const strokeGrad = ctx.createLinearGradient(pad.l, 0, pad.l + plotW, 0);
    if (isNightMode) {
        strokeGrad.addColorStop(0.0, '#1e40af');
        strokeGrad.addColorStop(0.5, '#3b82f6'); // Chłodny niebieski środek
        strokeGrad.addColorStop(1.0, '#1e40af');
        ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
    } else {
        strokeGrad.addColorStop(0.0, '#3B82F6');
        strokeGrad.addColorStop(0.5, '#F59E0B'); // Ciepły pomarańczowy środek
        strokeGrad.addColorStop(1.0, '#3B82F6');
        ctx.shadowColor = 'rgba(245,158,11,0.6)';
    }
    ctx.strokeStyle = strokeGrad;

    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── INTERAKCJA (HOVER) ───────────────────────────────────
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

            // Kółko na krzywej
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

    // ── Znacznik "TERAZ" ─────────────────────────────────────
    if (isDaylight) {
        const nowRatio = (nowTs - sunriseTs) / totalDay;
        const nowX     = pad.l + nowRatio * plotW;
        // Przyciemnij przeszłość
        ctx.save(); ctx.beginPath(); ctx.rect(pad.l, 0, nowX - pad.l, H); ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H); ctx.restore();
        // Pionowa linia
        ctx.beginPath(); ctx.moveTo(nowX, pad.t - 4); ctx.lineTo(nowX, H - pad.b + 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        // Kółko
        const sinNow = Math.sin(Math.PI * nowRatio) * cloudFactor;
        const nowY   = pad.t + plotH * (1 - sinNow);
        
        // Animowana kulka slonca z blaskiem i promyczkami
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
    }
    // Etykiety osi
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('🌅', pad.l, H - 8);
    ctx.textAlign = 'center'; ctx.fillText('🌞 południe', pad.l + plotW / 2, H - 8);
    ctx.textAlign = 'right'; ctx.fillText('🌇', pad.l + plotW, H - 8);
    // Oś pozioma
    ctx.beginPath(); ctx.moveTo(pad.l, H - pad.b); ctx.lineTo(pad.l + plotW, H - pad.b);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
}

// ── Mapa kodów WMO → emoji ikona i opis ──────────────
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

function renderForecast(view) {
    const container = document.getElementById('sw-forecast');
    if (!container || !solarState || !solarState.daily) return;

    container.innerHTML = '';
    const daily = solarState.daily;
    const DAYS_PL = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
    const MONTHS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
    const efficiency = 0.82;
    const n = daily.shortwave_radiation_sum?.length ?? 14;

    if (view === 'solar') {
        // ── WIDOK PRODUKCJI — słupki + ikona pogody + opady ──
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
        // ── WIDOK TEMPERATURY — SVG linia ──
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

        // Pionowe linie co 7 dni (separator tydzień 1 / tydzień 2)
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
    const phaseIndex = Math.round(phase * 8) % 8; // zgodne z istniejącymi klasami CSS

    return { phase, age, illumination, waxing, phaseIndex };
}

const DEBUG_FORCE_NIGHT = new URLSearchParams(window.location.search).get('night') === '1';
if (DEBUG_FORCE_NIGHT) {
    console.log('🌙 Debug: wymuszony tryb nocny przez parametr ?night=1');
}

function applyMoonVisuals(sunWrapper, moon) {
    if (!sunWrapper || !moon) return;
    sunWrapper.setAttribute('data-phase', moon.phaseIndex);
    const haloAlpha = (0.14 + moon.illumination * 0.58).toFixed(3);
    sunWrapper.style.setProperty('--moon-halo-alpha', haloAlpha);
}

// ── LICZNIK ZAROBKU OD MONTAŻU ──────────────────────
// Ustaw datę pierwszego uruchomienia systemu (RRRR, MM-1, DD)
const SYSTEM_START_DATE = new Date(2025, 0, 1); // Styczeń 2025 - zmień na swoją datę!
const ANNUAL_PRODUCTION_KWH = 6200; // Szacowana roczna produkcja kWh (7 paneli x 450W, Łomża)

let earnedAnimFrame = null;
let earnedCurrentVal = 0;

function updateEarnedCounter() {
    const box = document.getElementById('sw-earned-box');
    if (!box) return;

    // Pobierz aktualną cenę prądu z kalkulatora
    const priceEl  = document.getElementById('range-price');
    const price    = priceEl ? parseFloat(priceEl.value) : 1.10;

    // Oblicz ile dni minęło od montażu
    const now      = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRun  = Math.max(0, Math.floor((now - SYSTEM_START_DATE) / msPerDay));

    // Szacowana łączna produkcja (proporcjonalnie do dni)
    // Uwzględniamy sezonowość: lato produkuje więcej, zima mniej
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / msPerDay);
    // Współczynnik sezonowy (sinusoida: max w czerwcu ~dzień 172)
    const seasonFactor = 0.55 + 0.45 * Math.sin(((dayOfYear - 80) / 365) * 2 * Math.PI);

    // Roczna produkcja × ułamek roku który minął (z korekcją sezonową)
    const totalKwh = (ANNUAL_PRODUCTION_KWH / 365) * daysRun * (0.7 + seasonFactor * 0.3);

    // Zarobek = produkcja × cena prądu
    const totalEarned = totalKwh * price;

    // Dzisiaj: kWh z solar widgetu
    const todayKwhEl = document.getElementById('sw-daily-val');
    const todayKwh   = todayKwhEl ? parseFloat(todayKwhEl.textContent) || 0 : 0;
    const todayEarned = todayKwh * price;

    // Aktualizuj etykietę ceny
    const priceLabel = document.getElementById('sw-earned-price');
    if (priceLabel) priceLabel.textContent = price.toFixed(2).replace('.', ',');

    // Aktualizuj dni
    const daysEl = document.getElementById('sw-earned-days');
    if (daysEl) daysEl.textContent = daysRun.toLocaleString('pl-PL');

    // Aktualizuj kWh
    const kwhEl = document.getElementById('sw-earned-kwh');
    if (kwhEl) kwhEl.textContent = Math.round(totalKwh).toLocaleString('pl-PL');

    // Aktualizuj dziś
    const todayEl = document.getElementById('sw-earned-today-val');
    if (todayEl) {
        todayEl.textContent = todayEarned > 0
            ? todayEarned.toFixed(2).replace('.', ',')
            : '--';
    }

    // Pasek postępu (cel: roczna oszczędność = ANNUAL_PRODUCTION_KWH * price)
    const annualGoal = ANNUAL_PRODUCTION_KWH * price;
    const progressPct = Math.min(100, Math.round((totalEarned % annualGoal) / annualGoal * 100));
    const barEl = document.getElementById('sw-earned-bar');
    if (barEl) barEl.style.width = progressPct + '%';

    // Animuj licznik złotówek (od poprzedniej do nowej wartości)
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

// Uruchom przy starcie i po każdej zmianie ceny prądu
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(updateEarnedCounter, 800);

    // Reaguj na zmianę ceny prądu w kalkulatorze
    const priceSlider = document.getElementById('range-price');
    if (priceSlider) {
        priceSlider.addEventListener('input', function() {
            setTimeout(updateEarnedCounter, 50);
        });
    }
});

// Odświeżaj co 60 sekund (aktualizacja "dziś" z API)
setInterval(function() {
    if (typeof updateEarnedCounter === 'function') updateEarnedCounter();
}, 60000);

async function loadSolarData() {
    clearTimeout(solarTimeout);
    console.log('☀ loadSolarData() uruchomiona o:', new Date().toLocaleTimeString());

    const refreshBtn = document.getElementById('sw-refresh-btn');
    if(refreshBtn) refreshBtn.classList.add('loading');

    const now = new Date();
    const season = getSeason(now);
    const seasonEl = document.getElementById('sw-season');
    if(seasonEl) seasonEl.textContent = season.label;

    // Upewnij się że loading jest widoczny na start
    const loadingEl = document.getElementById('sw-loading');
    if (loadingEl) {
        loadingEl.style.display = 'flex';
        loadingEl.innerHTML = '<div class="sw-spinner"></div> Pobieranie danych...';
    }

    try {
        const url = `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${LAT}&longitude=${LNG}` +
            `&current=shortwave_radiation,cloud_cover,is_day,temperature_2m,weather_code,relative_humidity_2m` +
            `&daily=shortwave_radiation_sum,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,weather_code` +
            `&timezone=Europe/Warsaw` +
            `&forecast_days=14`;

        console.log('☀ Fetch URL:', url);

        const response = await fetchWithTimeout(url, 8000);
        
        if (!response.ok) {
            throw new Error(`API HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('☀ Dane z API:', data.current);

        // ── Wschód / Zachód ───────────────────────────────
        const sunriseIso = data.daily?.sunrise?.[0];
        const sunsetIso  = data.daily?.sunset?.[0];

        if (!sunriseIso || !sunsetIso) {
            throw new Error('Brak danych sunrise/sunset w odpowiedzi API');
        }

        // WAŻNE: Open-Meteo zwraca czas lokalny — używamy formatTime bez konwersji
        const sunriseTs = new Date(sunriseIso).getTime();
        const sunsetTs  = new Date(sunsetIso).getTime();
        const nowTs     = now.getTime();
        
        const elSunrise = document.getElementById('sw-sunrise');
        const elSunset  = document.getElementById('sw-sunset');
        if (elSunrise) elSunrise.textContent = formatTime(sunriseIso);
        if (elSunset)  elSunset.textContent  = formatTime(sunsetIso);

        console.log('☀ Wschód:', formatTime(sunriseIso), '| Zachód:', formatTime(sunsetIso));
        
        // ── Dane meteo ────────────────────────────────────
        const radiation = Math.round(data.current?.shortwave_radiation ?? 0);
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

        // Aktualizacja wyglądu słońca (Dzień/Noc)
        const sunWrapper = document.getElementById('sun-wrapper');
        const heroSection = document.querySelector('.hero');
        const solarWidget = document.querySelector('.solar-widget');
        const titleText = document.getElementById('sw-title-text');

        if (sunWrapper) {
            if (visualIsDay) {
                sunWrapper.classList.remove('is-night');
                sunWrapper.removeAttribute('data-phase'); // Reset fazy w dzień
                sunWrapper.style.removeProperty('--moon-halo-alpha');
            } else {
                sunWrapper.classList.add('is-night');
                
                // ── OBLICZANIE FAZY KSIĘŻYCA (Lokalnie) ──
                const moon = getMoonData(new Date());
                applyMoonVisuals(sunWrapper, moon);
                console.log(`🌙 Faza księżyca: idx=${moon.phaseIndex}, illum=${moon.illumination.toFixed(3)}, waxing=${moon.waxing}`);
            }
        }
        if (heroSection) {
            if (visualIsDay) {
                heroSection.classList.remove('is-night');
            } else {
                heroSection.classList.add('is-night');
            }
            
            // ── EFEKT MGŁY (FOG) ──
            // Włącz mgłę jeśli wilgotność > 90% LUB kod pogody to mgła (45, 48)
            const wCode = data.current?.weather_code ?? 0;
            const isFoggy = humidity >= 90 || (wCode >= 45 && wCode <= 48);
            
            if (isFoggy) heroSection.classList.add('is-foggy');
            else heroSection.classList.remove('is-foggy');
        }
        if (solarWidget) {
            if (visualIsDay) solarWidget.classList.remove('is-night');
            else { solarWidget.classList.add('is-night'); startStars(); }
        }

        if (titleText) {
            titleText.textContent = visualIsDay ? 'Nasłonecznienie dzisiaj' : 'Warunki nocne';
        }

        // Aktualizacja Favicon (Słońce / Księżyc)
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

        console.log(`☀ Promieniowanie: ${radiation} W/m² | Zachmurzenie: ${clouds}% | Wilgotność: ${humidity}%`);

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

        // ── Produkcja dzienna (całkowanie) ────────────────
        const dayLengthHours = (sunsetTs - sunriseTs) / (1000 * 60 * 60);
        let nowRatio = (nowTs - sunriseTs) / (sunsetTs - sunriseTs);
        nowRatio = Math.max(0, Math.min(1, nowRatio));
        
        const cloudFactor = 1 - (clouds / 100) * 0.85;
        const integralFactor = (1 - Math.cos(Math.PI * nowRatio)) / Math.PI;
        const producedWh = PEAK_POWER * cloudFactor * efficiency * dayLengthHours * integralFactor;
        const producedKWh = (producedWh / 1000).toFixed(2);
        
        const dailyValEl = document.getElementById('sw-daily-val');
        if (dailyValEl) dailyValEl.textContent = producedKWh;

        // Odśwież licznik zarobku po załadowaniu danych dziennych
        if (typeof updateEarnedCounter === 'function') updateEarnedCounter();

        console.log(`☀ Produkcja dziś: ${producedKWh} kWh (nowRatio: ${nowRatio.toFixed(2)})`);

        // ── Badges (Weather Code) ────────────────────────
        const wCode = data.current?.weather_code ?? 0;
        let wIcon = '', wText = '';

        // Mapowanie kodów WMO na ikony i tekst
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
        
        // ── Ukryj loading, pokaż canvas ───────────────────
        if (loadingEl) loadingEl.style.display = 'none';
        
        const canvas = document.getElementById('solarCanvas');
        if (canvas) {
            canvas.style.display = 'block'; 
            canvas.classList.remove('sw-animate-in');
            void canvas.offsetWidth; // trigger reflow
            canvas.classList.add('sw-animate-in');
            
            solarState = {
                sunriseTs, sunsetTs, nowTs,
                radiation, clouds,
                daily: data.daily,
                currentProduction: producedKWh
            };

            drawSolarCurve(); 
        } else {
            console.warn('☀ Nie znaleziono elementu #solarCanvas!');
        }
        
        // Animacja wartości statystyk
        document.querySelectorAll('.sw-stat-val').forEach(el => {
            el.classList.remove('sw-animate-in');
            void el.offsetWidth;
            el.classList.add('sw-animate-in');
        });
        
        // Prognoza
        if (typeof renderForecast === 'function') {
            renderForecast(currentForecastView);
        }

        // Auto-odświeżanie co 10 min
        solarTimeout = setTimeout(loadSolarData, 10 * 60 * 1000);

    } catch (err) {
        // Rozróżniamy timeout od innych błędów
        const isTimeout = err.name === 'AbortError';
        const msg = isTimeout
            ? '⏱ Timeout — serwer nie odpowiedział w 8s'
            : `⚠ ${err.message}`;

        console.error('☀ Solar widget błąd:', err);

        // Fallback: Ustaw tryb nocny na podstawie godziny systemowej, jeśli API zawiodło
        const h = new Date().getHours();
        if (DEBUG_FORCE_NIGHT || h < 6 || h >= 20) {
            const sunWrapper = document.getElementById('sun-wrapper');
            const heroSection = document.querySelector('.hero');
            const solarWidget = document.querySelector('.solar-widget');
            if (sunWrapper) sunWrapper.classList.add('is-night');
            if (heroSection) {
                const moon = getMoonData(new Date());
                heroSection.classList.add('is-night');
                applyMoonVisuals(sunWrapper, moon);
            }
            if (solarWidget) { solarWidget.classList.add('is-night'); startStars(); }
            const favicon = document.querySelector("link[rel~='icon']");
            if (favicon) {
                const svgAnim = `<style>text{animation:f 1.5s ease-out}@keyframes f{from{opacity:0}to{opacity:1}}</style>`;
                favicon.href = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>${svgAnim}<text y=%22.9em%22 font-size=%2290%22>🌙</text></svg>`;
            }
            const themeMeta = document.querySelector('meta[name="theme-color"]');
            if (themeMeta) {
                themeMeta.content = '#0f172a';
            }
        }

        if (loadingEl) {
            loadingEl.style.display = 'flex';
            loadingEl.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                    <span style="color:rgba(239,68,68,0.9); font-size:0.85rem;">${msg}</span>
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

        // Spróbuj ponownie za 2 minuty po błędzie
        solarTimeout = setTimeout(loadSolarData, 2 * 60 * 1000);

    } finally {
        const btn = document.getElementById('sw-refresh-btn');
        if (btn) btn.classList.remove('loading');
    }
}
const solarCanvasEl = document.getElementById('solarCanvas');
if (solarCanvasEl) {
    loadSolarData();

    window.addEventListener('resize', () => {
        if (solarCanvasEl.style.display !== 'none') {
            const sunriseEl = document.getElementById('sw-sunrise');
            const sunriseText = sunriseEl ? sunriseEl.textContent : '--:--';
            if (sunriseText !== '--:--') loadSolarData();
        }
    });

    // Obsługa myszy na wykresie
    solarCanvasEl.addEventListener('mousemove', (e) => {
        const rect = solarCanvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        drawSolarCurve(x);
    });
    solarCanvasEl.addEventListener('mouseleave', () => {
        drawSolarCurve(null);
    });

    // Obsługa przycisku odświeżania
    const refreshBtnEl = document.getElementById('sw-refresh-btn');
    if (refreshBtnEl) {
        refreshBtnEl.addEventListener('click', () => {
            loadSolarData();
        });
    }

    // Obsługa przełączania widoku prognozy
    document.querySelectorAll('.sw-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sw-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentForecastView = btn.getAttribute('data-view');
            renderForecast(currentForecastView);
        });
    });
}

// ── SUN PARALLAX EFFECT ──────────────────────────────
const sunWrapper = document.getElementById('sun-wrapper');
if (sunWrapper) {
    document.addEventListener('mousemove', (e) => {
        // Oblicz przesunięcie względem środka ekranu (subtelny efekt: mnożnik 0.02)
        const x = (e.clientX - window.innerWidth / 2) * -0.02;
        const y = (e.clientY - window.innerHeight / 2) * -0.02;
        sunWrapper.style.transform = `translate(${x}px, ${y}px)`;
    });
}

// ── HERO SAVINGS ANIMATION ───────────────────────────
const heroSavingsEl = document.getElementById('hero-savings-val');
if (heroSavingsEl) {
    // Wartość docelowa zgodna z kalkulatorem (180L, 4 os, 1.10zł)
    const targetSavings = 1640; 
    const animDuration = 2500;
    let animStart = null;

    function animateHeroSavings(timestamp) {
        if (!animStart) animStart = timestamp;
        const progress = Math.min((timestamp - animStart) / animDuration, 1);
        
        // Easing (easeOutExpo)
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        
        const currentVal = Math.floor(ease * targetSavings);
        // Formatowanie z spacją jako separatorem tysięcy
        heroSavingsEl.textContent = `≈ ${currentVal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} zł`;

        if (progress < 1) requestAnimationFrame(animateHeroSavings);
    }
    requestAnimationFrame(animateHeroSavings);
}

// ── BOILER ANIMATION ON SCROLL ───────────────────────
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
            // Usuń parę, gdy bojler znika z widoku
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

// ── HERO COUNTERS ANIMATION ───────────────────────
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

                // Używamy istniejącej, zaawansowanej funkcji animateValue
                animateValue(el, 0, target, 2000, { prefix, suffix, decimals });

                observer.unobserve(el);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}
initHeroCounters();

// ── HERO PARTICLES ─────────────────────────────────
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

// ── IDEA POPOVER (Zgłoś pomysł) ────────────────────
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
        e.stopPropagation(); // Zapobiega natychmiastowemu zamknięciu przez document click
        togglePopover();
    });
    ideaClose.addEventListener('click', closePopover);
    
    // Zamknij po kliknięciu poza formularz
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

            // Generuj prosty hash tekstu, aby wykryć duplikaty
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

            // Pokaż status wysyłania
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
                    // Zapisz hash jako wysłany dopiero po sukcesie
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

// ── ROI CHART & PDF EXPORT ─────────────────────────
let roiChartInstance = null;

function initROIChart() {
    const ctx = document.getElementById('roiChart');
    if (!ctx) return;

    // Elementy wejściowe (suwaki)
    const inputs = {
        cost: document.getElementById('roi-cost'),
        saving: document.getElementById('roi-saving'),
        inflation: document.getElementById('roi-inflation'),
        deposit: document.getElementById('roi-deposit-rate'),
        years: document.getElementById('roi-years')
    };

    // Jeśli brak kluczowych elementów, przerwij
    if (!inputs.cost || !inputs.saving || !inputs.years) return;

    // Elementy wyświetlające wartości suwaków
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

    // Domyślne wartości do resetu
    const defaults = {
        cost: 3500,
        saving: 1640,
        inflation: 8,
        deposit: 5,
        years: 15
    };

    let currentPaybackYear = null;
    let previousTotalGain = 0; // Przechowuje poprzednią wartość dla animacji

    function updateChart() {
        const cost = parseFloat(inputs.cost.value);
        const saving = parseFloat(inputs.saving.value);
        const inflation = parseFloat(inputs.inflation.value) / 100;
        const deposit = parseFloat(inputs.deposit.value) / 100;
        const years = parseInt(inputs.years.value);

        // Aktualizacja wyświetlanych wartości
        if(displays.cost) displays.cost.textContent = cost.toLocaleString('pl-PL') + ' zł';
        if(displays.saving) displays.saving.textContent = saving.toLocaleString('pl-PL') + ' zł';
        if(displays.inflation) displays.inflation.textContent = (inflation * 100).toFixed(1) + '%';
        if(displays.deposit) displays.deposit.textContent = (deposit * 100).toFixed(1) + '%';
        if(displays.years) displays.years.textContent = years + ' lat';
        if(summary.gainBadge) summary.gainBadge.textContent = years;
        if(summary.infoYears) summary.infoYears.textContent = years + ' latach';

        const labels = Array.from({length: years + 1}, (_, i) => i); // Lata 0..N
        
        // 1. Skumulowany zysk z instalacji (Oszczędności - Inwestycja)
        // Rok 0: -3500 zł
        // Rok 1: -3500 + Oszczędność (z uwzgl. wzrostu cen prądu)
        const dataSolar = [ -cost ];
        
        // 2. Alternatywa: Lokata (Gdybyś nie kupił bojlera, tylko wpłacił 3500 na lokatę)
        // Rok 0: 0 (punkt odniesienia - masz gotówkę)
        // Rok 1: 3500 * 5%
        // UWAGA: Żeby porównać "jabłka do jabłek" na wykresie zysku netto:
        // Lokata to zysk z odsetek od kwoty inwestycji.
        const dataDeposit = [ 0 ];
        
        let cumSolar = -cost;
        let cumDeposit = 0;
        let depositCapital = cost;
        let paybackYear = null;

        for (let i = 1; i <= years; i++) {
            // Wzrost ceny prądu zwiększa oszczędność w kolejnym roku
            const currentSaving = saving * Math.pow(1 + inflation, i - 1);
            const prevSolar = cumSolar;
            cumSolar += currentSaving;
            dataSolar.push(cumSolar);

            // Obliczanie roku zwrotu (interpolacja)
            if (prevSolar < 0 && cumSolar >= 0 && paybackYear === null) {
                const fraction = -prevSolar / (cumSolar - prevSolar);
                paybackYear = (i - 1) + fraction;
            }

            // Lokata (procent składany)
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
                        
                        // Interpolacja pozycji X dla dokładnego roku (np. 2.4)
                        const idx = Math.floor(currentPaybackYear);
                        const dec = currentPaybackYear - idx;
                        const x1 = xAxis.getPixelForValue(idx);
                        const x2 = xAxis.getPixelForValue(idx + 1);
                        // Zabezpieczenie na wypadek końca wykresu
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

    // Podłącz zdarzenia do wszystkich suwaków
    Object.values(inputs).forEach(el => {
        if(el) el.addEventListener('input', updateChart);
    });

    // Obsługa przycisku reset ROI
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

// ── COMMODITY PRICES (Paliwa) ──────────────────────
function updateCommodityPrices() {
    // Parametry energetyczne paliw (kaloryczność * sprawność kotła)
    const config = {
        wood:   { kwh: 1450, eff: 0.70, def: 400 }, // def = cena domyślna
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
        
        // Koszt 1 kWh ciepła = Cena / (Energia * Sprawność)
        const costPerKwh = price / (data.kwh * data.eff);
        const costGj = costPerKwh * 277.78;

        // Aktualizacja DOM
        const valEl = row.querySelector('.energy-value');
        const barEl = row.querySelector('.energy-bar');
        
        if(valEl) valEl.textContent = `~${costPerKwh.toFixed(2)} zł`;
        
        // Skalowanie paska (względem max ceny ok 1.50 zł)
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

    // Obsługa przycisku reset
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

// Uruchom aktualizację cen przy starcie
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
        `Cena pradu: ${document.getElementById('val-price')?.textContent || '-'}`,
        `Osoby w domu: ${document.getElementById('val-persons')?.textContent || '-'}`,
        `Pojemnosc bojlera: ${document.getElementById('val-volume')?.textContent || '-'}`,
        `Roczna oszczednosc: ${document.getElementById('result-saving')?.textContent || '-'}`,
        `Prognozowany wzrost cen pradu: ${document.getElementById('roi-inflation')?.value}%`
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

// ── MOBILE NAVIGATION (HAMBURGER) ───────────────────
const nav = document.querySelector('nav');
const hamburgerBtn = document.getElementById('hamburger-btn');
const navLinksContainer = document.querySelector('.nav-links');

if (hamburgerBtn && nav && navLinksContainer) {
    hamburgerBtn.addEventListener('click', () => {
        nav.classList.toggle('nav-open');
        // Zablokuj przewijanie tła, gdy menu jest otwarte
        document.body.style.overflow = nav.classList.contains('nav-open') ? 'hidden' : '';
    });

    // Zamknij menu po kliknięciu w link
    navLinksContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') {
            nav.classList.remove('nav-open');
            document.body.style.overflow = '';
        }
    });
}

// ── MAGAZYN ENERGII (zakładki + kalkulatory) ──────────
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
        hpCheck: document.getElementById('me-check-hp'), // Checkbox pompy ciepła
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

    // ── Profil dobowy ───────────────────────────────────────────
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

    // ── Dane sezonowe ────────────────────────────────────────────
    const SEASON_DATA = {
        annual: { pvFactor:0.85, nightMul:1.00, pvHours:10, pvShape:[0,0,0,0,0,0,0.10,0.30,0.55,0.75,0.90,1.00,1.00,0.90,0.75,0.55,0.30,0.10,0,0,0,0,0,0] },
        summer: { pvFactor:1.30, nightMul:0.72, pvHours:14, pvShape:[0,0,0,0,0,0.05,0.20,0.50,0.75,0.90,1.00,1.00,1.00,1.00,0.90,0.75,0.55,0.35,0.15,0.05,0,0,0,0] },
        spring: { pvFactor:0.85, nightMul:0.90, pvHours:11, pvShape:[0,0,0,0,0,0,0.10,0.35,0.60,0.80,0.95,1.00,1.00,0.95,0.80,0.60,0.35,0.10,0,0,0,0,0,0] },
        winter: { pvFactor:0.30, nightMul:1.32, pvHours: 7, pvShape:[0,0,0,0,0,0,0,0.10,0.35,0.65,0.90,1.00,1.00,0.90,0.65,0.35,0.10,0,0,0,0,0,0,0] }
    };

    function calcBattery() {
        let dailyAvg = state.annualKwh / 365;
        
        // Korekta dla pompy ciepła (nierównomierny rozkład roczny)
        if (state.heatPump) {
            if (state.season === 'winter') dailyAvg *= 2.4; // Zimą zużycie znacznie wyższe niż średnia
            else if (state.season === 'spring') dailyAvg *= 1.1;
            else if (state.season === 'summer') dailyAvg *= 0.5; // Latem tylko CWU + chłodzenie (mniej niż średnia roczna z ogrzewaniem)
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

        return { cap, usable, modules, cover, dailyAvg, nightShare, wastedPct, pData, sData };
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
        const pvMax   = r.dailyAvg * r.sData.pvFactor * 0.55;
        const loadMax = r.dailyAvg / 13;
        const n = 24;
        const pvSeries   = r.sData.pvShape.map(function(s) { return pvMax * s; });
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

        // ── INTERAKTYWNA LEGENDA (TOOLTIP) ──
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

            // Pobranie wartości dla danej godziny
            const vPV = pvSeries[idx];
            const vLoad = loadSeries[idx];
            const vBatt = battSeries[idx];

            // Rysowanie pudełka z legendą
            const tipW = 120;
            const tipH = vBatt > 0.01 ? 75 : 60; // Wyższy jeśli jest bateria
            let tipX = lineX + 10;
            if (tipX + tipW > w) tipX = lineX - tipW - 10;
            const tipY = padT + 5;

            // Tło dymka
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
            drawRow('#3b82f6', 'Zużycie', vLoad);
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
            tip = 'On-grid: falownik dobiera się głównie do mocy PV (często DC/AC ~1.0–1.2).';
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

        const baseYieldPerKwp = 1000; // Łomża ~950–1050 kWh/kWp/rok
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
                renderBattery(); // Przerysuj też wykres baterii po zmianie rozmiaru
            });
        });
    }

    initTabs();
    // Upewnij się, że oba suwaki PV startują z tej samej wartości
    syncPvValue(state.pvKwp);

    bindEvents();
    renderBattery();
    renderInverter();
    renderPv();
})();

// ── BLOG TAG FILTERING ───────────────────────────────
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

// ── SHOOTING STAR LOGIC ──────────────────────────────
function scheduleShootingStar() {
    const hero = document.querySelector('.hero');
    const star = document.getElementById('shooting-star');
    
    if (hero && star && hero.classList.contains('is-night')) {
        // Losowa pozycja startowa (górna prawa ćwiartka)
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
