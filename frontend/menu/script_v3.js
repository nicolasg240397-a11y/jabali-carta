document.addEventListener("DOMContentLoaded", () => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/prices`;
    let ws = null;
    let reconnectInterval = null;

    // State
    const BEER_IMAGES = {
        "Apa Born & Released (Manush)": "APA.png",
        "Session IPA (Manush)": "Session-IPA.png",
        "Old Garage IPA (Manush)": "Old-Garage-IPA.png",
        "Pilsen (Manush)": "Easy-Pilsen.png",
        "Irish Cream Ale (Manush)": "Irish-Cream-Ale.png",
        "Milk Stout (Manush)": "Milk-Stout.png",
        "Extra Stout (Manush)": "Milk-Stout.png" // Reutilizamos la imagen de la Milk Stout
    };

    let currentProducts = {}; // id -> product data
    let marketStatus = "normal";
    let nextRecalcTime = null;
    let timerInterval = null;

    const menuContainer = document.getElementById('menu-container');
    const loader = document.getElementById('initial-loader');
    const marketStatusBadge = document.getElementById('market-status');
    const crashOverlay = document.getElementById('crash-overlay');
    const timerBadge = document.getElementById('price-timer');
    const timerContainer = document.getElementById('price-timer-container');

    const numberFormat = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0
    });

    function connectWebSocket() {
        if (ws) {
            ws.close();
        }

        ws = new WebSocket(wsUrl);
        console.log("Intentando conectar WebSocket a:", wsUrl);

        ws.onopen = () => {
            console.log("Conectado al mercado en vivo en:", wsUrl);
            clearInterval(reconnectInterval);

            // Ping to keep alive
            setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send("ping");
                }
            }, 30000);
        };

        ws.onmessage = (event) => {
            if (event.data === "pong") return;

            try {
                const data = JSON.parse(event.data);
                handleMessage(data);
            } catch (e) {
                console.error("Error parseando ws message:", e);
            }
        };

        ws.onclose = () => {
            console.log("Desconectado. Reconectando en 3s...");
            marketStatusBadge.textContent = "Desconectado";
            marketStatusBadge.className = "status-badge crashed";
            reconnectInterval = setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (err) => {
            console.error("WebSocket error:", err);
            ws.close();
        };
    }

    function handleMessage(data) {
        console.log("Mensaje WS recibido:", data.type);
        if (data.type === "initial") {
            renderInitialMenu(data.products);
            updateMarketStatus(data.status);

            loader.classList.add('hidden');
            menuContainer.classList.remove('hidden');
        }
        else if (data.type === "price_update" || data.type === "price_crash") {
            updatePrices(data.products);
            if (data.status) {
                updateMarketStatus(data.status);
            }
        }
        else if (data.type === "stock_update") {
            // Update stock bars if we are showing them
            const products = data.products || [data.product];
            products.forEach(p => {
                currentProducts[p.id] = { ...currentProducts[p.id], ...p };
                updateStockUI(p);
            });
        }
    }

    function renderInitialMenu(products) {
        menuContainer.innerHTML = '';
        currentProducts = {};

        // Group by category
        const categories = {};
        products.forEach(p => {
            currentProducts[p.id] = p;
            if (!categories[p.category]) {
                categories[p.category] = [];
            }
            categories[p.category].push(p);
        });

        const categoryTemplate = document.getElementById('category-template');
        const productTemplate = document.getElementById('product-template');

        for (const [categoryName, items] of Object.entries(categories)) {
            const catNode = categoryTemplate.content.cloneNode(true);
            catNode.querySelector('.category-title').textContent = categoryName;

            const productList = catNode.querySelector('.product-list');

            items.forEach(p => {
                const prodNode = productTemplate.content.cloneNode(true);
                const card = prodNode.querySelector('.product-card');
                card.id = `product-${p.id}`;

                // Add background image if it is a beer
                if (BEER_IMAGES[p.name]) {
                    card.style.backgroundImage = `url('img/cervezas/${BEER_IMAGES[p.name]}')`;
                    card.classList.add('has-bg');
                }

                prodNode.querySelector('.product-emoji').textContent = p.emoji || '🍺';
                prodNode.querySelector('.product-name').textContent = p.name;

                const priceEl = prodNode.querySelector('.current-price');
                priceEl.textContent = numberFormat.format(p.current_price);

                // Show stock if it's running low (< 10)
                updateStockUINode(prodNode.querySelector('.stock-container'), p);

                productList.appendChild(prodNode);
            });

            menuContainer.appendChild(catNode);
        }
    }

    function updateStockUINode(container, product) {
        const priceEl = container.closest('.product-card').querySelector('.current-price');

        if (!product.is_available || product.stock === 0) {
            container.classList.remove('hidden');
            const fill = container.querySelector('.stock-fill');
            fill.style.width = '0%';
            priceEl.textContent = "AGOTADO";
            priceEl.style.color = "var(--text-secondary)";
        } else if (product.stock < 15) {
            container.classList.remove('hidden');
            const fill = container.querySelector('.stock-fill');
            // Assuming max stock might typically be around 50 for visualizing
            const pct = Math.min((product.stock / 20) * 100, 100);
            fill.style.width = `${pct}%`;
            if (product.stock < 5) fill.classList.add('low');
            else fill.classList.remove('low');

            // Restore price text in case it was Agotado
            if (priceEl.textContent === "AGOTADO") {
                priceEl.textContent = numberFormat.format(product.current_price);
                priceEl.style.color = "";
            }
        } else {
            container.classList.add('hidden');
            // Restore price text in case it was Agotado
            if (priceEl.textContent === "AGOTADO") {
                priceEl.textContent = numberFormat.format(product.current_price);
                priceEl.style.color = "";
            }
        }
    }

    function updateStockUI(product) {
        const card = document.getElementById(`product-${product.id}`);
        if (!card) return;
        const container = card.querySelector('.stock-container');
        updateStockUINode(container, product);
    }

    function updatePrices(products) {
        products.forEach(newP => {
            const oldP = currentProducts[newP.id];
            if (!oldP) return;

            const card = document.getElementById(`product-${newP.id}`);
            if (!card) return;

            const priceEl = card.querySelector('.current-price');
            const priceContainer = card.querySelector('.price-container');

            // Remove existing arrows
            const existingArrow = card.querySelector('.price-indicator');
            if (existingArrow) existingArrow.remove();

            if (newP.current_price > oldP.current_price) {
                // Price up
                priceEl.textContent = numberFormat.format(newP.current_price);
                priceEl.className = 'current-price up-color';
                card.classList.remove('price-down');
                // Trigger reflow to restart animation
                void card.offsetWidth;
                card.classList.add('price-up');

                const arrow = document.createElement('span');
                arrow.className = 'price-indicator up-color';
                arrow.textContent = '▲';
                priceContainer.appendChild(arrow);

            } else if (newP.current_price < oldP.current_price) {
                // Price down
                priceEl.textContent = numberFormat.format(newP.current_price);
                priceEl.className = 'current-price down-color';
                card.classList.remove('price-up');
                void card.offsetWidth;
                card.classList.add('price-down');

                const arrow = document.createElement('span');
                arrow.className = 'price-indicator down-color';
                arrow.textContent = '▼';
                priceContainer.appendChild(arrow);
            }

            // Cleanup colors after delay
            setTimeout(() => {
                priceEl.className = 'current-price';
                const indicator = card.querySelector('.price-indicator');
                if (indicator) indicator.remove();
            }, 3000);

            // Update state
            currentProducts[newP.id] = { ...oldP, ...newP };

            // Sync stock changes on price updates (e.g. day reset)
            updateStockUI(newP);
        });
    }

    function updateMarketStatus(status) {
        marketStatus = status.crash_active ? "crashed" : "normal";
        if (marketStatus === "crashed") {
            marketStatusBadge.textContent = "Mercado Caído";
            marketStatusBadge.className = "status-badge crashed";
            crashOverlay.classList.remove('hidden');
            if (timerContainer) timerContainer.classList.add('hidden');
            else if (timerBadge) timerBadge.classList.add('hidden');

            // Haptic feedback if supported
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200, 100, 500]);
            }

            // Hide the full screen overlay after 2 seconds so they can see prices
            setTimeout(() => {
                crashOverlay.classList.add('hidden');
            }, 2000);

        } else {
            marketStatusBadge.textContent = "Mercado Abierto";
            marketStatusBadge.className = "status-badge open";
            crashOverlay.classList.add('hidden');

            if (status.next_recalc_time) {
                nextRecalcTime = new Date(status.next_recalc_time);
                if (timerContainer) timerContainer.classList.remove('hidden');
                else if (timerBadge) timerBadge.classList.remove('hidden');
                startTimer();
            } else {
                if (timerContainer) timerContainer.classList.add('hidden');
                else if (timerBadge) timerBadge.classList.add('hidden');
            }
        }
    }

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            if (!nextRecalcTime) return;

            const now = new Date();
            const diff = nextRecalcTime - now;

            if (diff <= 0) {
                if (timerBadge) {
                    timerBadge.textContent = "🕒 Calculando...";
                    timerBadge.classList.remove('warning');
                }
                return;
            }

            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);

            if (timerBadge) {
                timerBadge.textContent = `🕒 ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                if (minutes === 0 && seconds <= 30) {
                    timerBadge.classList.add('warning');
                } else {
                    timerBadge.classList.remove('warning');
                }
            }
        }, 1000);
    }

    // Start
    connectWebSocket();
});
