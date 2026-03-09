document.addEventListener('DOMContentLoaded', () => {

    // ── Fullscreen on first tap ──────────────────────────────────────────────
    const enterFullscreen = () => {
        const elem = document.documentElement;
        if (!document.fullscreenElement) {
            const request = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen;
            if (request) request.call(elem).catch(() => { });
        }
        document.removeEventListener('click', enterFullscreen);
        document.removeEventListener('touchstart', enterFullscreen);
    };
    document.addEventListener('click', enterFullscreen);
    document.addEventListener('touchstart', enterFullscreen, { passive: true });

    // ── State ────────────────────────────────────────────────────────────────
    let activeFilter = 'all';
    let searchTerm = '';

    // ── Render helpers ───────────────────────────────────────────────────────
    function renderItem(item) {
        const tags = (item.tags || []).join(' ');
        const isBeer = !!item.beerCard;

        let classes = 'menu-item';
        if (isBeer) classes += ' beer-card';

        let styleAttr = isBeer ? ` style="background-image:url('${item.image}')"` : '';

        let inner = `
            <div class="item-header">
                <h3 class="item-name">${item.name}</h3>
                ${item.price ? `<span class="item-price">${item.price}</span>` : ''}
            </div>`;

        if (item.isPlaceholder) {
            return `<div class="menu-item vinos-placeholder" data-tags="">
                        <p class="item-desc">Consultar en barra</p>
                    </div>`;
        }

        if (item.desc) {
            inner += `<p class="item-desc">${item.desc}</p>`;
        }

        // Diet tag badges on the item
        const dietBadges = [];
        if (item.tags) {
            if (item.tags.includes('vegano')) dietBadges.push('<span class="diet-tag tag-vegano">🌱 Vegano</span>');
            if (item.tags.includes('vegetariano') && !item.tags.includes('vegano')) dietBadges.push('<span class="diet-tag tag-vegetariano">🥦 Vegetariano</span>');
            if (item.tags.includes('sin-tacc') && !isBeer) dietBadges.push('<span class="diet-tag tag-sin-tacc">🌾 Sin TACC</span>');
            if (item.tags.includes('sin-alcohol')) dietBadges.push('<span class="diet-tag tag-sin-alcohol">🚫 Sin Alcohol</span>');
        }

        if (isBeer) {
            inner += `<div class="beer-badges">
                        <span class="beer-badge">${item.abv} ABV</span>
                        <span class="beer-badge">${item.style}</span>
                      </div>`;
        } else if (dietBadges.length > 0) {
            inner += `<div class="diet-tags-row">${dietBadges.join('')}</div>`;
        }

        return `<div class="${classes}"${styleAttr} data-tags="${tags}">${inner}</div>`;
    }

    function renderCategory(cat, index) {
        const gridClass = cat.gridClass ? ` ${cat.gridClass}` : '';
        const descHtml = cat.desc ? `<p class="category-desc">${cat.desc}</p>` : '';

        let extrasHtml = '';
        if (cat.extras && cat.extras.length > 0) {
            extrasHtml = `<div class="item-extras">${cat.extras.map(e => `<p>${e}</p>`).join('')}</div>`;
        }

        const itemsHtml = cat.items.map(renderItem).join('\n');

        return `
        <div class="menu-category" style="animation-delay:${(index + 1) * 0.1}s">
            <div class="category-header">
                <h2 class="category-title">${cat.title}</h2><span class="toggle-icon"></span>
            </div>
            ${descHtml}
            ${extrasHtml}
            <div class="items-grid${gridClass}">
                ${itemsHtml}
            </div>
        </div>`;
    }

    function renderSection(section) {
        const categoriesHtml = section.categories.map((cat, i) => renderCategory(cat, i)).join('\n');
        return `
        <section id="${section.id}" class="menu-section">
            ${categoriesHtml}
        </section>`;
    }

    // ── Filter logic ─────────────────────────────────────────────────────────
    function applyFilters() {
        const activeSection = document.querySelector('.menu-section.active');
        if (!activeSection) return;

        activeSection.querySelectorAll('.menu-category').forEach(category => {
            const items = category.querySelectorAll('.menu-item');
            let visibleCount = 0;

            items.forEach(item => {
                const name = item.querySelector('.item-name')?.textContent.toLowerCase() || '';
                const desc = item.querySelector('.item-desc')?.textContent.toLowerCase() || '';
                const tags = item.dataset.tags || '';

                const matchesSearch = searchTerm === '' || name.includes(searchTerm) || desc.includes(searchTerm);
                const matchesFilter = activeFilter === 'all' || tags.includes(activeFilter);

                const visible = matchesSearch && matchesFilter;
                item.classList.toggle('hidden', !visible);
                if (visible) visibleCount++;
            });

            if (visibleCount > 0 || (activeFilter === 'all' && searchTerm === '')) {
                category.style.display = '';
                if (searchTerm !== '') category.classList.remove('collapsed');
            } else {
                category.style.display = 'none';
            }
        });
    }

    // ── Load JSON and boot ───────────────────────────────────────────────────
    fetch('menu.json')
        .then(r => r.json())
        .then(data => {
            const menuRoot = document.getElementById('menu-root');
            menuRoot.innerHTML = data.sections.map(renderSection).join('\n');

            // Activate first section
            const firstSection = menuRoot.querySelector('.menu-section');
            if (firstSection) firstSection.classList.add('active');

            // ── Navigation ───────────────────────────────────────────────────
            const navBtns = document.querySelectorAll('.nav-btn');
            navBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    navBtns.forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.menu-section').forEach(s => s.classList.remove('active'));

                    btn.classList.add('active');
                    const targetSection = document.getElementById(btn.dataset.target);
                    targetSection.classList.add('active');

                    // Re-trigger stagger animation
                    targetSection.querySelectorAll('.menu-category').forEach((cat, i) => {
                        cat.style.animationDelay = `${(i + 1) * 0.1}s`;
                        cat.style.animation = 'none';
                        void cat.offsetHeight;
                        cat.style.animation = null;
                    });

                    searchInput.value = '';
                    searchTerm = '';
                    applyFilters();
                });
            });

            // ── Collapsible categories ────────────────────────────────────────
            menuRoot.addEventListener('click', e => {
                const header = e.target.closest('.category-header');
                if (header) {
                    header.closest('.menu-category').classList.toggle('collapsed');
                }
            });

            // ── Search ───────────────────────────────────────────────────────
            searchInput.addEventListener('input', e => {
                searchTerm = e.target.value.toLowerCase().trim();
                applyFilters();
            });

            // ── Diet filters ─────────────────────────────────────────────────
            document.querySelectorAll('.diet-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.diet-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    activeFilter = btn.dataset.filter;
                    applyFilters();
                });
            });
        })
        .catch(err => {
            document.getElementById('menu-root').innerHTML =
                `<p style="color:#a1a1aa;text-align:center;padding:3rem">Error cargando el menú. Intentá recargar la página.</p>`;
            console.error('Error loading menu.json:', err);
        });

    // ── Back to top ──────────────────────────────────────────────────────────
    const backToTopBtn = document.getElementById('backToTopBtn');
    window.addEventListener('scroll', () => {
        backToTopBtn.classList.toggle('show', window.scrollY > 300);
    });
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // ── Search input reference (declared early for nav handler) ──────────────
    const searchInput = document.getElementById('searchInput');
});
