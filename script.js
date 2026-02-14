// ── CALCULATOR ───────────────────────────────────────
const inputs = {
    volume: { el: document.getElementById('range-volume'), out: document.getElementById('val-volume'), unit: ' L' },
    persons: { el: document.getElementById('range-persons'), out: document.getElementById('val-persons'), unit: '' },
    price: { el: document.getElementById('range-price'), out: document.getElementById('val-price'), unit: ' zł' },
    sunny: { el: document.getElementById('range-sunny'), out: document.getElementById('val-sunny'), unit: '' },
};

function calcUpdate() {
    const vol = +inputs.volume.el.value;
    const persons = +inputs.persons.el.value;
    const price = +inputs.price.el.value;
    const sunny = +inputs.sunny.el.value;

    // kWh needed to heat water for N persons per year
    // ~50L/person/day, delta T ~35°C, 4.186 J/(g·K), 1 kWh = 3600 kJ
    const litersPerDay = persons * 50;
    const kwhUsagePerDay = (litersPerDay * 4.186 * 35) / 3600;

    // Straty postojowe: ok. 0.8 kWh / 100L / dobę
    const standbyLossesPerDay = (vol / 100) * 0.8;

    const totalKwhPerDay = kwhUsagePerDay + standbyLossesPerDay;
    const totalKwhPerYear = totalKwhPerDay * 365;
    const costPerYear = totalKwhPerYear * price;

    // Współczynnik akumulacji (pokrycia) zależny od pojemności
    // Baza 0.78, rośnie z pojemnością (większy bufor = lepsze wykorzystanie słońca)
    const volumeFactor = 0.78 + Math.min(0.17, (vol - 50) / 1500);

    const solarCoverage = (sunny / 365) * volumeFactor;
    const saving = costPerYear * solarCoverage;
    const investmentCost = 3200;
    const paybackYears = investmentCost / saving;

    document.getElementById('result-energy').textContent = Math.round(totalKwhPerYear) + ' kWh';
    document.getElementById('result-cost').textContent = Math.round(costPerYear) + ' zł';
    document.getElementById('result-saving').textContent = Math.round(saving) + ' zł';
    document.getElementById('result-payback').textContent = paybackYears.toFixed(1) + ' lat';

    // Aktualizacja opisu pokrycia
    const savingSub = document.getElementById('result-saving-sub');
    if (savingSub) {
        savingSub.textContent = `zł oszczędności (pokrycie ok. ${Math.round(solarCoverage * 100)}%)`;
    }
}

Object.entries(inputs).forEach(([key, obj]) => {
    obj.el.addEventListener('input', () => {
        let val = +obj.el.value;
        if (key === 'price') obj.out.textContent = val.toFixed(2) + obj.unit;
        else obj.out.textContent = val + obj.unit;
        calcUpdate();
    });
});
// Init display for price (start at 1.10)
inputs.price.out.textContent = '1.10 zł';
calcUpdate();

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