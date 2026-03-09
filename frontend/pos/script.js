/* ──────────────────────────────────────────────────────────────────────────────
   Bar Wall Street - POS (Caja) Script
   ────────────────────────────────────────────────────────────────────────────── */

const API_BASE = window.location.origin;
const WS_BASE = `ws://${window.location.host}`;

// ─── State ──────────────────────────────────────────────────────────────────────
let products = [];
let cart = [];
let previousPrices = {};
let activeCategory = "all";
let ws = null;

// ─── DOM refs ───────────────────────────────────────────────────────────────────
const productsGrid = document.getElementById("products-grid");
const cartItems = document.getElementById("cart-items");
const cartEmpty = document.getElementById("cart-empty");
const cartTotal = document.getElementById("cart-total");
const checkoutBtn = document.getElementById("checkout-btn");
const clearCartBtn = document.getElementById("clear-cart-btn");
const categoryFilters = document.getElementById("category-filters");
const statusBadge = document.getElementById("status-badge");
const statusText = document.getElementById("status-text");
const clockEl = document.getElementById("clock");
const adminToggle = document.getElementById("admin-toggle");
const adminOverlay = document.getElementById("admin-overlay");
const adminClose = document.getElementById("admin-close");
const adminStockList = document.getElementById("admin-stock-list");
const forceRecalcBtn = document.getElementById("force-recalc-btn");
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toast-message");

// New DOM refs
const adminSalesSummary = document.getElementById("admin-sales-summary");
const adminSalesHistory = document.getElementById("admin-sales-history");
const closeCashierBtn = document.getElementById("close-cashier-btn");
const adminSessionsList = document.getElementById("admin-sessions-list");
const backupNowBtn = document.getElementById("backup-now-btn");
const adminBackupList = document.getElementById("admin-backup-list");
const cashierModal = document.getElementById("cashier-modal");
const cashierModalBody = document.getElementById("cashier-modal-body");
const cashierModalClose = document.getElementById("cashier-modal-close");
const cashierCancelBtn = document.getElementById("cashier-cancel-btn");
const cashierConfirmBtn = document.getElementById("cashier-confirm-btn");
const cashierNotes = document.getElementById("cashier-notes");

const openCashierBtn = document.getElementById("open-cashier-btn");
const openCashierModal = document.getElementById("open-cashier-modal");
const openCashierModalClose = document.getElementById("open-cashier-modal-close");
const openCashierCancelBtn = document.getElementById("open-cashier-cancel-btn");
const openCashierConfirmBtn = document.getElementById("open-cashier-confirm-btn");
const openCashierDate = document.getElementById("open-cashier-date");

// New DOM refs for QR
const showQrBtn = document.getElementById("show-qr-btn");
const qrModal = document.getElementById("qr-modal");
const qrModalClose = document.getElementById("qr-modal-close");
const qrcodeContainer = document.getElementById("qrcode-container");
const triggerCrashBtn = document.getElementById("trigger-crash-btn");

// DOM refs for Startup
const startupOverlay = document.getElementById("startup-overlay");
const startupDate = document.getElementById("startup-date");
const startupOpenBtn = document.getElementById("startup-open-btn");
const startupContinueBtn = document.getElementById("startup-continue-btn");
const qrLinkText = document.getElementById("qr-link-text");
const qrPrintBtn = document.getElementById("qr-print-btn");

// DOM refs for Login
const posLoginOverlay = document.getElementById("pos-login-overlay");
const posLoginForm = document.getElementById("pos-login-form");
const posLoginPin = document.getElementById("pos-login-pin");
const posLoginBtn = document.getElementById("pos-login-btn");
const loginError = document.getElementById("login-error");


// ─── Helpers ────────────────────────────────────────────────────────────────────
function formatPrice(price) {
    return "$" + Math.round(price).toLocaleString("es-AR");
}

function showToast(message, duration = 3000) {
    toastMessage.textContent = message;
    toast.classList.remove("hidden", "hide");
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
        toast.classList.add("hide");
        setTimeout(() => toast.classList.add("hidden"), 300);
    }, duration);
}

function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) +
        " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    return (bytes / 1024).toFixed(0) + " KB";
}

