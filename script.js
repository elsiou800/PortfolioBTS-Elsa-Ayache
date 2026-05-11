// ================================================
//  PORTFOLIO ELSA AYACHE — script.js
// ================================================

const RSS_URL = 'https://cert.ssi.gouv.fr/feed/';

// Images de secours thématiques (hébergées sur Picsum / services publics sans restriction CORS)
const FALLBACK_IMAGES = [
    'https://picsum.photos/seed/cyber/800/400',
    'https://picsum.photos/seed/network/800/400',
    'https://picsum.photos/seed/tech/800/400',
];

// ──────────────────────────────────────────────
// Génère une seed stable à partir du titre pour toujours avoir la même image par article
function titleToSeed(title) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = ((hash << 5) - hash) + title.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % 1000;
}

// Extraction de la 1ère image dans le contenu HTML d'un article
// ──────────────────────────────────────────────
function extractImage(item) {
    // 1. Image explicite renvoyée par l'API
    if (item.thumbnail && item.thumbnail.startsWith('http')) return item.thumbnail;
    if (item.enclosure && item.enclosure.link)               return item.enclosure.link;

    // 2. Première <img> dans le contenu HTML
    if (item.content || item.description) {
        const html  = item.content || item.description;
        const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match && match[1].startsWith('http')) return match[1];
    }

    // 3. Image Picsum stable basée sur le titre (même article = même image à chaque chargement)
    const seed = titleToSeed(item.title || 'cyber');
    return `https://picsum.photos/seed/${seed}/800/400`;
}

// ──────────────────────────────────────────────
// Formatage de la date en français
// ──────────────────────────────────────────────
function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ──────────────────────────────────────────────
// Construction HTML du 1er article (avec image)
// ──────────────────────────────────────────────
function buildFeaturedItem(item) {
    const img  = extractImage(item);
    const date = formatDate(item.published || item.pubDate);
    return `
        <div class="rss-item rss-item--featured">
            <a href="${item.url || item.link}" target="_blank" rel="noopener" class="rss-featured-img-link">
                <div class="rss-featured-img" style="background-image:url('${img}')">
                    <span class="rss-featured-badge">🔔 Dernier article</span>
                </div>
            </a>
            <div class="rss-featured-body">
                <small>Actu Sécurité • ${date}</small>
                <h3><a href="${item.url || item.link}" target="_blank" rel="noopener">${item.title}</a></h3>
            </div>
        </div>`;
}

// ──────────────────────────────────────────────
// Construction HTML des articles suivants (sans image)
// ──────────────────────────────────────────────
function buildRegularItem(item) {
    const date = formatDate(item.published || item.pubDate);
    return `
        <div class="rss-item">
            <small>Actu Sécurité • ${date}</small>
            <h3><a href="${item.url || item.link}" target="_blank" rel="noopener">${item.title}</a></h3>
        </div>`;
}

// ──────────────────────────────────────────────
// 1. CHARGEMENT DE LA VEILLE RSS
//    Stratégie : feed2json.org (principal) → rss2json.com (fallback)
// ──────────────────────────────────────────────
// Fetch avec timeout configurable
function fetchWithTimeout(url, ms = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

// Parse un flux Atom/RSS brut (XML) sans dépendance externe
function parseXML(xmlStr) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlStr, 'application/xml');
    const entries = [...doc.querySelectorAll('entry, item')];
    return entries.map(e => {
        const get = (sel) => e.querySelector(sel)?.textContent?.trim() || '';
        const link = e.querySelector('link')?.getAttribute('href')
                  || e.querySelector('link')?.textContent?.trim()
                  || get('guid');
        return {
            title:     get('title'),
            url:       link,
            published: get('published') || get('pubDate') || get('updated'),
            content:   get('content') || get('description') || get('summary'),
        };
    }).filter(i => i.title && i.url);
}

