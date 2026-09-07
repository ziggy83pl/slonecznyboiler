document.addEventListener("DOMContentLoaded", function() {
    const container = document.getElementById('global-trusted-logos');
    if (!container) return;

    // 1. WSTRZYKIWANIE STYLI CSS (Aby skrypt był samodzielny na każdej stronie)
    const style = document.createElement('style');
    style.textContent = `
        #global-trusted-logos {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            gap: 15px;
        }
        .marquee-wrapper {
            position: relative;
            width: 100%;
            max-width: 1140px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .marquee-nav-btn {
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #ffffff;
            width: 38px;
            height: 38px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: all 0.2s ease;
            z-index: 10;
            flex-shrink: 0;
            user-select: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .marquee-nav-btn:hover {
            background: #F59E0B;
            color: #0F172A;
            border-color: #F59E0B;
            transform: scale(1.1);
        }
        .logos-marquee {
            overflow: hidden;
            flex: 1;
            position: relative;
            padding: 60px 0 15px 0;
            display: flex;
            align-items: flex-end;
            mask-image: linear-gradient(to right, transparent, white 8%, white 92%, transparent);
            -webkit-mask-image: linear-gradient(to right, transparent, white 8%, white 92%, transparent);
            user-select: none;
            -webkit-user-select: none;
            cursor: grab;
            touch-action: pan-y;
        }
        .logos-marquee.is-dragging {
            cursor: grabbing;
        }
        .logos-track {
            display: flex;
            width: max-content;
            gap: 0;
            will-change: transform;
        }
        .logos-track .logo-tooltip {
            margin: 0 15px;
            flex-shrink: 0;
            user-select: none;
            -webkit-user-drag: none;
        }
        .logos-track .logo-tooltip img {
            pointer-events: none;
            user-select: none;
            -webkit-user-drag: none;
        }
        #global-trusted-logos .logo-tooltip {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-decoration: none;
            color: inherit;
            position: relative;
            cursor: pointer;
            flex-shrink: 0;
            z-index: 1;
        }
        #global-trusted-logos .logo-tooltip:hover {
            z-index: 100;
        }
        #global-trusted-logos img {
            height: 70px;
            width: 70px;
            object-fit: contain;
            border-radius: 50%;
            background-color: #ffffff;
            padding: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            opacity: 0.9;
            transition: all 0.3s ease;
        }
        #global-trusted-logos .logo-tooltip:hover img {
            filter: grayscale(0%);
            opacity: 1;
            transform: scale(1.1);
            box-shadow: 0 0 20px var(--hover-color, rgba(0,0,0,0.2));
        }
        .logo-label {
            display: block;
            margin-top: 8px;
            font-size: 0.75rem;
            font-weight: 600;
            text-align: center;
            font-family: sans-serif;
            color: inherit;
        }
        .logo-header {
            width: 100%;
            text-align: center;
            margin-bottom: 15px;
            font-size: 1.5rem;
            font-weight: bold;
            color: inherit;
        }
        /* Tooltip (Dymek) */
        .logo-tooltip::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: 100%; left: 50%;
            transform: translateX(-50%) translateY(6px);
            background: var(--accent, #333); color: #fff;
            padding: 6px 12px; border-radius: 6px;
            font-size: 0.82rem; white-space: nowrap;
            opacity: 0; visibility: hidden; pointer-events: none;
            transition: all 0.25s ease; z-index: 9999; margin-bottom: 10px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.3);
        }
        .logo-tooltip::before {
            content: '';
            position: absolute;
            bottom: 100%; left: 50%;
            transform: translateX(-50%) translateY(6px);
            border: 6px solid transparent;
            border-top-color: var(--accent, #333);
            opacity: 0; visibility: hidden; pointer-events: none;
            transition: all 0.25s ease; z-index: 9999; margin-bottom: -2px;
        }
        .logo-tooltip:hover::after, .logo-tooltip:hover::before {
            opacity: 1; visibility: visible;
            transform: translateX(-50%) translateY(0);
        }

        /* --- STYLE MODALA (Okienka) --- */
        .pm-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 9999;
            display: flex; justify-content: center; align-items: center;
            opacity: 0; visibility: hidden; transition: all 0.3s ease;
            backdrop-filter: blur(3px);
        }
        .pm-modal-overlay.active { opacity: 1; visibility: visible; }
        
        .pm-modal-content {
            background: white; width: 90%; max-width: 450px;
            padding: 30px; border-radius: 15px;
            text-align: center; position: relative;
            transform: translateY(20px); transition: all 0.3s ease;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        .pm-modal-overlay.active .pm-modal-content { transform: translateY(0); }

        .pm-close-btn {
            position: absolute; top: 10px; right: 15px;
            font-size: 24px; cursor: pointer; color: #888;
            background: none; border: none; padding: 5px;
        }
        .pm-close-btn:hover { color: #333; }

        .pm-modal-img {
            height: 90px;
            width: 90px;
            object-fit: contain;
            border-radius: 50%;
            border: 2px solid rgba(0, 0, 0, 0.12);
            background-color: #ffffff;
            padding: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            margin: 0 auto 15px auto;
            display: block;
        }
        .pm-modal-title { font-size: 1.5rem; margin-bottom: 10px; color: #333; font-weight: bold; }
        .pm-modal-desc { font-size: 0.95rem; color: #666; margin-bottom: 25px; line-height: 1.5; }
        
        .pm-modal-action {
            display: inline-block; padding: 12px 30px;
            background: #333; color: white; text-decoration: none;
            border-radius: 50px; font-weight: 600; transition: 0.3s;
        }
        .pm-modal-action:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.2); }

        /* --- DARK MODE SUPPORT FOR MODAL --- */
        html[data-bs-theme="dark"] .pm-modal-content,
        body.dark-mode .pm-modal-content,
        .dark-mode .pm-modal-content,
        [data-theme="dark"] .pm-modal-content {
            background-color: #1e293b !important;
            background: #1e293b !important;
            color: #f8fafc !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5) !important;
        }
        html[data-bs-theme="dark"] .pm-modal-title,
        body.dark-mode .pm-modal-title,
        .dark-mode .pm-modal-title,
        [data-theme="dark"] .pm-modal-title {
            color: #f8fafc !important;
        }
        html[data-bs-theme="dark"] .pm-modal-desc,
        body.dark-mode .pm-modal-desc,
        .dark-mode .pm-modal-desc,
        [data-theme="dark"] .pm-modal-desc {
            color: #cbd5e1 !important;
        }
        html[data-bs-theme="dark"] .pm-close-btn,
        body.dark-mode .pm-close-btn,
        .dark-mode .pm-close-btn,
        [data-theme="dark"] .pm-close-btn {
            color: #cbd5e1 !important;
        }
        html[data-bs-theme="dark"] .pm-close-btn:hover,
        body.dark-mode .pm-close-btn:hover,
        .dark-mode .pm-close-btn:hover,
        [data-theme="dark"] .pm-close-btn:hover {
            color: #f97316 !important;
        }
        html[data-bs-theme="dark"] .pm-modal-img,
        body.dark-mode .pm-modal-img,
        .dark-mode .pm-modal-img,
        [data-theme="dark"] .pm-modal-img {
            border-color: rgba(255, 255, 255, 0.2) !important;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4) !important;
        }
    `;
    document.head.appendChild(style);

    // LISTA TWOICH PROJEKTÓW
    const projects = [
        {
            name: "Kebab Łomża",
            url: "https://www.facebook.com/DonersLomza",
            img: "https://ziggy83pl.github.io/zasoby/logo/doners_kebab.webp",
            title: "Doners Kebab Łomża",
            description: "Najlepszy Kebab w mieście! Świeże składniki, szybka dostawa i niezapomniany smak.",
            color: "#e67e22"
        },
        {
            name: "Budownictwo",
            url: "https://zamow-budowe.pages.dev/",
            img: "https://ziggy83pl.github.io/zasoby/logo/prodom.webp",
            title: "PRODOM BUDOWNICTWO",
            description: "Kompleksowe usługi budowlane. Od fundamentów aż po dach. Solidność i terminowość.",
            color: "#3498db"
        },
        {
            name: "Słoneczny Bojler",
            url: "https://slonecznyboiler.pages.dev/",
            img: "https://slonecznyboiler.pages.dev/logo/slonce.webp",
            title: "Słoneczny Bojler - Darmowa Woda",
            description: "Fotowoltaika do grzania wody. Oszczędzaj na rachunkach dzięki energii słonecznej. Montaż Łomża i okolice.",
            color: "#F59E0B"
        },
        {
            name: "Pomoc",
            url: "https://www.siepomaga.pl",
            img: "https://ziggy83pl.github.io/zasoby/logo/siepomaga.webp",
            title: "Wspieramy Siepomaga.pl",
            description: "Wspieramy potrzebujących. Razem możemy więcej! Dołącz do zbiórek na Siepomaga.pl.",
            color: "#e74c3c"
        },
        {
            name: "Remonty",
            url: "https://pawelszczesnyostroleka.pages.dev/",
            img: "https://ziggy83pl.github.io/zasoby/logo/pawel.webp",
            title: "CZŁOWIEK, KTÓRY WYKONA WSZYSTKO",
            description: "Usługi remontowo-ogrodowe i transport. Solidnie, terminowo i dokładnie.",
            color: "#34495e"
        },
        {
            name: "Wizytówki online",
            url: "https://wizytowka-online.pages.dev/",
            img: "https://ziggy83pl.github.io/zasoby/logo/enterprise.webp", 
            title: "Enterprise - Strony WWW",
            description: "Nowoczesne strony internetowe, sklepy online i aplikacje webowe. Zadbaj o swój wizerunek w sieci.",
            color: "#10b981"
        },
        {
            name: "Wynajem",
            url: "https://rentmaster.pages.dev/",
            img: "https://ziggy83pl.github.io/zasoby/logo/rentmaster.webp",
            title: "RentMaster - Wynajem",
            description: "Profesjonalna wypożyczalnia sprzętu budowlanego i ogrodniczego. Sprawdź naszą ofertę.",
            color: "#1a2a6c"
        },
         {
            name: "Ogrodnik",
            url: "https://ziggy83pl.github.io/KrzysztofSzczesny/",
            img: "https://ziggy83pl.github.io/zasoby/logo/krzysztof.webp",
            title: "Krzysztof Szczęsny - Usługi",
            description: "Remonty, ogrody, transport. Solidnie, na czas i bez ściemy.",
            color: "#10b981"
        },
        {
            name: "Koparka",
            url: "https://uslugi-koparko.pages.dev/",
            img: "https://ziggy83pl.github.io/zasoby/logo/arkop.webp",
            title: "Arkadiusz Malinowski - Uslugi Koparkarkowe",
            description: "Usługi Koparkowe i Roboty Ziemne — Precyzja, Moc, Terminowość.",
            color: "#f59e0b",
            keywords: ["uslugi-koparko", "ArkadiuszMalinowski"]
        },
        {
            name: "Giełda Budowlana",
            url: "https://gieldabudowlana.xo.je/",
            img: "https://ziggy83pl.github.io/zasoby/logo/gieldabudowlana.webp",
            title: "Giełda Budowlana",
            description: "Giełda Budowlana",
            color: "#f39c12"
        },
        {
            name: "LZ-TECH",
            url: "https://lz-tech.pages.dev/",
            img: "https://ziggy83pl.github.io/zasoby/logo/lz_tech.webp",
            title: "LZ-TECH - Usługi Minikoparką i Elektryczne",
            description: "Profesjonalne usługi minikoparką i instalacje elektryczne. Wykopy pod przyłącza, kanalizację, kable, niwelacja terenu i kompleksowa elektryka.",
            color: "#ffcc00",
            keywords: ["lz-tech", "lukaszZelechowski", "lukaszzelechowski", "lz.tech"]
        },
        {
            name: "Antyki",
            url: "https://antyki-pl.xo.je/",
            img: "https://ziggy83pl.github.io/zasoby/logo/antyki.webp",
            title: "Antyki PL - Ogłoszenia i Skup Antyków",
            description: "Portal z antykami, starociami i meblami z duszą. Dodawaj ogłoszenia i kupuj unikalne przedmioty z historią.",
            color: "#8b4513",
            keywords: ["antyki-pl", "antyki.pl", "antyki-pl.xo.je", "antyki"]
        },
        {
            name: "Wykończenia",
            url: "https://mariusz-butrymowicz-wykonczenia-wnetrz.pages.dev/",
            img: "https://ziggy83pl.github.io/zasoby/logo/mariusz.webp",
            title: "Mariusz Butrymowicz - Wykończenia Wnętrz",
            description: "Kompleksowe usługi remontowo-budowlane i wykończenia wnętrz od A do Z. Malowanie, szpachlowanie, zabudowy g-k, glazura i instalacje.",
            color: "#eab308",
            keywords: ["mariusz-butrymowicz", "mariusz-butrymowicz-wykonczenia-wnetrz", "butrymowicz"]
        },
    ];

    const currentUrl = window.location.href;

    // Nagłówek sekcji (H2) dodawany automatycznie
    let logosHtml = '';

    projects.forEach(project => {
        let isHidden = false;

        // 1. Sprawdzenie po słowach kluczowych (jeśli zdefiniowane) - obsługuje wiele URLi
        if (project.keywords && Array.isArray(project.keywords)) {
            if (project.keywords.some(key => currentUrl.includes(key))) isHidden = true;
        } else {
            // 2. Stara logika (automatyczna)
            // Sprawdza czy URL projektu zawiera się w obecnym URLu (proste wykrywanie "siebie samego")
            if (currentUrl.includes(project.url.replace('https://', '').replace('http://', '').split('/')[0])) {
                 isHidden = true;
            }
             // Dodatkowe sprawdzenie dla Słonecznego Bojlera
            if (project.name === "Słoneczny Bojler" && currentUrl.includes("slonecznyboiler")) isHidden = true;
        }
        if ((project.name === "Antyki" || project.name === "Antyki PL") && (currentUrl.includes("antyki-pl") || currentUrl.includes("antyki.pl") || currentUrl.includes("antyki"))) {
            isHidden = true;
        }

        if (!isHidden) {
            logosHtml += `
                <div class="logo-tooltip" data-tooltip="${project.title}" title="${project.title}" onclick="openPortfolioModal('${project.name}')">
                    <img src="${project.img}" alt="${project.name}" style="--hover-color: ${project.color}; width: 70px; height: 70px; object-fit: contain; border-radius: 50%;" width="70" height="70" loading="lazy" onerror="this.style.display='none'">
                    <span class="logo-label">${project.name}</span>
                </div>`;
        }
    });

    let html = `<h2 class="logo-header" data-lang="portfolio_title">Wspieramy i Polecamy</h2>`;
    html += `
        <div class="marquee-wrapper">
            <button type="button" class="marquee-nav-btn" id="pm-nav-prev" aria-label="Przewiń w lewo (wstecz)">&#10094;</button>
            <div class="logos-marquee" title="Przeciągnij w lewo lub w prawo, aby przewijać">
                <div class="logos-track">
                    ${logosHtml}
                    ${logosHtml}
                    ${logosHtml}
                    ${logosHtml}
                </div>
            </div>
            <button type="button" class="marquee-nav-btn" id="pm-nav-next" aria-label="Przewiń w prawo (dalej)">&#10095;</button>
        </div>
    `;

    container.innerHTML = html;

    // --- INTERAKTYWNA OBSŁUGA MARQUEE (DRAG & DROP, KÓŁKO, PRZYCISKI) ---
    const marqueeEl = container.querySelector('.logos-marquee');
    const trackEl = container.querySelector('.logos-track');
    const prevBtn = container.querySelector('#pm-nav-prev');
    const nextBtn = container.querySelector('#pm-nav-next');

    let currentX = 0;
    let isHovered = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartCurrentX = 0;
    let hasMoved = false;
    let lastTime = performance.now();
    const autoSpeed = 35; // px na sekundę

    function getHalfWidth() {
        return (trackEl ? trackEl.scrollWidth / 2 : 1200) || 1200;
    }

    function wrapX() {
        const halfWidth = getHalfWidth();
        while (currentX <= -halfWidth) { currentX += halfWidth; }
        while (currentX > 0) { currentX -= halfWidth; }
    }

    function renderLoop(now) {
        const delta = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        if (!isHovered && !isDragging) {
            currentX -= autoSpeed * delta;
            wrapX();
            if (trackEl) trackEl.style.transform = `translate3d(${currentX}px, 0, 0)`;
        }
        requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    // Hover zatrzymuje ruch
    if (marqueeEl) {
        marqueeEl.addEventListener('mouseenter', () => { isHovered = true; });
        marqueeEl.addEventListener('mouseleave', () => {
            if (!isDragging) isHovered = false;
        });

        // Przeciąganie myszką (Mouse Drag)
        marqueeEl.addEventListener('mousedown', (e) => {
            isDragging = true;
            hasMoved = false;
            dragStartX = e.clientX;
            dragStartCurrentX = currentX;
            marqueeEl.classList.add('is-dragging');
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            if (Math.abs(dx) > 5) {
                hasMoved = true;
            }
            currentX = dragStartCurrentX + dx;
            wrapX();
            if (trackEl) trackEl.style.transform = `translate3d(${currentX}px, 0, 0)`;
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                marqueeEl.classList.remove('is-dragging');
                setTimeout(() => { hasMoved = false; }, 100);
            }
        });

        // Przeciąganie dotykiem na telefonach (Touch Swipe)
        marqueeEl.addEventListener('touchstart', (e) => {
            isHovered = true;
            isDragging = true;
            hasMoved = false;
            dragStartX = e.touches[0].clientX;
            dragStartCurrentX = currentX;
        }, { passive: true });

        marqueeEl.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const dx = e.touches[0].clientX - dragStartX;
            if (Math.abs(dx) > 5) {
                hasMoved = true;
            }
            currentX = dragStartCurrentX + dx;
            wrapX();
            if (trackEl) trackEl.style.transform = `translate3d(${currentX}px, 0, 0)`;
        }, { passive: true });

        marqueeEl.addEventListener('touchend', () => {
            isDragging = false;
            setTimeout(() => {
                isHovered = false;
                hasMoved = false;
            }, 1200);
        }, { passive: true });

        // Kółko myszy (przewijanie kółkiem nad paskiem logotypów)
        marqueeEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            currentX -= delta * 0.9;
            wrapX();
            if (trackEl) trackEl.style.transform = `translate3d(${currentX}px, 0, 0)`;
        }, { passive: false });
    }

    // Przyciski ‹ i ›
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentX += 220; // przesuwa w prawo, odsłaniając wcześniejsze loga
            wrapX();
            if (trackEl) trackEl.style.transform = `translate3d(${currentX}px, 0, 0)`;
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentX -= 220; // przesuwa w lewo, odsłaniając kolejne loga
            wrapX();
            if (trackEl) trackEl.style.transform = `translate3d(${currentX}px, 0, 0)`;
        });
    }

    // --- LOGIKA MODALA ---
    
    // 1. Dodanie struktury HTML modala do body (jeśli jeszcze nie istnieje)
    if (!document.getElementById('portfolio-modal-overlay')) {
        const modalHtml = `
            <div id="portfolio-modal-overlay" class="pm-modal-overlay">
                <div class="pm-modal-content">
                    <button class="pm-close-btn" onclick="closePortfolioModal()">&times;</button>
                    <img id="pm-img" class="pm-modal-img" src="" alt="">
                    <h3 id="pm-title" class="pm-modal-title"></h3>
                    <p id="pm-desc" class="pm-modal-desc"></p>
                    <a id="pm-link" href="#" target="_blank" class="pm-modal-action" style="background-color: var(--accent, #333)">Odwiedź stronę</a>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // 2. Funkcje globalne do obsługi (przypisane do window, aby działały w onclick)
    window.openPortfolioModal = function(projectName) {
        if (hasMoved) return; // Jeśli użytkownik przeciągał myszką, nie otwieraj modala
        const project = projects.find(p => p.name === projectName);
        if (!project) return;

        const imgEl = document.getElementById('pm-img');
        imgEl.src = project.img;
        imgEl.alt = project.name;
        
        document.getElementById('pm-title').textContent = project.title;
        document.getElementById('pm-desc').textContent = project.description || project.title;
        
        const linkBtn = document.getElementById('pm-link');
        linkBtn.href = project.url;
        linkBtn.style.backgroundColor = project.color;

        document.getElementById('portfolio-modal-overlay').classList.add('active');
    };

    window.closePortfolioModal = function() {
        const overlay = document.getElementById('portfolio-modal-overlay');
        if (overlay) overlay.classList.remove('active');
    };

    // Zamknij modal po kliknięciu w tło
    const overlay = document.getElementById('portfolio-modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === this) window.closePortfolioModal();
        });
    }
});