// ─── Products rendering ─────────────────────────────────────────────────────────
function renderProducts() {
    const filtered =
        activeCategory === "all"
            ? products
            : products.filter((p) => p.category === activeCategory);

    productsGrid.innerHTML = filtered
        .map((p) => {
            const prev = previousPrices[p.id];
            let trendClass = "neutral";
            let trendIcon = "";

            if (prev !== undefined && prev !== p.current_price) {
                trendClass = p.current_price > prev ? "up" : "down";
                trendIcon = p.current_price > prev ? "▲" : "▼";
            }

            const stockClass =
                p.stock === 0 ? "out" : p.stock <= 5 ? "low" : "";
            const cardClass =
                p.stock === 0 ? "product-card out-of-stock" : "product-card";
            const flashClass =
                prev !== undefined && prev !== p.current_price
                    ? p.current_price > prev
                        ? "price-flash-up"
                        : "price-flash-down"
                    : "";

            const stockDisplay = p.stock === 0 ? "AGOTADO" : p.stock > 900000 ? "Stock: ∞" : `Stock: ${p.stock}`;

            return `
                <article class="${cardClass} ${flashClass}" data-id="${p.id}" role="listitem" onclick="addToCart(${p.id})">
                    <span class="product-emoji">${p.emoji}</span>
                    <span class="product-name">${p.name}</span>
                    <div class="product-price-row">
                        <span class="product-price ${trendClass}">${formatPrice(p.current_price)}</span>
                        <span class="product-trend ${trendClass}">${trendIcon}</span>
                    </div>
                    <span class="product-stock ${stockClass}">
                        ${stockDisplay}
                    </span>
                </article>
            `;
        })
        .join("");
}

function renderCategoryFilters() {
    const categories = [...new Set(products.map((p) => p.category))];
    categoryFilters.innerHTML =
        `<button class="filter-btn ${activeCategory === "all" ? "active" : ""}" data-category="all" role="tab" aria-selected="${activeCategory === "all"}">Todos</button>` +
        categories
            .map(
                (cat) =>
                    `<button class="filter-btn ${activeCategory === cat ? "active" : ""}" data-category="${cat}" role="tab" aria-selected="${activeCategory === cat}">${cat}</button>`
            )
            .join("");
}

categoryFilters.addEventListener("click", (e) => {
    if (e.target.classList.contains("filter-btn")) {
        activeCategory = e.target.dataset.category;
        renderCategoryFilters();
        renderProducts();
    }
});

// ─── Cart logic ─────────────────────────────────────────────────────────────────
function addToCart(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product || product.stock === 0) return;

    const existing = cart.find((item) => item.product_id === productId);
    if (existing) {
        if (existing.quantity >= product.stock) {
            showToast(`⚠️ Stock máximo alcanzado para ${product.name}`);
            return;
        }
        existing.quantity++;
    } else {
        cart.push({ product_id: productId, quantity: 1 });
    }

    renderCart();
}

function removeFromCart(productId) {
    const idx = cart.findIndex((item) => item.product_id === productId);
    if (idx === -1) return;

    cart[idx].quantity--;
    if (cart[idx].quantity <= 0) {
        cart.splice(idx, 1);
    }

    renderCart();
}

function clearCart() {
    cart = [];
    renderCart();
}

function renderCart() {
    const hasItems = cart.length > 0;
    cartEmpty.style.display = hasItems ? "none" : "flex";
    checkoutBtn.disabled = !hasItems;

    if (!hasItems) {
        const items = cartItems.querySelectorAll(".cart-item");
        items.forEach((item) => item.remove());
        cartTotal.textContent = "$0";
        return;
    }

    let total = 0;
    const itemsHTML = cart
        .map((item) => {
            const product = products.find((p) => p.id === item.product_id);
            if (!product) return "";
            const subtotal = product.current_price * item.quantity;
            total += subtotal;

            return `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${product.emoji} ${product.name}</div>
                        <div class="cart-item-price">${formatPrice(product.current_price)} c/u</div>
                    </div>
                    <div class="cart-item-controls">
                        <button class="btn-qty" onclick="removeFromCart(${product.id})" aria-label="Quitar uno">−</button>
                        <input type="number" class="cart-qty-input" value="${item.quantity}" min="1" max="${product.stock}" onchange="updateCartQty(${product.id}, this.value)" />
                        <button class="btn-qty" onclick="addToCart(${product.id})" aria-label="Agregar uno">+</button>
                    </div>
                    <span class="cart-item-subtotal">${formatPrice(subtotal)}</span>
                </div>
            `;
        })
        .join("");

    const existingItems = cartItems.querySelectorAll(".cart-item");
    existingItems.forEach((item) => item.remove());
    cartEmpty.insertAdjacentHTML("beforebegin", itemsHTML);

    cartTotal.textContent = formatPrice(total);
}

clearCartBtn.addEventListener("click", clearCart);

