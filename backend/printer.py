"""
printer.py — Servicio de impresión ESC/POS para impresora térmica 3nStar.
Usa Win32Raw para comunicarse via el driver nativo de Windows.
Sin Zadig, sin libusb — funciona con cualquier driver de Windows.
"""

import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# Nombre de la impresora en Windows (Dispositivos e Impresoras)
PRINTER_NAME = os.getenv("PRINTER_NAME", "BARRA")

# Ancho del ticket en caracteres (80mm = 48 chars, 58mm = 32 chars)
TICKET_WIDTH = 48


def _get_printer():
    """Inicializa y retorna la impresora Win32Raw. Retorna None si falla."""
    try:
        from escpos.printer import Win32Raw
        return Win32Raw(PRINTER_NAME)
    except Exception as e:
        print(f"[Printer] No se pudo conectar a '{PRINTER_NAME}': {e}")
        return None


def list_printers() -> list[str]:
    """Lista todas las impresoras disponibles en Windows."""
    try:
        import win32print
        printers = win32print.EnumPrinters(
            win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        )
        return [p[2] for p in printers]
    except ImportError:
        return ["(pywin32 no instalado — ejecutá: pip install python-escpos[win32])"]
    except Exception as e:
        return [f"Error: {e}"]


def print_ticket(
    order_id: int,
    items: list[dict],
    total: float,
    timestamp: str | None = None,
) -> bool:
    """
    Imprime un ticket de venta en la impresora térmica.

    Args:
        order_id: Número de orden
        items: Lista de {product_name, quantity, unit_price, subtotal}
        total: Total de la orden
        timestamp: Fecha/hora de la venta (ISO string o None para ahora)

    Returns:
        True si se imprimió correctamente, False si no
    """
    p = _get_printer()
    if p is None:
        return False

    try:
        now = datetime.now() if not timestamp else datetime.fromisoformat(timestamp)
        fecha = now.strftime("%d/%m/%Y  %H:%M")
        sep = "─" * TICKET_WIDTH

        # ── HEADER ──────────────────────────────────────────────────────────
        p.set(align="center", bold=True, double_height=True, double_width=True)
        p.text("📈 BAR WALL STREET\n")
        p.set(align="center", bold=False, double_height=False, double_width=False)
        p.text("Sistema de Precios Dinámicos\n")
        p.text(f"{sep}\n")

        # ── META ─────────────────────────────────────────────────────────────
        p.set(align="left")
        p.text(f"Orden : #{order_id}\n")
        p.text(f"Fecha : {fecha}\n")
        p.text(f"{sep}\n")

        # ── ITEMS ────────────────────────────────────────────────────────────
        p.set(bold=True)
        col_prod  = TICKET_WIDTH - 14
        p.text(f"{'PRODUCTO':<{col_prod}}{'CANT':>4}{'TOTAL':>10}\n")
        p.set(bold=False)
        p.text(f"{sep}\n")

        for item in items:
            name     = item.get("product_name", "Producto")[:col_prod]
            qty      = item.get("quantity", 1)
            subtotal = item.get("subtotal", item.get("unit_price", 0) * qty)

            # Nombre (puede ser largo → segunda línea)
            p.text(f"{name:<{col_prod}}{qty:>4}{subtotal:>10,.0f}\n")

            # Precio unitario en línea separada si qty > 1
            if qty > 1:
                unit = item.get("unit_price", 0)
                p.set(font="b")
                p.text(f"  @ ${unit:,.0f} c/u\n")
                p.set(font="a")

        p.text(f"{sep}\n")

        # ── TOTAL ────────────────────────────────────────────────────────────
        p.set(align="right", bold=True, double_height=True)
        p.text(f"TOTAL  ${total:,.0f}\n")
        p.set(align="center", bold=False, double_height=False)

        # ── FOOTER ───────────────────────────────────────────────────────────
        p.text(f"{sep}\n")
        p.text("Gracias por tu compra!\n")
        p.text("Los precios cambian como el mercado 📊\n")
        p.text("\n\n\n")

        # Corte de papel
        p.cut()

        print(f"[Printer] Ticket impreso: Orden #{order_id} — Total ${total:,.0f}")
        return True

    except Exception as e:
        print(f"[Printer] Error imprimiendo ticket: {e}")
        try:
            p.close()
        except Exception:
            pass
        return False


def print_test_ticket() -> bool:
    """Imprime un ticket de prueba para verificar la conexión."""
    return print_ticket(
        order_id=0,
        items=[
            {"product_name": "🍺 Cerveza", "quantity": 2, "unit_price": 8500, "subtotal": 17000},
            {"product_name": "🥤 Fernet", "quantity": 1, "unit_price": 9000, "subtotal": 9000},
        ],
        total=26000,
        timestamp=None,
    )
