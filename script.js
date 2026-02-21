// ── CALCULATOR ───────────────────────────────────────
// ── 1. Definicja inputs (sprawdź czy ID zgadzają się z HTML!) ──
const inputs = {
    volume:  { el: document.getElementById('range-volume'),  out: document.getElementById('val-volume'),  unit: ' L' },
    heater:  { el: document.getElementById('range-heater'),  out: document.getElementById('val-heater'),  unit: ' kW' },
    persons: { el: document.getElementById('range-persons'), out: document.getElementById('val-persons'), unit: '' },
    price:   { el: document.getElementById('range-price'),   out: document.getElementById('val-price'),   unit: ' zł' },
    sunny:   { el: document.getElementById('range-sunny'),   out: document.getElementById('val-sunny'),   unit: '' },
    tilt:    { el: document.getElementById('range-tilt'),    out: document.getElementById('val-tilt'),    unit: '°' },
    orient:  { el: document.getElementById('select-orientation'), out: null, unit: '' },
};

// ── 2. Sprawdź czy wszystkie elementy istnieją ──────
// (jeśli któryś zwróci null w konsoli — masz błąd ID w HTML)
console.log('Kalkulator — elementy:', {
    'range-volume':  document.getElementById('range-volume'),
    'range-heater':  document.getElementById('range-heater'),
    'range-persons': document.getElementById('range-persons'),
    'range-price':   document.getElementById('range-price'),
    'range-tilt':    document.getElementById('range-tilt'),
    'select-orientation': document.getElementById('select-orientation'),
    'range-sunny':   document.getElementById('range-sunny'),
    'result-energy': document.getElementById('result-energy'),
    'result-cost':   document.getElementById('result-cost'),
    'result-saving': document.getElementById('result-saving'),
    'result-payback':document.getElementById('result-payback'),
});