function updateCartQty(productId, newQty) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    let qty = parseInt(newQty);
    if (isNaN(qty) || qty < 1) {
        qty = 1;
    }

    if (qty > product.stock) {
        qty = product.stock;
        showToast(`⚠️ Stock máximo alcanzado para ${product.name} (${product.stock})`);
    }

    const idx = cart.findIndex((item) => item.product_id === productId);
    if (idx !== -1) {
        cart[idx].quantity = qty;
        renderCart();
    }
}

// ─── Checkout ───────────────────────────────────────────────────────────────────
checkoutBtn.addEventListener("click", async () => {
    if (cart.length === 0) return;

    checkoutBtn.disabled = true;
    checkoutBtn.textContent = "Procesando...";

    try {
        const res = await fetch(`${API_BASE}/api/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: cart }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Error al procesar el pedido");
        }

        const data = await res.json();
        showToast(`✅ Pedido cobrado: ${formatPrice(data.total)}`);
        cart = [];
        renderCart();

        await fetchProducts();
    } catch (err) {
        showToast(`❌ ${err.message}`);
    } finally {
        checkoutBtn.disabled = cart.length === 0;
        checkoutBtn.textContent = "Cobrar";
    }
});

// ─── Admin panel ────────────────────────────────────────────────────────────────
adminToggle.addEventListener("click", () => {
    const pin = prompt("Ingrese PIN de Administrador (1234):");
    if (!pin) return;

    fetch(`${API_BASE}/api/auth/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
    })
        .then(async (res) => {
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail);
            }
            adminOverlay.classList.remove("hidden");
            renderAdminStock();
            loadSalesSummary();
            loadSalesHistory();
            loadCashierSessions();
            loadBackups();
            loadFacturapiReceipts();
        })
        .catch((err) => {
            showToast(`❌ ${err.message}`);
        });
});

adminClose.addEventListener("click", () => {
    adminOverlay.classList.add("hidden");
});

adminOverlay.addEventListener("click", (e) => {
    if (e.target === adminOverlay) {
        adminOverlay.classList.add("hidden");
    }
});

function renderAdminStock() {
    adminStockList.innerHTML = products
        .map(
            (p) => `
        <div class="admin-stock-item">
            <span class="product-emoji">${p.emoji}</span>
            <span class="admin-stock-name">${p.name}</span>
            <input type="number" class="admin-stock-input" id="stock-input-${p.id}" value="${p.stock}" min="0">
            <button class="admin-stock-btn" onclick="updateStock(${p.id})">Guardar</button>
        </div>
    `
        )
        .join("");
}

async function updateStock(productId) {
    const input = document.getElementById(`stock-input-${productId}`);
    const newStock = parseInt(input.value);
    if (isNaN(newStock) || newStock < 0) return;

    try {
        await fetch(`${API_BASE}/api/products/${productId}/stock`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stock: newStock }),
        });
        showToast("📦 Stock actualizado");
    } catch (err) {
        showToast("❌ Error al actualizar stock");
    }
}

window.updateStock = updateStock;

forceRecalcBtn.addEventListener("click", async () => {
    forceRecalcBtn.disabled = true;
    forceRecalcBtn.textContent = "Recalculando...";
    try {
        await fetch(`${API_BASE}/api/recalculate`, { method: "POST" });
        showToast("🔄 Precios recalculados");
    } catch (err) {
        showToast("❌ Error al recalcular");
    } finally {
        forceRecalcBtn.disabled = false;
        forceRecalcBtn.textContent = "Recalcular Precios Ahora";
    }
});

// ─── Sales History ──────────────────────────────────────────────────────────────
async function loadSalesSummary() {
    try {
        const res = await fetch(`${API_BASE}/api/sales/summary`);
        const data = await res.json();

        let topProductsHTML = "";
        if (data.top_products && data.top_products.length > 0) {
            topProductsHTML = `
                <h4 style="font-size:0.75rem; color:var(--text-muted); margin-bottom:var(--space-2); margin-top:var(--space-3);">TOP PRODUCTOS</h4>
                <div class="top-products">
                    ${data.top_products.map((p, i) => `
                        <div class="top-product-item">
                            <span class="top-product-rank">#${i + 1}</span>
                            <span>${p.emoji}</span>
                            <span class="top-product-name">${p.name}</span>
                            <span class="top-product-revenue">${formatPrice(p.revenue)}</span>
                        </div>
                    `).join("")}
                </div>
            `;
        }

        adminSalesSummary.innerHTML = `
            <div class="summary-cards">
                <div class="summary-card">
                    <span class="summary-card-value">${formatPrice(data.total_revenue)}</span>
                    <span class="summary-card-label">Recaudado</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-value">${data.total_orders}</span>
                    <span class="summary-card-label">Pedidos</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-value">${data.total_items}</span>
                    <span class="summary-card-label">Items vendidos</span>
                </div>
            </div>
            ${topProductsHTML}
        `;
    } catch (err) {
        adminSalesSummary.innerHTML = `<p class="sales-empty">Error cargando resumen</p>`;
    }
}