async function loadVeille() {
    const feedContainer = document.getElementById('rss-feed');
    if (!feedContainer) return;

    if (window.location.protocol === 'file:') {
        showError(feedContainer);
        return;
    }

    const encoded = encodeURIComponent(RSS_URL);

    // Liste de proxies à essayer dans l'ordre
    const proxies = [
        {
    type: 'corsproxy',
    url:  `https://corsproxy.io/?${encoded}`,
    parse: async (res) => {
        const text = await res.text();
        const items = parseXML(text);
        if (!items.length) throw new Error('vide');
        return items;
    }
},
        {
            type: 'feed2json',
            url:  `https://feed2json.org/convert?url=${encoded}`,
            parse: async (res) => {
                const json = await res.json();
                const items = (json.items || []).map(i => ({
                    title:     i.title,
                    url:       i.url || i.link,
                    published: i.published || i.date_published,
                    content:   i.content_html || i.content_text || '',
                    thumbnail: i.image,
                }));
                if (!items.length) throw new Error('vide');
                return items;
            }
        },
        {
            type: 'rss2json',
            url:  `https://api.rss2json.com/v1/api.json?rss_url=${encoded}`,
            parse: async (res) => {
                const json = await res.json();
                if (json.status !== 'ok' || !json.items?.length) throw new Error('vide');
                return json.items.map(i => ({
                    title:     i.title,
                    url:       i.link,
                    published: i.pubDate,
                    content:   i.content,
                    thumbnail: i.thumbnail,
                    enclosure: i.enclosure,
                }));
            }
        },
    ];

    for (const proxy of proxies) {
        try {
            const res = await fetchWithTimeout(proxy.url, 6000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = await proxy.parse(res);
            renderFeed(feedContainer, items.slice(0, 4));
            return; // succès
        } catch (e) {
            console.warn(`[RSS] Proxy ${proxy.type} échoué :`, e.message);
            // on continue avec le proxy suivant
        }
    }

    // Tous les proxies ont échoué
    showError(feedContainer);
}

// ──────────────────────────────────────────────
// Rendu final des articles dans le DOM
// ──────────────────────────────────────────────
function renderFeed(container, items) {
    let html = '';
    items.forEach((item, i) => {
        html += i === 0 ? buildFeaturedItem(item) : buildRegularItem(item);
    });
    container.innerHTML = html;
}

// ──────────────────────────────────────────────
// Message d'erreur propre
// ──────────────────────────────────────────────
function showError(container) {
    const isFile = window.location.protocol === 'file:';
    container.innerHTML = `
        <div style="padding:1.6rem 2rem; color:var(--text-muted); font-size:.9rem; line-height:1.8; display:flex; gap:1rem; align-items:flex-start;">
            <span style="font-size:1.4rem; flex-shrink:0;">📡</span>
            <div>
                ${isFile
                    ? `<strong style="color:var(--text-main);">Flux RSS indisponible en local</strong><br>
                       Votre portfolio tourne avec le protocole <code>file://</code> qui bloque les requêtes réseau.<br>
                       <span style="font-size:.82rem;">👉 Dans VS Code, installez <strong>Live Server</strong>, puis clic droit sur <code>index.html</code> → <em>Open with Live Server</em>. Le RSS s'affichera automatiquement.</span>`
                    : `<strong style="color:var(--text-main);">Flux RSS temporairement indisponible</strong><br>
                       Impossible de contacter le flux Google Alerts. Vérifiez que votre URL RSS est toujours active.`
                }
            </div>
        </div>`;
}

// ──────────────────────────────────────────────
// 2. MODALE PROJETS
// ──────────────────────────────────────────────
const modal      = document.getElementById('projectModal');
const modalTitle = document.getElementById('modalTitle');
const modalDesc  = document.getElementById('modalDesc');
const modalImg   = document.getElementById('modalImg');
const btn1       = document.getElementById('modalDocLink1');
const btn2       = document.getElementById('modalDocLink2');

function openProject(data) {
    modalTitle.textContent = data.title;
    modalDesc.textContent  = data.desc;
    modalImg.src           = data.img;
    modalImg.alt           = data.title;

    if (data.url1 && data.url2) {
        btn1.href = data.url1; btn1.textContent = '📄 Rapport Stage 1'; btn1.style.display = 'inline-flex';
        btn2.href = data.url2; btn2.textContent = '📄 Rapport Stage 2'; btn2.style.display = 'inline-flex';
    } else if (data.urlGeneral) {
        btn1.href = data.urlGeneral; btn1.textContent = '📄 Voir la Documentation'; btn1.style.display = 'inline-flex';
        btn2.style.display = 'none';
    } else {
        btn1.style.display = 'none';
        btn2.style.display = 'none';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ──────────────────────────────────────────────
// 3. MENU MOBILE
// ──────────────────────────────────────────────
function closeMobileMenu() {
    const mobileMenu = document.getElementById('mobileMenu');
    const menuBtn    = document.getElementById('menuBtn');
    if (mobileMenu) mobileMenu.classList.remove('open');
    if (menuBtn)    menuBtn.setAttribute('aria-expanded', 'false');
}

// ──────────────────────────────────────────────
// 4. INITIALISATION
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    loadVeille();

    document.querySelectorAll('.clickable-project').forEach(card => {
        card.addEventListener('click', () => {
            openProject({
                title:      card.getAttribute('data-title')     || '',
                desc:       card.getAttribute('data-desc')      || '',
                img:        card.getAttribute('data-img')       || '',
                urlGeneral: card.getAttribute('data-doc-url')   || null,
                url1:       card.getAttribute('data-doc-url-1') || null,
                url2:       card.getAttribute('data-doc-url-2') || null,
            });
        });
    });

    document.querySelector('.close-modal').addEventListener('click', closeModal);
    window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });

    const menuBtn    = document.getElementById('menuBtn');
    const mobileMenu = document.getElementById('mobileMenu');
    if (menuBtn && mobileMenu) {
        menuBtn.addEventListener('click', () => {
            const isOpen = mobileMenu.classList.toggle('open');
            menuBtn.setAttribute('aria-expanded', String(isOpen));
        });
    }
});