// ── 3. Funkcja obliczeniowa ─────────────────────────
function calcUpdate() {
    // Bezpieczne odczytanie — jeśli element nie istnieje, użyj domyślnej wartości
    const vol     = inputs.volume.el  ? +inputs.volume.el.value  : 180;
    const heaterPower = inputs.heater.el ? +inputs.heater.el.value : 2.0;
    const persons = inputs.persons.el ? +inputs.persons.el.value : 4;
    const price   = inputs.price.el   ? +inputs.price.el.value   : 1.10;
    const sunny   = inputs.sunny.el   ? +inputs.sunny.el.value   : 180;
    const tilt    = inputs.tilt.el    ? +inputs.tilt.el.value    : 35;
    const orient  = inputs.orient.el  ? +inputs.orient.el.value  : 1.0;

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

    // Pokrycie słoneczne: większy bojler = lepszy akumulator
    const volumeFactor    = 0.78 + Math.min(0.17, (vol - 50) / 1500);
    const solarCoverage   = (sunny / 365) * volumeFactor * tiltEff * orient;
    const saving          = costPerYear * solarCoverage;

    const investmentCost  = 3200;
    const paybackYears    = saving > 0 ? investmentCost / saving : 0;

    // ── Aktualizacja DOM (z null-check) ──────────────
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
        else console.warn('Kalkulator: brak elementu #' + id);
    };

    set('result-energy',  Math.round(totalPerYear) + ' kWh');
    set('result-cost',    Math.round(costPerYear)  + ' zł');
    set('result-saving',  Math.round(saving)       + ' zł');
    set('result-payback', paybackYears > 0 ? paybackYears.toFixed(1) + ' lat' : '—');

    const savingSub = document.getElementById('result-saving-sub');
    if (savingSub) {
        savingSub.textContent = `zł oszczędności (pokrycie ok. ${Math.round(solarCoverage * 100)}%)`;
    }

    // ── Aktualizacja sekcji "Przykład obliczeniowy" ──
    // Obliczamy energię potrzebną do podgrzania wody o 45 stopni (10 -> 55)
    // Wzór: Litry * 4.186 * DeltaT / 3600 = kWh
    const exEnergy = (vol * 4.186 * 45) / 3600;
    const exCost   = exEnergy * price;

    const exTitle = document.getElementById('ex-title');
    if (exTitle) exTitle.textContent = `Przykład: Ile kosztuje jednorazowe podgrzanie bojlera ${vol}L?`;

    const exDesc = document.getElementById('ex-desc');
    if (exDesc) exDesc.innerHTML = `Aby podgrzać ${vol} litrów wody (standardowy bojler) od 10°C (woda z sieci) do 55°C (ciepła woda użytkowa), potrzeba <strong>~${exEnergy.toFixed(1)} kWh</strong> energii. Zobacz, ile to kosztuje:`;

    const exSourceElec = document.getElementById('ex-source-elec');
    if (exSourceElec) exSourceElec.textContent = `⚡ Prąd z sieci (${price.toFixed(2)} zł/kWh):`;

    const exCostElec = document.getElementById('ex-cost-elec');
    if (exCostElec) exCostElec.textContent = `~${exCost.toFixed(2)} zł`;

    // ── Nowe obliczenia: Czas i Wydajność ──

    // Rekomendacja mocy grzałki (np. 1kW na 60L dla optymalnego czasu)
    const recPower = (vol / 60).toFixed(1);
    const recEl = document.getElementById('rec-heater');
    if (recEl) recEl.textContent = `${recPower} kW`;

    // Rekomendowana ilość paneli (dla wybranej grzałki)
    // Zakładamy panel 450W. Moc paneli powinna pokrywać moc grzałki (lub lekko przewyższać).
    const panelsCountCalc = Math.ceil((heaterPower * 1000) / 450);
    const recPanelsCalcEl = document.getElementById('rec-panels-calc');
    if (recPanelsCalcEl) recPanelsCalcEl.textContent = `${panelsCountCalc} szt.`;

    // Aktualizacja etykiety czasu (dynamiczna moc)
    const timeLabel = document.getElementById('ex-time-label');
    if (timeLabel) timeLabel.textContent = `Czas nagrzewania (grzałka ${heaterPower.toFixed(1)} kW)`;
    
    // 1. Czas nagrzewania (dla wybranej mocy grzałki)
    // Czas = Energia (kWh) / Moc (kW)
    const timeHoursTotal = exEnergy / heaterPower;
    const timeH = Math.floor(timeHoursTotal);
    const timeM = Math.round((timeHoursTotal - timeH) * 60);
    
    const exTime = document.getElementById('ex-time');
    if (exTime) exTime.textContent = `${timeH}h ${timeM}min`;

    // 1b. Sugerowana ilość paneli (Standard 500W - 600W Bifacial)
    // Zakładamy bezpiecznie panel 500W jako dzielnik
    const panelsNeeded = Math.ceil((heaterPower * 1000) / 500);
    const exPanels = document.getElementById('ex-panels');
    if (exPanels) exPanels.textContent = `${panelsNeeded} szt. (500W+)`;

    // 1c. Info o dużej mocy (zielony komunikat)
    const powerNote = document.getElementById('ex-power-note');
    if (powerNote) {
        if (heaterPower > parseFloat(recPower)) {
            powerNote.style.display = 'block';
            powerNote.className = 'power-note success';
            powerNote.innerHTML = `✅ <strong>Duża moc grzałki!</strong> Woda nagrzeje się bardzo szybko. Pamiętaj, że falownik musi obsłużyć tę moc (wymaga min. ${panelsNeeded} paneli 500W).`;
        } else {
            powerNote.style.display = 'none';
        }
    }

    // 2. Ilość pryszniców (zakładamy ok. 40L ciepłej wody na szybki prysznic)
    const showersCount = Math.floor(vol / 40);
    const exShowers = document.getElementById('ex-showers');
    if (exShowers) exShowers.textContent = `ok. ${showersCount} osób`;

    // 3. Kontekst użycia (Osoby vs Pojemność)
    // Zapotrzebowanie dzienne: osoby * 50L
    const dailyNeed = persons * 50;
    // Ile razy trzeba nagrzać bojler?
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
}