async function loadSalesHistory() {
    try {
        const res = await fetch(`${API_BASE}/api/sales/history?limit=30`);
        const sales = await res.json();

        if (sales.length === 0) {
            adminSalesHistory.innerHTML = `<p class="sales-empty">No hay ventas registradas</p>`;
            return;
        }

        adminSalesHistory.innerHTML = `
            <table class="sales-table">
                <thead>
                    <tr>
                        <th>Producto</th>
                        <th>Cant.</th>
                        <th>Precio</th>
                        <th>Total</th>
                        <th>Hora</th>
                    </tr>
                </thead>
                <tbody>
                    ${sales.map(s => `
                        <tr>
                            <td>${s.product_emoji} ${s.product_name}</td>
                            <td>${s.quantity}</td>
                            <td>${formatPrice(s.price_at_sale)}</td>
                            <td class="sale-total">${formatPrice(s.total)}</td>
                            <td class="sale-time">${formatTime(s.timestamp)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (err) {
        adminSalesHistory.innerHTML = `<p class="sales-empty">Error cargando historial</p>`;
    }
}

// ─── Cashier Close ──────────────────────────────────────────────────────────────
closeCashierBtn.addEventListener("click", async () => {
    const pin = prompt("Ingrese PIN de Administrador (1234) para cerrar caja:");
    if (!pin) return;

    try {
        const pinRes = await fetch(`${API_BASE}/api/auth/verify-pin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin }),
        });

        if (!pinRes.ok) {
            throw new Error("PIN incorrecto");
        }

        const res = await fetch(`${API_BASE}/api/sales/summary`);
        const summary = await res.json();

        if (summary.total_orders === 0) {
            showToast("⚠️ No hay ventas para cerrar");
            return;
        }

        // Show modal with summary
        cashierModalBody.innerHTML = `
            <div class="summary-cards">
                <div class="summary-card">
                    <span class="summary-card-value">${formatPrice(summary.total_revenue)}</span>
                    <span class="summary-card-label">Total recaudado</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-value">${summary.total_orders}</span>
                    <span class="summary-card-label">Pedidos</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-value">${summary.total_items}</span>
                    <span class="summary-card-label">Items</span>
                </div>
            </div>
            ${summary.top_products && summary.top_products.length > 0 ? `
                <h4 style="font-size:0.75rem; color:var(--text-muted); margin:var(--space-3) 0 var(--space-2);">TOP PRODUCTOS</h4>
                <div class="top-products">
                    ${summary.top_products.map((p, i) => `
                        <div class="top-product-item">
                            <span class="top-product-rank">#${i + 1}</span>
                            <span>${p.emoji}</span>
                            <span class="top-product-name">${p.name} (×${p.quantity})</span>
                            <span class="top-product-revenue">${formatPrice(p.revenue)}</span>
                        </div>
                    `).join("")}
                </div>
            ` : ""}
            <p style="color:var(--accent-red); font-size:0.8rem; margin-top:var(--space-4); font-weight:600;">
                ⚠️ Esta acción archiva todas las ventas actuales y no se puede deshacer.
            </p>
        `;

        cashierNotes.value = "";
        cashierModal.classList.remove("hidden");
    } catch (err) {
        showToast(`❌ ${err.message || "Error cargando resumen"}`);
    }
});

cashierModalClose.addEventListener("click", () => {
    cashierModal.classList.add("hidden");
});

cashierCancelBtn.addEventListener("click", () => {
    cashierModal.classList.add("hidden");
});

cashierModal.addEventListener("click", (e) => {
    if (e.target === cashierModal) {
        cashierModal.classList.add("hidden");
    }
});

cashierConfirmBtn.addEventListener("click", async () => {
    cashierConfirmBtn.disabled = true;
    cashierConfirmBtn.textContent = "Cerrando...";

    try {
        const res = await fetch(`${API_BASE}/api/cashier/close`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: cashierNotes.value }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Error al cerrar caja");
        }

        const data = await res.json();
        let toastMsg = `💰 Caja cerrada — Total: ${formatPrice(data.session.total_revenue)}`;

        // Mostrar info de la factura global si se emitió
        if (data.factura_global && data.factura_global.emitida) {
            const fg = data.factura_global;
            toastMsg += ` | 🧾 Factura #${fg.folio}`;
            showToast(toastMsg, 6000);
            const resultDiv = document.getElementById('factura-global-result');
            if (resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = `
                    <strong style="color: var(--color-green);">✅ Factura Global emitida automáticamente</strong><br>
                    <span style="font-size:0.85rem;">Folio: <strong>#${fg.folio}</strong></span>
                    ${fg.pdf_url ? `<br><a href="${fg.pdf_url}" target="_blank" style="color: var(--color-green); font-size:0.85rem;">📥 Descargar PDF</a>` : ''}
                `;
            }
        } else {
            showToast(toastMsg);
        }

        cashierModal.classList.add("hidden");

        // Refresh admin panel data
        loadSalesSummary();
        loadSalesHistory();
        loadCashierSessions();
        loadFacturapiReceipts();
    } catch (err) {
        showToast(`❌ ${err.message}`);
    } finally {
        cashierConfirmBtn.disabled = false;
        cashierConfirmBtn.textContent = "Confirmar Cierre";
    }
});

openCashierBtn.addEventListener("click", () => {
    const pin = prompt("Ingrese PIN de Administrador (1234) para abrir caja:");
    if (!pin) return;

    fetch(`${API_BASE}/api/auth/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
    })
        .then(async (res) => {
            if (!res.ok) {
                throw new Error("PIN incorrecto");
            }

            const now = new Date();
            openCashierDate.value = now.toLocaleDateString("es-AR") + " " + now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

            openCashierModal.classList.remove("hidden");
        })
        .catch(err => {
            showToast(`❌ ${err.message}`);
        });
});

openCashierModalClose.addEventListener("click", () => {
    openCashierModal.classList.add("hidden");
});

openCashierCancelBtn.addEventListener("click", () => {
    openCashierModal.classList.add("hidden");
});

openCashierModal.addEventListener("click", (e) => {
    if (e.target === openCashierModal) {
        openCashierModal.classList.add("hidden");
    }
});

openCashierConfirmBtn.addEventListener("click", async () => {
    openCashierConfirmBtn.disabled = true;
    openCashierConfirmBtn.textContent = "Abriendo...";

    try {
        const res = await fetch(`${API_BASE}/api/cashier/open`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Error al abrir caja");
        }

        showToast("☀️ Caja abierta. Precios e historial reseteados.");
        openCashierModal.classList.add("hidden");

        const today = new Date().toLocaleDateString("es-AR");
        localStorage.setItem("day_started", today);

        loadSalesSummary();
        loadSalesHistory();
        loadCashierSessions();
    } catch (err) {
        showToast(`❌ ${err.message}`);
    } finally {
        openCashierConfirmBtn.disabled = false;
        openCashierConfirmBtn.textContent = "Confirmar Apertura";
    }
});

async function loadCashierSessions() {
    try {
        const res = await fetch(`${API_BASE}/api/cashier/sessions`);
        const sessions = await res.json();

        if (sessions.length === 0) {
            adminSessionsList.innerHTML = `<p class="sales-empty" style="padding:var(--space-3)">Sin cierres anteriores</p>`;
            return;
        }

        adminSessionsList.innerHTML = `
            <h4 style="font-size:0.7rem; color:var(--text-muted); margin-bottom:var(--space-2);">CIERRES ANTERIORES</h4>
            ${sessions.map(s => `
                <div class="session-card">
                    <div class="session-card-header">
                        <span class="session-card-date">${formatDateTime(s.opened_at)} → ${formatDateTime(s.closed_at)}</span>
                        <span class="session-card-total">${formatPrice(s.total_revenue)}</span>
                    </div>
                    <div class="session-card-details">
                        <span>${s.total_orders} pedidos</span>
                        <span>${s.total_items} items</span>
                    </div>
                    ${s.notes ? `<div class="session-card-notes">"${s.notes}"</div>` : ""}
                </div>
            `).join("")}
        `;
    } catch (err) {
        adminSessionsList.innerHTML = `<p class="sales-empty">Error cargando sesiones</p>`;
    }
}

// ─── Backup ─────────────────────────────────────────────────────────────────────
backupNowBtn.addEventListener("click", async () => {
    backupNowBtn.disabled = true;
    backupNowBtn.textContent = "Creando backup...";

    try {
        const res = await fetch(`${API_BASE}/api/backup/now`, { method: "POST" });
        if (!res.ok) throw new Error("Error");
        const data = await res.json();
        showToast(`💾 Backup creado: ${data.filename}`);
        loadBackups();
    } catch (err) {
        showToast("❌ Error al crear backup");
    } finally {
        backupNowBtn.disabled = false;
        backupNowBtn.textContent = "Crear Backup Ahora";
    }
});

async function loadBackups() {
    try {
        const res = await fetch(`${API_BASE}/api/backup/list`);
        const backups = await res.json();

        if (backups.length === 0) {
            adminBackupList.innerHTML = `<p class="sales-empty" style="padding:var(--space-3)">Sin backups</p>`;
            return;
        }

        adminBackupList.innerHTML = backups.map(b => `
            <div class="backup-item">
                <span class="backup-name">💾 ${b.filename}</span>
                <span class="backup-meta">${formatBytes(b.size_bytes)} · ${formatDateTime(b.created_at)}</span>
            </div>
        `).join("");
    } catch (err) {
        adminBackupList.innerHTML = `<p class="sales-empty">Error cargando backups</p>`;
    }
}

// ─── QR Code Logic ──────────────────────────────────────────────────────────────
let qrCodeInstance = null;

if (triggerCrashBtn) {
    triggerCrashBtn.addEventListener("click", async () => {
        if (!confirm("⚠️ ¿Deseas forzar un Market Crash ahora mismo?\n\nLos precios caerán al mínimo por 20 minutos.\nSOLO SE PUEDE HACER UNA VEZ POR JORNADA.")) {
            return;
        }

        try {
            triggerCrashBtn.disabled = true;
            const res = await fetch(`${API_BASE}/api/crash/trigger`, { method: "POST" });

            if (!res.ok) {
                let errorText = "Error al iniciar Crash";
                try {
                    const errorJson = await res.json();
                    errorText = errorJson.detail || errorText;
                } catch (e) {
                    errorText = `Error ${res.status}: Servidor no devolvió JSON`;
                }
                throw new Error(errorText);
            }

            const result = await res.json();
            if (result.success) {
                showToast("💥 Market Crash iniciado");
            }
        } catch (e) {
            console.error("Crash error", e);
            alert(e.message || "Error al forzar Crash");
        } finally {
            triggerCrashBtn.disabled = false;
        }
    });
}

showQrBtn.addEventListener("click", async () => {
    try {
        showQrBtn.disabled = true;
        const res = await fetch(`${API_BASE}/api/config`);
        if (!res.ok) throw new Error("No se pudo obtener la config");
        const config = await res.json();

        // Build the URL using the local IP
        const menuUrl = `http://${config.local_ip}:${config.port}/menu`;

        qrLinkText.textContent = menuUrl;

        if (qrCodeInstance) {
            qrCodeInstance.clear();
            qrCodeInstance.makeCode(menuUrl);
        } else {
            // qrcode.js should be loaded globally
            qrCodeInstance = new QRCode(qrcodeContainer, {
                text: menuUrl,
                width: 256,
                height: 256,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        }

        qrModal.classList.remove("hidden");
    } catch (err) {
        showToast(`❌ Error al cargar QR: ${err.message}`);
    } finally {
        showQrBtn.disabled = false;
    }
});

qrModalClose.addEventListener("click", () => {
    qrModal.classList.add("hidden");
});

qrModal.addEventListener("click", (e) => {
    if (e.target === qrModal) {
        qrModal.classList.add("hidden");
    }
});

qrPrintBtn.addEventListener("click", () => {
    // Open a new window with just the QR code to print
    const printWindow = window.open('', '_blank');
    const qrImage = qrcodeContainer.querySelector('img');
    // qrcode.js usually creates a canvas and an img. We try to use the img src or canvas toDataURL
    let qrSrc = '';
    if (qrImage && qrImage.src) {
        qrSrc = qrImage.src;
    } else {
        const canvas = qrcodeContainer.querySelector('canvas');
        if (canvas) {
            qrSrc = canvas.toDataURL("image/png");
        }
    }

    // We add a short timeout to let the print window render the image
    printWindow.document.write(`
        <html>
            <head>
                <title>Imprimir QR</title>
                <style>
                    body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
                    h1 { margin-bottom: 2rem; font-size: 3rem; text-align: center; text-transform: uppercase; }
                    img { width: 400px; height: 400px; }
                    h2 { margin-top: 2rem; text-align: center; }
                    p { text-align: center; color: #555; }
                </style>
            </head>
            <body>
                <h1>Bar Wall Street</h1>
                <h2>Escaneá y mirá los precios en vivo</h2>
                <img src="${qrSrc}" alt="Menú QR" />
                <p>O entrá a:<br><b>${qrLinkText.textContent}</b></p>
                <script>
                    window.onload = () => {
                        window.print();
                    };
                </script>
            </body>
        </html>
    `);
    printWindow.document.close();
});

// ─── API fetch ──────────────────────────────────────────────────────────────────
async function fetchProducts() {
    try {
        const res = await fetch(`${API_BASE}/api/products`);
        const data = await res.json();

        products.forEach((p) => {
            previousPrices[p.id] = p.current_price;
        });

        products = data;
        renderProducts();
        renderCategoryFilters();
    } catch (err) {
        console.error("Error fetching products:", err);
    }
}

// ─── WebSocket ──────────────────────────────────────────────────────────────────
function connectWebSocket() {
    ws = new WebSocket(`${WS_BASE}/ws/prices`);

    ws.onopen = () => {
        statusBadge.classList.remove("disconnected");
        statusText.textContent = "Conectado";
    };

    ws.onclose = () => {
        statusBadge.classList.add("disconnected");
        statusText.textContent = "Desconectado";
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
        statusBadge.classList.add("disconnected");
        statusText.textContent = "Error";
    };

    ws.onmessage = (event) => {
        if (event.data === "pong") return;
        const data = JSON.parse(event.data);

        if (data.type === "initial" || data.type === "price_update") {
            products.forEach((p) => {
                previousPrices[p.id] = p.current_price;
            });

            products = data.products;
            renderProducts();
            renderCategoryFilters();
            renderCart();

            if (data.status) {
                if (data.status.crash_active) {
                    document.body.classList.add("market-crash");
                    if (!document.getElementById("crash-badge")) {
                        const cb = document.createElement("div");
                        cb.id = "crash-badge";
                        cb.className = "status-badge";
                        cb.style.cssText = "background-color: var(--red); color: white; margin-left: 10px;";
                        cb.textContent = "🔥 MARKET CRASH 🔥";
                        document.querySelector(".header-left").appendChild(cb);
                    }
                } else {
                    document.body.classList.remove("market-crash");
                    const cb = document.getElementById("crash-badge");
                    if (cb) cb.remove();
                }
            }

            if (data.type === "price_update") {
                showToast("📊 Precios actualizados");
            }
        }

        if (data.type === "stock_update") {
            if (data.products) {
                products = data.products;
            } else if (data.product) {
                const idx = products.findIndex((p) => p.id === data.product.id);
                if (idx !== -1) products[idx] = data.product;
            }
            renderProducts();
        }
    };

    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
        }
    }, 30000);
}

// ─── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    // POS Login Check
    if (localStorage.getItem("pos_auth") === "true") {
        posLoginOverlay.classList.add("hidden");
        initPOS();
    } else {
        posLoginOverlay.classList.remove("hidden");
        // Wait for login
    }
});

