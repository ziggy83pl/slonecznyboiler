document.addEventListener("DOMContentLoaded", function() {
    const container = document.getElementById('global-trusted-logos');
    if (!container) return;

    // 1. WSTRZYKIWANIE STYLI CSS (Aby skrypt był samodzielny na każdej stronie)
    const style = document.createElement('style');
    style.textContent = `
        #global-trusted-logos {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            align-items: center;
            gap: 30px;
        }
        #global-trusted-logos .logo-tooltip {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-decoration: none;
            color: inherit;
            position: relative;
            cursor: pointer;
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
            margin-bottom: 25px;
            font-size: 1.5rem;
            font-weight: bold;
            color: inherit;
        }
        /* Tooltip (Dymek) */
        .logo-tooltip::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: 100%; left: 50%;
            transform: translateX(-50%) translateY(10px);
            background: var(--accent, #333); color: #fff;
            padding: 8px 12px; border-radius: 6px;
            font-size: 0.85rem; white-space: nowrap;
            opacity: 0; visibility: hidden; pointer-events: none;
            transition: 0.3s; z-index: 9999; margin-bottom: 12px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .logo-tooltip::before {
            content: '';
            position: absolute;
            bottom: 100%; left: 50%;
            transform: translateX(-50%) translateY(10px);
            border: 6px solid transparent;
            border-top-color: var(--accent, #333);
            opacity: 0; visibility: hidden; pointer-events: none;
            transition: 0.3s; z-index: 9999; margin-bottom: 0px;
        }
        .logo-tooltip:hover::after, .logo-tooltip:hover::before { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0); }

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

        .pm-modal-img { height: 100px; width: 100px; object-fit: contain; margin-bottom: 15px; }
        .pm-modal-title { font-size: 1.5rem; margin-bottom: 10px; color: #333; font-weight: bold; }
        .pm-modal-desc { font-size: 0.95rem; color: #666; margin-bottom: 25px; line-height: 1.5; }
        
        .pm-modal-action {
            display: inline-block; padding: 12px 30px;
            background: #333; color: white; text-decoration: none;
            border-radius: 50px; font-weight: 600; transition: 0.3s;
        }
        .pm-modal-action:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.2); }
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
            url: "https://ziggy83pl.github.io/rentmaster/",
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
    ];

    const currentUrl = window.location.href;

    // Nagłówek sekcji (H2) dodawany automatycznie
    let html = `<h2 class="logo-header" data-lang="portfolio_title">Wspieramy i Polecamy</h2>`;

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

        if (!isHidden) {
            html += `
                <div class="logo-tooltip" data-tooltip="${project.title}" onclick="openPortfolioModal('${project.name}')">
                    <img src="${project.img}" alt="${project.name}" style="--hover-color: ${project.color}" width="70" height="70" loading="lazy" onerror="this.style.display='none'">
                    <span class="logo-label">${project.name}</span>
                </div>`;
        }
    });

    container.innerHTML = html;

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