// ── 4. Eventy na suwakach ───────────────────────────
Object.entries(inputs).forEach(([key, obj]) => {
    if (!obj.el) {
        console.warn('Kalkulator: brak suwaka dla klucza:', key);
        return;
    }
    obj.el.addEventListener('input', () => {
        const val = +obj.el.value;
        if (obj.out) {
            obj.out.textContent = (key === 'price')
                ? val.toFixed(2) + obj.unit
                : (key === 'heater') ? val.toFixed(1) + obj.unit
                : val + obj.unit;
        }
        calcUpdate();
    });

    // Inicjalizuj etykietę suwaka przy starcie
    if (obj.out && obj.el.value !== undefined) {
        const val = +obj.el.value;
        obj.out.textContent = (key === 'price')
            ? val.toFixed(2) + obj.unit
            : (key === 'heater') ? val.toFixed(1) + obj.unit
            : (key === 'tilt')   ? val + obj.unit
            : val + obj.unit;
    }
});

// ── 5. ★ KLUCZOWE: wywołaj przy starcie ─────────────
calcUpdate();

// ── Przycisk automatycznego doboru ───────────────────
const autoSetBtn = document.getElementById('btn-auto-set');
if (autoSetBtn) {
    autoSetBtn.addEventListener('click', () => {
        // Optymalne wartości dla 4-osobowej rodziny
        const optimalValues = {
            persons: 4,
            volume: 200,
            heater: 3.0,
            tilt: 35,
            orient: "1.0",
        };

        // Ustaw wartości i wywołaj zdarzenie 'input' dla każdego suwaka/selecta
        Object.entries(optimalValues).forEach(([key, value]) => {
            if (inputs[key] && inputs[key].el) {
                inputs[key].el.value = value;
                inputs[key].el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    });
}

// ── FORM ─────────────────────────────────────────────
const contactForm = document.getElementById('contact-form');
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
    
    const phoneVal = phoneInput.value.replace(/\D/g, ''); // Usuwa wszystko co nie jest cyfrą

    if (phoneVal.length !== 9) {
        alert('Proszę podać poprawny numer telefonu (9 cyfr).');
        return;
    }

    const status = document.getElementById('form-status');
    const btn = this.querySelector('button[type="submit"]');
    const originalBtnText = btn.innerText;
    
    btn.innerText = 'Wysyłanie...';
    btn.disabled = true;
    status.innerHTML = '<span style="color:#F59E0B">Wysyłanie...</span>';

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
        status.innerHTML = '<span style="color:#ef4444">Błąd wysyłania. Spróbuj zadzwonić: 574 322 909</span>';
    })
    .finally(() => {
        btn.innerText = originalBtnText;
        btn.disabled = false;
    });
});

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
    rootMargin: '0px',
    threshold: 0.1
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

window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
        backToTopBtn.classList.add('visible');
    } else {
        backToTopBtn.classList.remove('visible');
    }
});

backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

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
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
        .then(() => console.log('Service Worker zarejestrowany'));
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
    grad.addColorStop(0, 'rgba(245,158,11,0.35)');
    grad.addColorStop(1, 'rgba(245,158,11,0.03)');

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
    strokeGrad.addColorStop(0.0, '#3B82F6'); // Rano: Niebieski
    strokeGrad.addColorStop(0.5, '#F59E0B'); // Południe: Pomarańczowy
    strokeGrad.addColorStop(1.0, '#3B82F6'); // Wieczór: Niebieski
    ctx.strokeStyle = strokeGrad;

    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(245,158,11,0.6)';
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
        ctx.beginPath(); ctx.arc(nowX, nowY, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#F59E0B'; ctx.shadowColor = 'rgba(245,158,11,0.9)'; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(nowX, nowY, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#1C1917'; ctx.fill();
        // Etykieta
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 10px sans-serif'; ctx.textAlign = 'center';
        const labelX = Math.min(Math.max(nowX, 28), W - 28);
        ctx.fillText('TERAZ', labelX, nowY - 14);
    }
    // Etykiety osi
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('🌅', pad.l, H - 8);
    ctx.textAlign = 'center'; ctx.fillText('🌞 południe', pad.l + plotW / 2, H - 8);
    ctx.textAlign = 'right'; ctx.fillText('🌇', pad.l + plotW, H - 8);
    // Oś pozioma
    ctx.beginPath(); ctx.moveTo(pad.l, H - pad.b); ctx.lineTo(pad.l + plotW, H - pad.b);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
}