function initPOS() {
    fetchProducts();
    connectWebSocket();
    updateClock();
    setInterval(updateClock, 1000);

    // Startup logic
    const today = new Date().toLocaleDateString("es-AR");
    if (localStorage.getItem("day_started") !== today) {
        const now = new Date();
        if (startupDate) {
            startupDate.value = now.toLocaleDateString("es-AR") + " " + now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
        }
        if (startupOverlay) {
            startupOverlay.classList.remove("hidden");
        }
    }
}

// ─── POS Login Logic ────────────────────────────────────────────────────────────
if (posLoginForm) {
    posLoginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        posLoginBtn.disabled = true;
        posLoginBtn.textContent = "Verificando...";
        loginError.classList.add("hidden");

        const pin = posLoginPin.value;

        try {
            const res = await fetch(`${API_BASE}/api/auth/verify-pin`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Error validando PIN");
            }

            // Authentication clear
            localStorage.setItem("pos_auth", "true");
            posLoginOverlay.classList.add("hidden");
            posLoginPin.value = "";
            initPOS();

        } catch (err) {
            loginError.textContent = "PIN incorrecto";
            loginError.classList.remove("hidden");
            posLoginPin.value = "";
            posLoginPin.focus();
        } finally {
            posLoginBtn.disabled = false;
            posLoginBtn.textContent = "Ingresar";
        }
    });
}

