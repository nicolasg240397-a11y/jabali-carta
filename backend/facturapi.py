"""
facturapi.py — Servicio de integración con FacturAPI para Bar Wall Street.

Flujo para un bar (consumidor final):
  1. Por cada orden → crear un Recibo (nota de venta)
  2. Al cerrar caja → emitir Factura Global con todos los recibos abiertos
  3. Si el cliente pide factura → usa el link de autofactura generado automáticamente
"""

import os
import httpx
from dotenv import load_dotenv

load_dotenv()

# La key se lee del .env primero; si no existe, usa la Test Key directamente.
# En producción, poner FACTURAPI_KEY=sk_live_... en el archivo .env
FACTURAPI_KEY = os.getenv("FACTURAPI_KEY", "sk_test_uw6hzSenk8aXtECrmAjro5g6MzKgWfL6Riz44Xa5jz")
FACTURAPI_BASE = "https://www.facturapi.io/v2"

# Clave SAT para "Alimentos preparados para su consumo en el establecimiento"
# 90121500 es la clave producto/servicio para restaurantes y similares
SAT_PRODUCT_KEY = "90121500"
SAT_UNIT_KEY = "ACT"  # "Actividad" — unidad genérica para servicios
SAT_UNIT_NAME = "Actividad"

# Forma de pago: 03 = Transferencia, 01 = Efectivo, 04 = Tarjeta de crédito
FORMA_PAGO_EFECTIVO = "01"


def _headers() -> dict:
    """Headers de autenticación para FacturAPI (Basic Auth con la API key)."""
    import base64
    credentials = base64.b64encode(f"{FACTURAPI_KEY}:".encode()).decode()
    return {
        "Authorization": f"Basic {credentials}",
        "Content-Type": "application/json",
    }


async def create_receipt(order_id: int, items: list[dict], total: float, payment_form: str = FORMA_PAGO_EFECTIVO) -> dict | None:
    """
    Crea un Recibo en FacturAPI para una orden del bar.

    Args:
        order_id: ID interno de la orden (para referencia / idempotencia)
        items: Lista de dicts con {product_name, quantity, unit_price}
        total: Total de la orden
        payment_form: Código SAT de forma de pago (default: 01 = Efectivo)

    Returns:
        Dict con la respuesta de FacturAPI (incluye id y self_invoice_url) o None si falla
    """
    if not FACTURAPI_KEY:
        print("[FacturAPI] FACTURAPI_KEY no configurada — recibo omitido")
        return None

    concepts = []
    for item in items:
        concepts.append({
            "product": {
                "description": item["product_name"],
                "product_key": SAT_PRODUCT_KEY,
                "unit_key": SAT_UNIT_KEY,
                "unit_name": SAT_UNIT_NAME,
                "price": item["unit_price"],
                "tax_included": True,
                "taxes": [
                    {
                        "type": "IVA",
                        "rate": 0.16,
                        "factor": "Tasa",
                        "withholding": False,
                    }
                ],
            },
            "quantity": item["quantity"],
        })

    payload = {
        "payment_form": payment_form,
        "items": concepts,
        "idempotency_key": f"order-{order_id}",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{FACTURAPI_BASE}/receipts",
                json=payload,
                headers=_headers(),
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                print(f"[FacturAPI] Recibo creado: {data.get('id')} para orden {order_id}")
                return data
            else:
                print(f"[FacturAPI] Error creando recibo: {resp.status_code} — {resp.text}")
                return None
    except Exception as e:
        print(f"[FacturAPI] Excepción creando recibo: {e}")
        return None


async def create_global_invoice(periodicity: str = "day") -> dict | None:
    """
    Emite una Factura Global con todos los recibos abiertos del período.
    Llamar al cerrar caja.

    Args:
        periodicity: "day" | "week" | "month" — período a facturar (default: diario)

    Returns:
        Dict con la factura creada o None si falla/no hay recibos
    """
    if not FACTURAPI_KEY:
        print("[FacturAPI] FACTURAPI_KEY no configurada — factura global omitida")
        return None

    payload = {
        "periodicity": periodicity,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{FACTURAPI_BASE}/receipts/global-invoice",
                json=payload,
                headers=_headers(),
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                print(f"[FacturAPI] Factura global emitida: {data.get('id')}")
                return data
            else:
                print(f"[FacturAPI] Error factura global: {resp.status_code} — {resp.text}")
                return None
    except Exception as e:
        print(f"[FacturAPI] Excepción factura global: {e}")
        return None


async def list_open_receipts() -> list[dict]:
    """Lista todos los recibos con status 'open' (pendientes de facturar)."""
    if not FACTURAPI_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{FACTURAPI_BASE}/receipts",
                params={"status": "open"},
                headers=_headers(),
            )
            if resp.status_code == 200:
                return resp.json().get("data", [])
            return []
    except Exception as e:
        print(f"[FacturAPI] Error listando recibos: {e}")
        return []


async def get_receipt_pdf_url(receipt_id: str) -> str | None:
    """Retorna la URL para descargar el PDF de un recibo."""
    return f"{FACTURAPI_BASE}/receipts/{receipt_id}/pdf"


async def list_invoices(page: int = 1, limit: int = 20) -> list[dict]:
    """Lista las últimas facturas emitidas."""
    if not FACTURAPI_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{FACTURAPI_BASE}/invoices",
                params={"page": page, "limit": limit},
                headers=_headers(),
            )
            if resp.status_code == 200:
                return resp.json().get("data", [])
            return []
    except Exception as e:
        print(f"[FacturAPI] Error listando facturas: {e}")
        return []
