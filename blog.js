// Blog page script: keep only features used on blog.html

// Mobile navigation (hamburger)
const nav = document.querySelector('nav');
const hamburgerBtn = document.getElementById('hamburger-btn');
const navLinksContainer = document.querySelector('.nav-links');

if (hamburgerBtn && nav && navLinksContainer) {
    hamburgerBtn.addEventListener('click', () => {
        nav.classList.toggle('nav-open');
        document.body.style.overflow = nav.classList.contains('nav-open') ? 'hidden' : '';
    });

    navLinksContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') {
            nav.classList.remove('nav-open');
            document.body.style.overflow = '';
        }
    });
}

// Blog tag filtering
const filtersContainer = document.querySelector('.blog-filters');
const blogCards = document.querySelectorAll('.blog-card[data-tags]');

if (filtersContainer && blogCards.length > 0) {
    filtersContainer.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;

        filtersContainer.querySelector('.active')?.classList.remove('active');
        e.target.classList.add('active');

        const filter = e.target.getAttribute('data-filter');
        blogCards.forEach(card => {
            const tags = card.getAttribute('data-tags') || '';
            if (filter === 'all' || tags.includes(filter)) {
                card.classList.remove('hidden');
            } else {
                card.classList.add('hidden');
            }
        });
    });
}

// Cookie consent
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

        document.getElementById('cookie-accept')?.addEventListener('click', () => handleConsent('accepted'));
        document.getElementById('cookie-reject')?.addEventListener('click', () => handleConsent('rejected'));
    }
};
initCookieConsent();

// Service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
        .then(() => console.log('Service Worker zarejestrowany'));
}

// Image lightbox for gallery photos
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
