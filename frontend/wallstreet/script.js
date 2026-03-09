/* ──────────────────────────────────────────────────────────────────────────────
   Bar Wall Street - Wall Street TV Display Script
   ────────────────────────────────────────────────────────────────────────────── */

const API_BASE = window.location.origin;
const WS_BASE = `ws://${window.location.host}`;
const RECALC_INTERVAL = 10 * 60; // 10 minutes in seconds

// ─── State ──────────────────────────────────────────────────────────────────────
let products = [];
let previousPrices = {};
let countdown = RECALC_INTERVAL;
let ws = null;
let particlesSpawned = false;

let isCrash = false;
let crashEnd = null;
const crashContainer = document.getElementById("crash-container");

// ─── DOM Elements ───────────────────────────────────────────────────────────────
const priceTbody = document.getElementById("price-board");
const tickerContent = document.getElementById("ticker-content");
const clockEl = document.getElementById("clock");
const countdownEl = document.getElementById("countdown");
const wsStatus = document.getElementById("ws-status");

// ─── Helpers ────────────────────────────────────────────────────────────────────
function formatPrice(price) {
    return "$" + Math.round(price).toLocaleString("es-AR");
}

function formatPriceShort(price) {
    if (price >= 1000) {
        return "$" + (price / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    }
    return "$" + price;
}

function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function updateCountdown() {
    if (countdown <= 0) countdown = RECALC_INTERVAL;
    const min = Math.floor(countdown / 60);
    const sec = countdown % 60;
    if (countdownEl) {
        countdownEl.textContent = `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    countdown--;
}

// ─── Happy Hour visual system ───────────────────────────────────────────────────
function spawnParticles() {
    if (particlesSpawned) return;
    particlesSpawned = true;

    const colors = ["#ffd740", "#ff9100", "#ffab40", "#ffe082", "#ff6d00"];
    const emojis = ["🍺", "🍻", "🥂", "🎉", "⭐", "✨"];

    for (let i = 0; i < 20; i++) {
        const particle = document.createElement("div");
        particle.className = "hh-particle";

        const isEmoji = Math.random() > 0.6;
        if (isEmoji) {
            particle.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            particle.style.fontSize = `${16 + Math.random() * 20}px`;
            particle.style.lineHeight = "1";
        } else {
            const size = 4 + Math.random() * 8;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.background = colors[Math.floor(Math.random() * colors.length)];
            particle.style.boxShadow = `0 0 ${size * 2}px ${colors[Math.floor(Math.random() * colors.length)]}`;
        }

        particle.style.left = `${Math.random() * 100}%`;
        particle.style.animationDuration = `${6 + Math.random() * 10}s`;
        particle.style.animationDelay = `${Math.random() * 8}s`;

        hhParticles.appendChild(particle);
    }
}

function clearParticles() {
    hhParticles.innerHTML = "";
    particlesSpawned = false;
}

function updateCrashVisual(active, status) {
    if (active && status && status.crash_end) {
        document.body.classList.add("market-crash");
        const crashEndTime = new Date(status.crash_end);
        const [h, m] = [crashEndTime.getHours(), crashEndTime.getMinutes()];

        crashContainer.innerHTML = `
            <div class="crash-banner">
                🚨 MARKET CRASH HASTA LAS ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} 🚨
            </div>
        `;
    } else {
        document.body.classList.remove("market-crash");
        crashContainer.innerHTML = "";
    }
}

// ─── Render price board ─────────────────────────────────────────────────────────
// ─── Chart Instances State ────────────────────────────────────────────────────────
const charts = {}; // Maps product_id -> { chart, series, container }

// ─── Render price board (Trading Cards & Charts) ──────────────────────────────────
async function initCharts() {
    // Clear and set up the grid
    priceTbody.innerHTML = "";

    for (const p of products) {
        // Ticker symbol logic: remove anything in parenthesis first
        const cleanName = p.name.replace(/\s*\(.*?\)\s*/g, '');
        const words = cleanName.split(' ');
        let symbol = words.length > 1
            ? words.map(w => w[0]).join('').toUpperCase().substring(0, 4)
            : cleanName.substring(0, 4).toUpperCase();
        if (symbol.length < 3) symbol = cleanName.substring(0, 3).toUpperCase();

        // Create card container
        const card = document.createElement('div');
        card.className = `trading-card ${p.stock === 0 ? 'out-of-stock' : 'neutral'}`;
        card.id = `card-${p.id}`;

        const header = document.createElement('div');
        header.className = 'tc-header';
        header.innerHTML = `
            <div class="tc-product-info">
                <div class="tc-symbol-row">
                    <span class="product-emoji-small">${p.emoji}</span>
                    <span class="tc-symbol">${symbol}</span>
                </div>
                <!-- Remove parenthesis block to keep it clean and prevent cut offs -->
                <span class="tc-name">${cleanName}</span>
            </div>
            <div class="tc-price-info">
                <span class="tc-price" id="price-${p.id}">${formatPrice(p.current_price)}</span>
                <span class="tc-change" id="change-${p.id}">0.0%</span>
            </div>
        `;

        const chartWrapper = document.createElement('div');
        chartWrapper.className = 'tc-chart';
        chartWrapper.id = `chart-container-${p.id}`;

        card.appendChild(header);
        card.appendChild(chartWrapper);
        priceTbody.appendChild(card);

        // Init Lightweight Chart
        const chartOptions = {
            layout: {
                textColor: '#cccccc',
                background: { type: 'solid', color: 'transparent' }
            },
            grid: {
                vertLines: { color: '#111111' },
                horzLines: { color: '#111111' }
            },
            rightPriceScale: {
                borderVisible: false,
            },
            timeScale: {
                borderVisible: false,
                timeVisible: true,
                secondsVisible: false,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            }
        };

        const chart = LightweightCharts.createChart(chartWrapper, chartOptions);

        // Lightweight Charts v5 API
        const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#00ff00',
            downColor: '#ff0000',
            borderVisible: false,
            wickUpColor: '#00ff00',
            wickDownColor: '#ff0000'
        });

        charts[p.id] = { chart, series, cardEl: card, priceEl: document.getElementById(`price-${p.id}`), changeEl: document.getElementById(`change-${p.id}`) };

        // Fetch historical data asynchronously without blocking the loop
        fetch(`/api/products/${p.id}/candles?minutes=30`)
            .then(resp => {
                if (resp.ok) return resp.json();
                throw new Error("Bad response");
            })
            .then(data => {
                series.setData(data);
                chart.timeScale().fitContent();
            })
            .catch(e => console.error("Failed to load history for", p.name, e));

        // Handle Resize
        new ResizeObserver(entries => {
            if (entries.length === 0 || entries[0].target !== chartWrapper) return;
            const newRect = entries[0].contentRect;
            chart.applyOptions({ height: newRect.height, width: newRect.width });
        }).observe(chartWrapper);
    }
}

function updatePriceBoard() {
    if (Object.keys(charts).length === 0 && products.length > 0) {
        initCharts();
        return;
    }

    products.forEach((p) => {
        const c = charts[p.id];
        if (!c) return;

        const prev = previousPrices[p.id] ?? p.base_price;
        const diff = p.current_price - prev;
        const pctChange = prev > 0 ? ((diff / prev) * 100) : 0;

        let trend = "neutral";
        if (diff > 0) trend = "up";
        else if (diff < 0) trend = "down";

        // Update DOM texts
        c.cardEl.className = `trading-card ${trend} ${p.stock === 0 ? 'out-of-stock' : ''}`;

        const changeSign = diff > 0 ? "+" : "";
        const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";

        c.priceEl.textContent = formatPrice(p.current_price);
        c.priceEl.className = `tc-price ${trend}`;

        c.changeEl.textContent = `${arrow} ${Math.abs(pctChange).toFixed(1)}%`;
        c.changeEl.className = `tc-change ${trend}`;

        // Flash animation
        if (prev !== p.current_price && previousPrices[p.id] !== undefined) {
            c.cardEl.classList.remove('flash-up', 'flash-down');
            // Force reflow
            void c.cardEl.offsetWidth;
            c.cardEl.classList.add(trend === 'up' ? 'flash-up' : 'flash-down');
        }

        // Add candle dynamically if price changed
        const nowSecs = Math.floor(Date.now() / 1000);
        // We get the last candle open to simulate a real-time tick in the current bucket
        const data = c.series.data();
        let lastCandle = data && data.length > 0 ? data[data.length - 1] : null;

        if (lastCandle) {
            // Update the tip of the candle
            const newCandle = {
                time: lastCandle.time, // Same time bucket
                open: lastCandle.open,
                high: Math.max(lastCandle.high, p.current_price),
                low: Math.min(lastCandle.low, p.current_price),
                close: p.current_price
            };
            c.series.update(newCandle);
        }
    });
}

// ─── Render ticker tape ─────────────────────────────────────────────────────────
function renderTicker() {
    if (!products || !Array.isArray(products) || products.length === 0) return;

    // Duplicate content for seamless looping
    const items = products
        .map((p) => {
            const prev = previousPrices[p.id] ?? p.base_price;
            const diff = p.current_price - prev;
            const pct = prev > 0 ? ((diff / prev) * 100).toFixed(1) : "0.0";
            const sign = diff >= 0 ? "+" : "";
            const trend = diff > 0 ? "up" : diff < 0 ? "down" : "neutral";
            const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";

            const cleanName = p.name.replace(/\s*\(.*?\)\s*/g, '');
            const words = cleanName.split(' ');
            let symbol = words.length > 1
                ? words.map(w => w[0]).join('').toUpperCase().substring(0, 4)
                : cleanName.substring(0, 4).toUpperCase();
            if (symbol.length < 3) symbol = cleanName.substring(0, 3).toUpperCase();

            return `<span class="ticker-item ${trend}"><span class="product-emoji-small">${p.emoji}</span> ${symbol} ${formatPrice(p.current_price)} ${arrow} ${sign}${pct}%</span>`;
        })
        .join("");

    tickerContent.innerHTML = items + items; // Duplicate for seamless scroll
}

// ─── Render ticker tape ─────────────────────────────────────────────────────────

function updateCrash(isActive) {
    isCrash = isActive;
}

// ─── WebSocket ──────────────────────────────────────────────────────────────────
function connectWebSocket() {
    ws = new WebSocket(`${WS_BASE}/ws/prices`);

    ws.onopen = () => {
        wsStatus.classList.remove("disconnected");
    };

    ws.onclose = () => {
        wsStatus.classList.add("disconnected");
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
        wsStatus.classList.add("disconnected");
    };

    ws.onmessage = (event) => {
        if (event.data === "pong") return;
        const data = JSON.parse(event.data);

        if (data.type === "initial" || data.type === "price_update") {
            // Store previous prices before update
            products.forEach((p) => {
                previousPrices[p.id] = p.current_price;
            });

            products = data.products;
            updatePriceBoard();
            renderTicker();

            if (data.status) {
                updateCrash(data.status.crash_active);
                updateCrashVisual(data.status.crash_active, data.status);
            }

            // Reset countdown on price update
            if (data.type === "price_update") {
                countdown = RECALC_INTERVAL;
            }
        }

        if (data.type === "stock_update") {
            if (data.products && Array.isArray(data.products)) {
                products = data.products;
            } else if (data.product) {
                const idx = products.findIndex((p) => p.id === data.product.id);
                if (idx !== -1) products[idx] = data.product;
            }
            updatePriceBoard();
            renderTicker();
        }
    };

    // Ping to keep alive
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
        }
    }, 30000);
}

// ─── Auto Scroll ──────────────────────────────────────────────────────────────────
let scrollDirection = 1;
const scrollSpeed = 0.5; // pixels per frame
let isScrolling = true;

function autoScroll() {
    const board = document.querySelector(".price-board");
    if (!board || !isScrolling) {
        requestAnimationFrame(autoScroll);
        return;
    }

    if (board.scrollHeight > board.clientHeight) {
        board.scrollTop += scrollSpeed * scrollDirection;

        // Reached bottom
        if (Math.ceil(board.scrollTop + board.clientHeight) >= board.scrollHeight) {
            isScrolling = false;
            scrollDirection = -1;
            setTimeout(() => {
                isScrolling = true;
                requestAnimationFrame(autoScroll);
            }, 3000); // pause at bottom
            return;
        }

        // Reached top
        if (board.scrollTop <= 0) {
            isScrolling = false;
            scrollDirection = 1;
            setTimeout(() => {
                isScrolling = true;
                requestAnimationFrame(autoScroll);
            }, 3000); // pause at top
            return;
        }
    }

    requestAnimationFrame(autoScroll);
}

// ─── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    connectWebSocket();
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(updateCountdown, 1000);

    // Initial scroll trigger with slight delay to allow rendering
    setTimeout(() => {
        requestAnimationFrame(autoScroll);
    }, 2000);

    // Enter fullscreen on click (for TV setup)
    document.addEventListener("click", () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => { });
        }
    });
});