if (startupContinueBtn) {
    startupContinueBtn.addEventListener("click", () => {
        const today = new Date().toLocaleDateString("es-AR");
        localStorage.setItem("day_started", today);
        startupOverlay.classList.add("hidden");
    });
}

if (startupOpenBtn) {
    startupOpenBtn.addEventListener("click", async () => {
        startupOpenBtn.disabled = true;
        startupOpenBtn.textContent = "Abriendo...";

        try {
            const res = await fetch(`${API_BASE}/api/cashier/open`, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Error al abrir caja");
            }

            showToast("☀️ Caja abierta. Precios e historial reseteados.");

            const today = new Date().toLocaleDateString("es-AR");
            localStorage.setItem("day_started", today);
            startupOverlay.classList.add("hidden");

            loadSalesSummary();
            loadSalesHistory();
            loadCashierSessions();
        } catch (err) {
            showToast(`❌ ${err.message}`);
        } finally {
            startupOpenBtn.disabled = false;
            startupOpenBtn.textContent = "☀️ Confirmar y Abrir Caja";
        }
    });
}

// ─── FacturAPI Panel ────────────────────────────────────────────────────────────
async function loadFacturapiReceipts() {
    const container = document.getElementById('factura-receipts-container');
    if (!container) return;
    container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem;">Cargando recibos...</p>';
    try {
        const res = await fetch(`${API_BASE}/api/factura/receipts`);
        if (!res.ok) throw new Error('Error al cargar recibos');
        const data = await res.json();
        const receipts = data.receipts || [];

        if (receipts.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem;">No hay recibos abiertos en FacturAPI.</p>';
            return;
        }

        container.innerHTML = `
            <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom: 8px;">
                ${receipts.length} recibo(s) abierto(s) — pendientes de factura global
            </p>
            <div style="display: flex; flex-direction: column; gap: 6px;">
                ${receipts.map(r => `
                    <div style="background:var(--bg-level-3); border-radius:6px; padding:8px 12px; font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
                        <span>📄 Recibo #${r.folio_number ?? r.id?.substring(0, 8)}</span>
                        <span style="color:var(--color-green); font-weight:600;">$${r.total?.toLocaleString('es-AR') ?? '—'}</span>
                        ${r.self_invoice_url ? `<a href="${r.self_invoice_url}" target="_blank" style="color:var(--accent-blue); font-size:0.75rem;">🔗 Link cliente</a>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<p style="color: var(--accent-red); font-size: 0.85rem;">Error cargando recibos de FacturAPI</p>`;
    }
}

const facturaGlobalBtn = document.getElementById('factura-global-btn');
const facturaRefreshBtn = document.getElementById('factura-refresh-btn');
const facturaGlobalResult = document.getElementById('factura-global-result');

if (facturaGlobalBtn) {
    facturaGlobalBtn.addEventListener('click', async () => {
        if (!confirm('¿Emitir Factura Global con todos los recibos abiertos del día?')) return;
        facturaGlobalBtn.disabled = true;
        facturaGlobalBtn.textContent = 'Emitiendo...';
        facturaGlobalResult.style.display = 'none';
        try {
            const res = await fetch(`${API_BASE}/api/factura/global`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ periodicity: 'day' }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Error al emitir factura global');
            }
            const data = await res.json();
            facturaGlobalResult.style.display = 'block';
            facturaGlobalResult.innerHTML = `
                <strong style="color: var(--color-green);">✅ Factura Global emitida</strong><br>
                <span style="font-size:0.85rem;">Folio: <strong>#${data.folio}</strong></span>
                ${data.pdf_url ? `<br><a href="${data.pdf_url}" target="_blank" style="color: var(--color-green); font-size:0.85rem;">📥 Descargar PDF</a>` : ''}
            `;
            showToast(`🧾 Factura global emitida — Folio #${data.folio}`, 5000);
            await loadFacturapiReceipts();
        } catch (err) {
            facturaGlobalResult.style.display = 'block';
            facturaGlobalResult.style.borderColor = 'var(--accent-red)';
            facturaGlobalResult.innerHTML = `<span style="color:var(--accent-red);">❌ ${err.message}</span>`;
            showToast(`❌ ${err.message}`);
        } finally {
            facturaGlobalBtn.disabled = false;
            facturaGlobalBtn.textContent = '📄 Emitir Factura Global';
        }
    });
}

if (facturaRefreshBtn) {
    facturaRefreshBtn.addEventListener('click', () => loadFacturapiReceipts());
}

const printerTestBtn = document.getElementById('printer-test-btn');
if (printerTestBtn) {
    printerTestBtn.addEventListener('click', async () => {
        printerTestBtn.disabled = true;
        printerTestBtn.innerHTML = '🖨️ Enviando...';
        try {
            const res = await fetch(`${API_BASE}/api/print/test`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showToast(`✅ ${data.message}`);
            } else {
                showToast(`❌ ${data.message}`);
            }
        } catch (err) {
            showToast(`❌ Error conectando a la impresora`);
        } finally {
            printerTestBtn.disabled = false;
            printerTestBtn.innerHTML = '🖨️ Probar Impresora';
        }
    });
}

