"""
facturapi_router.py — Router FastAPI con endpoints de FacturAPI para el panel Admin.
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException
import facturapi as fapi

router = APIRouter(prefix="/api/factura", tags=["facturapi"])


@router.get("/receipts")
async def get_open_receipts():
    """Lista los recibos abiertos (pendientes de factura global)."""
    receipts = await fapi.list_open_receipts()
    return {"receipts": receipts, "count": len(receipts)}


@router.get("/invoices")
async def get_invoices(page: int = 1, limit: int = 20):
    """Lista las últimas facturas globales emitidas."""
    invoices = await fapi.list_invoices(page=page, limit=limit)
    return {"invoices": invoices, "count": len(invoices)}


@router.post("/global")
async def emit_global_invoice(data: dict | None = None):
    """
    Emite manualmente una Factura Global con todos los recibos abiertos.
    Body opcional: { "periodicity": "day" | "week" | "month" }
    """
    periodicity = (data or {}).get("periodicity", "day")
    result = await fapi.create_global_invoice(periodicity=periodicity)
    if not result:
        raise HTTPException(
            status_code=400,
            detail="No se pudo emitir la factura global. "
                   "Verificá que haya recibos abiertos y que la API Key sea válida."
        )
    return {
        "success": True,
        "invoice_id": result.get("id"),
        "folio": result.get("folio_number"),
        "total": result.get("total"),
        "pdf_url": f"https://www.facturapi.io/v2/invoices/{result.get('id')}/pdf",
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/receipts/{receipt_id}/pdf")
async def get_receipt_pdf(receipt_id: str):
    """Retorna la URL de descarga del PDF de un recibo."""
    from fastapi.responses import RedirectResponse
    url = await fapi.get_receipt_pdf_url(receipt_id)
    if not url:
        raise HTTPException(status_code=404, detail="Recibo no encontrado")
    return RedirectResponse(url=url)
