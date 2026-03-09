const API_BASE = window.location.origin;

document.addEventListener("DOMContentLoaded", () => {
    // DOM Refs
    const pinOverlay = document.getElementById("pin-overlay");
    const dashboardContent = document.getElementById("dashboard-content");
    const pinInput = document.getElementById("pin-input");
    const pinSubmit = document.getElementById("pin-submit");
    const pinError = document.getElementById("pin-error");
    const refreshBtn = document.getElementById("refresh-btn");
    const clockEl = document.getElementById("clock");

    // Auth
    pinSubmit.addEventListener("click", authenticate);
    pinInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") authenticate();
    });

    async function authenticate() {
        pinError.classList.add("hidden");
        const pin = pinInput.value;
        if (!pin) return;

        pinSubmit.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/auth/verify-pin`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                pinOverlay.classList.add("hidden");
                dashboardContent.classList.remove("hidden");
                startDashboard();
            } else {
                pinError.classList.remove("hidden");
                pinInput.value = "";
                pinInput.focus();
            }
        } catch (err) {
            console.error(err);
        } finally {
            pinSubmit.disabled = false;
        }
    }

    // Dashboard Logic
    let refreshInterval = null;

    function startDashboard() {
        loadData();
        // Auto refresh every 10 seconds
        refreshInterval = setInterval(loadData, 10000);

        setInterval(() => {
            const now = new Date();
            clockEl.textContent = now.toLocaleTimeString("es-AR");
        }, 1000);
    }

    refreshBtn.addEventListener("click", () => {
        loadData();
    });

    async function loadData() {
        try {
            const [summaryRes, historyRes] = await Promise.all([
                fetch(`${API_BASE}/api/sales/summary`),
                fetch(`${API_BASE}/api/sales/history?limit=30`)
            ]);

            const summary = await summaryRes.json();
            const history = await historyRes.json();

            updateSummary(summary);
            updateHistory(history);
        } catch (err) {
            console.error("Error loading dashboard data", err);
        }
    }

    const numberFormat = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0
    });

    function updateSummary(data) {
        document.getElementById("dash-revenue").textContent = numberFormat.format(data.total_revenue);
        document.getElementById("dash-orders").textContent = data.total_orders;
        document.getElementById("dash-items").textContent = data.total_items;

        const topContainer = document.getElementById("top-products-list");
        if (!data.top_products || data.top_products.length === 0) {
            topContainer.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">No hay ventas registradas en esta caja</p>';
            return;
        }

        topContainer.innerHTML = data.top_products.map((p, i) => `
            <div class="top-item">
                <span class="top-rank">#${i + 1}</span>
                <span>${p.emoji}</span>
                <div class="top-info">
                    <span class="top-name">${p.name}</span>
                    <span class="top-qty">${p.quantity} vendidos</span>
                </div>
                <span class="top-revenue">${numberFormat.format(p.revenue)}</span>
            </div>
        `).join("");
    }

    function updateHistory(history) {
        const tbody = document.getElementById("sales-history-body");

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">Sin ventas</td></tr>';
            return;
        }

        tbody.innerHTML = history.map(s => {
            const time = s.timestamp ? new Date(s.timestamp).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--';
            return `
                <tr>
                    <td style="color:var(--text-secondary);font-family:monospace;">${time}</td>
                    <td>${s.product_emoji} ${s.product_name}</td>
                    <td>${s.quantity}</td>
                    <td>${numberFormat.format(s.price_at_sale)}</td>
                    <td class="text-green">${numberFormat.format(s.total)}</td>
                </tr>
            `;
        }).join("");
    }
});