function renderForecast(view) {
    const container = document.getElementById('sw-forecast');
    if (!container || !solarState || !solarState.daily) return;

    container.innerHTML = '';
    const daily = solarState.daily;
    const days = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
    const efficiency = 0.82;

    if (view === 'solar') {
        // ── WIDOK PRODUKCJI (Słupki) ──
        const dailyRad = daily.shortwave_radiation_sum; // MJ/m²
        const systemKWp = PEAK_POWER / 1000;
        // 1 MJ = 0.277 kWh. Wzór: (MJ/m² / 3.6) * (Moc_kWp) * Sprawność
        const dailyKWh = dailyRad.map(mj => (mj / 3.6) * systemKWp * efficiency);
        const maxKWh = Math.max(...dailyKWh, 5); // min skala 5 kWh

        dailyKWh.forEach((val, i) => {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dayName = i === 0 ? 'Dziś' : days[date.getDay()];
            const heightPct = (val / maxKWh) * 100;
            const isToday = i === 0 ? 'today' : '';
            
            // Tooltip text
            let tooltip = `Prognoza: ${val.toFixed(2)} kWh`;
            
            // Dla dzisiaj dodaj produkcję do tej pory
            if (i === 0 && solarState.currentProduction) {
                tooltip += ` (Do teraz: ${solarState.currentProduction} kWh)`;
            }

            const html = `
                <div class="sw-day ${isToday} sw-animate-in" style="animation-delay: ${i * 0.05}s" data-tooltip="${tooltip}">
                    <div class="sw-bar-wrap">
                        <div class="sw-day-val">${val.toFixed(1)}</div>
                        <div class="sw-bar" style="height: ${heightPct}%"></div>
                    </div>
                    <div class="sw-day-name">${dayName}</div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', html);
        });

    } else {
        // ── WIDOK TEMPERATURY (Wykres liniowy SVG) ──
        const tMax = daily.temperature_2m_max;
        const tMin = daily.temperature_2m_min;
        
        // Skalowanie Y
        const globalMax = Math.max(...tMax) + 2;
        const globalMin = Math.min(...tMin) - 2;
        const range = globalMax - globalMin;
        
        // Generowanie punktów SVG
        let pointsMax = "", pointsMin = "";
        // Używamy 7 kolumn, punkty w środku każdej kolumny (jak w wykresie słupkowym)
        const colWidth = 100 / 7;

        let tempLabelsHtml = "";
        let dayLabelsHtml = "";

        tMax.forEach((val, i) => {
            // X w środku kolumny
            const x = (i + 0.5) * colWidth;
            const yMax = 100 - ((val - globalMin) / range) * 100; // odwrócona oś Y
            const yMin = 100 - ((tMin[i] - globalMin) / range) * 100;
            
            pointsMax += `${x},${yMax} `;
            pointsMin += `${x},${yMin} `;
            
            // Dodanie etykiet tekstowych (Dzień + Temp)
            const date = new Date(); date.setDate(date.getDate() + i);
            const dayName = i === 0 ? 'Dziś' : days[date.getDay()];
            
            // Etykiety dni (na dole)
            dayLabelsHtml += `<div style="position:absolute; left:${i * colWidth}%; bottom:0; width:${colWidth}%; text-align:center; font-size:0.7rem; color:rgba(255,255,255,0.4); text-transform:uppercase;">${dayName}</div>`;

            // Etykiety temperatur (HTML nad/pod punktami)
            tempLabelsHtml += `<div style="position:absolute; left:${i * colWidth}%; top:${yMax}%; width:${colWidth}%; text-align:center; transform:translateY(-100%); margin-top:-8px; font-size:0.75rem; font-weight:700; color:#ef4444;">${Math.round(val)}°</div>`;
            tempLabelsHtml += `<div style="position:absolute; left:${i * colWidth}%; top:${yMin}%; width:${colWidth}%; text-align:center; margin-top:8px; font-size:0.75rem; font-weight:700; color:#3b82f6;">${Math.round(tMin[i])}°</div>`;
        });

        const svgHtml = `
            <div style="position:relative; width:100%; height:100%;">
                <div style="position:absolute; top:0; left:0; right:0; bottom:24px;">
                    <svg class="sw-temp-svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%; height:100%; overflow:visible;">
                        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" stroke-width="0.5" vector-effect="non-scaling-stroke" />
                        <polyline points="${pointsMax}" fill="none" stroke="#ef4444" stroke-width="2" vector-effect="non-scaling-stroke" />
                        <polyline points="${pointsMin}" fill="none" stroke="#3b82f6" stroke-width="2" vector-effect="non-scaling-stroke" />
                    </svg>
                    ${tempLabelsHtml}
                </div>
                ${dayLabelsHtml}
            </div>
        `;
        container.innerHTML = svgHtml;
        container.style.position = 'relative'; // dla pozycjonowania etykiet
    }
}

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
            `&current=shortwave_radiation,cloudcover,is_day,temperature_2m,weather_code` +
            `&daily=shortwave_radiation_sum,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
            `&timezone=Europe/Warsaw` +
            `&forecast_days=7`;

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
        const clouds    = Math.round(data.current?.cloudcover ?? 0);
        const isDay     = data.current?.is_day === 1;
        const currentTemp = Math.round(data.current?.temperature_2m ?? 0);
        const efficiency = 0.82;
        const panelOutput = isDay
            ? Math.round((radiation / 1000) * PEAK_POWER * efficiency)
            : 0;

        console.log(`☀ Promieniowanie: ${radiation} W/m² | Zachmurzenie: ${clouds}% | Dzień: ${isDay}`);

        const elRadiation = document.getElementById('sw-radiation');
        const elClouds    = document.getElementById('sw-clouds');
        const elPanels    = document.getElementById('sw-panels');
        if (elRadiation) elRadiation.textContent = radiation + ' W/m²';
        if (elClouds)    elClouds.textContent    = clouds + '%';
        if (elPanels)    elPanels.textContent    = panelOutput + ' W';

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

        console.log(`☀ Produkcja dziś: ${producedKWh} kWh (nowRatio: ${nowRatio.toFixed(2)})`);

        // ── Badges (Weather Code) ────────────────────────
        const wCode = data.current?.weather_code ?? 0;
        let wIcon = '', wText = '';

        // Mapowanie kodów WMO na ikony i tekst
        if (wCode === 0) {
            wIcon = isDay ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            wText = 'Bezchmurnie';
        } else if (wCode === 1 || wCode === 2) {
            wIcon = isDay ? '<i class="fas fa-cloud-sun"></i>' : '<i class="fas fa-cloud-moon"></i>';
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
loadSolarData();
window.addEventListener('resize', () => {
    const canvas = document.getElementById('solarCanvas');
    if (canvas && canvas.style.display !== 'none') {
        const sunriseText = document.getElementById('sw-sunrise').textContent;
        if (sunriseText !== '--:--') loadSolarData();
    }
});

// Obsługa myszy na wykresie
const canvasEl = document.getElementById('solarCanvas');
if (canvasEl) {
    canvasEl.addEventListener('mousemove', (e) => {
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        drawSolarCurve(x);
    });
    canvasEl.addEventListener('mouseleave', () => {
        drawSolarCurve(null);
    });
}

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
                    // Easing ease-out (cubic) - dopasowany do animacji CSS
                    const ease = 1 - Math.pow(1 - progress, 3);
                    const val = Math.floor(10 + (55 - 10) * ease);
                    tempEl.textContent = val + '°C';
                    
                    if (progress < 1) boilerAnimFrame = requestAnimationFrame(step);
                };
                boilerAnimFrame = requestAnimationFrame(step);
            }
        } else {
            entry.target.classList.remove('animate-boiler');
            if (boilerAnimFrame) cancelAnimationFrame(boilerAnimFrame);
            if (tempEl) tempEl.textContent = '10°C';
        }
    });
}, { threshold: 0.9 }); // Uruchom, gdy widoczne w 90%

const boilerVisual = document.querySelector('.stratification-visual');
if (boilerVisual) {
    boilerObserver.observe(boilerVisual);
}