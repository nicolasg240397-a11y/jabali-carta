import asyncio
import json
import os
import shutil
import glob
import socket
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.requests import Request
from sqlalchemy import select, func as sqlfunc, desc, asc, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import init_db, get_db, async_session, DATABASE_DIR
from models import Product, Sale, CashierSession, Order, PriceHistory
from price_engine import recalculate_prices, get_price_status, RECALC_INTERVAL_MINUTES, reset_crash_status, trigger_crash_manual
import facturapi as fapi
from facturapi_router import router as facturapi_router
import printer
from seed import seed_database

BACKUP_DIR = os.path.join(DATABASE_DIR, "backups")
DB_FILE = os.path.join(DATABASE_DIR, "bar_wallstreet.db")
BACKUP_KEEP_COUNT = 10
BACKUP_INTERVAL_HOURS = 1

# --- Security ---
ADMIN_PIN = "1234"


# ─── WebSocket connection manager ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.active_connections.remove(conn)


manager = ConnectionManager()


# ─── Backup logic ──────────────────────────────────────────────────────────────
def create_backup_sync() -> str | None:
    """Create a backup of the database. Returns the backup filename or None on error."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"backup_{timestamp}.db"
        backup_path = os.path.join(BACKUP_DIR, backup_name)
        shutil.copy2(DB_FILE, backup_path)

        # Rotate: keep only the last BACKUP_KEEP_COUNT
        backups = sorted(glob.glob(os.path.join(BACKUP_DIR, "backup_*.db")))
        while len(backups) > BACKUP_KEEP_COUNT:
            os.remove(backups.pop(0))

        print(f"[{datetime.now().strftime('%H:%M:%S')}] Backup created: {backup_name}")
        return backup_name
    except Exception as e:
        print(f"Backup error: {e}")
        return None


async def backup_loop():
    """Background task that creates a backup every BACKUP_INTERVAL_HOURS."""
    while True:
        await asyncio.sleep(BACKUP_INTERVAL_HOURS * 3600)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, create_backup_sync)


# ─── Background price recalculation task ───────────────────────────────────────
next_recalc_time = None

async def price_recalc_loop():
    """Background task that recalculates prices every RECALC_INTERVAL_MINUTES."""
    global next_recalc_time
    
    while True:
        # Set next recalc time
        next_recalc_time = datetime.now() + timedelta(minutes=RECALC_INTERVAL_MINUTES)
        
        await asyncio.sleep(RECALC_INTERVAL_MINUTES * 60)
        try:
            updated = await recalculate_prices()
            status = await get_price_status()
            status["next_recalc_time"] = next_recalc_time.isoformat() if next_recalc_time else None
            
            await manager.broadcast({
                "type": "price_update",
                "products": updated,
                "status": status,
                "timestamp": datetime.now().isoformat(),
            })
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Prices recalculated for {len(updated)} products")
        except Exception as e:
            print(f"Error recalculating prices: {e}")


# ─── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_database()
    price_task = asyncio.create_task(price_recalc_loop())
    backup_task = asyncio.create_task(backup_loop())
    yield
    price_task.cancel()
    backup_task.cancel()


app = FastAPI(title="Bar Wall Street", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── FacturAPI routes ──────────────────────────────────────────────────────────
app.include_router(facturapi_router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Always return JSON for unhandled errors so the frontend can parse it."""
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Error interno del servidor: {str(exc)}"},
    )


# ─── Root redirect ─────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return RedirectResponse(url="/pos")


# ─── REST API Routes ───────────────────────────────────────────────────────────

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

@app.get("/api/config")
async def get_config():
    return {"local_ip": get_local_ip(), "port": 8000}


@app.post("/api/auth/verify-pin")
async def verify_pin(data: dict):
    if data.get("pin") == ADMIN_PIN:
        return {"success": True}
    raise HTTPException(status_code=401, detail="PIN incorrecto")


@app.get("/api/products")
async def get_products(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Product).order_by(Product.category, Product.name))
    products = result.scalars().all()
    return [p.to_dict() for p in products]


@app.get("/api/products/{product_id}")
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return product.to_dict()


@app.get("/api/products/{product_id}/candles")
async def get_product_candles(product_id: int, minutes: int = 15, db: AsyncSession = Depends(get_db)):
    """
    Get OHLC (Open, High, Low, Close) candlestick data for a product.
    Returns array of {time: timestamp_seconds, open, high, low, close}
    """
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    # Get last 24h history
    start_time = datetime.now() - timedelta(hours=24)
    history_result = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.product_id == product_id)
        .where(PriceHistory.timestamp >= start_time)
        .order_by(asc(PriceHistory.timestamp))
    )
    records = history_result.scalars().all()

    # Get the last known price before start_time to use as the baseline
    last_price_result = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.product_id == product_id)
        .where(PriceHistory.timestamp < start_time)
        .order_by(desc(PriceHistory.timestamp))
        .limit(1)
    )
    last_price_record = last_price_result.scalar_one_or_none()
    
    # To handle gaps, we track the last known price
    if last_price_record:
        last_price = last_price_record.new_price
    elif records:
        last_price = records[0].old_price
    else:
        last_price = product.base_price

    # Group into buckets of N minutes
    bucket_delta = timedelta(minutes=minutes)
    
    # We build continuous buckets from exactly start_time to now
    current_time = start_time.replace(second=0, microsecond=0)
    end_time = datetime.now()
    
    candles = []
    record_idx = 0
    
    while current_time <= end_time:
        bucket_end = current_time + bucket_delta
        
        # Build bucket OHLC
        bucket_open = last_price
        bucket_high = last_price
        bucket_low = last_price
        bucket_close = last_price
        
        has_data_in_bucket = False
        
        while record_idx < len(records) and records[record_idx].timestamp < bucket_end:
            record = records[record_idx]
            price = record.new_price
            
            bucket_high = max(bucket_high, price)
            bucket_low = min(bucket_low, price)
            bucket_close = price
            
            last_price = price
            has_data_in_bucket = True
            record_idx += 1
            
        # Lightweight charts wants time as unix timestamp
        # It expects the timestamp to be at the start of the bucket
        candles.append({
            "time": int(current_time.timestamp()),
            "open": bucket_open,
            "high": bucket_high,
            "low": bucket_low,
            "close": bucket_close
        })
        
        current_time = bucket_end

    return candles


@app.put("/api/products/{product_id}")
async def update_product(product_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    allowed_fields = ["name", "category", "emoji", "base_price", "min_price", "max_price", "is_available"]
    for field in allowed_fields:
        if field in data:
            setattr(product, field, data[field])

    await db.commit()
    await db.refresh(product)
    return product.to_dict()


@app.put("/api/products/{product_id}/stock")
async def update_stock(product_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    if "stock" in data:
        product.stock = data["stock"]
    elif "add" in data:
        product.stock += data["add"]

    if product.stock > 0:
        product.is_available = True
    elif product.stock == 0:
        product.is_available = False

    await db.commit()
    await db.refresh(product)

    # Broadcast stock update
    await manager.broadcast({
        "type": "stock_update",
        "product": product.to_dict(),
        "timestamp": datetime.now().isoformat(),
    })

    return product.to_dict()


@app.post("/api/orders")
async def create_order(order: dict, db: AsyncSession = Depends(get_db)):
    """
    Create an order. Expected body:
    {
        "items": [
            {"product_id": 1, "quantity": 2},
            {"product_id": 3, "quantity": 1}
        ]
    }
    """
    items = order.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="El pedido debe tener al menos un item")

    # Step 1: Pre-fetch and strictly validate all items before modifying anything
    product_ids = [item["product_id"] for item in items]
    result = await db.execute(select(Product).where(Product.id.in_(product_ids)))
    products_db = {p.id: p for p in result.scalars().all()}
    
    total = 0
    order_details = []

    for item in items:
        product_id = item["product_id"]
        quantity = item["quantity"]
        product = products_db.get(product_id)
        
        if not product:
            raise HTTPException(status_code=404, detail=f"Producto {product_id} no encontrado")
        if not product.is_available:
            raise HTTPException(status_code=400, detail=f"{product.name} no está disponible")
        if product.stock < quantity:
            raise HTTPException(status_code=400, detail=f"Stock insuficiente de {product.name} (quedan {product.stock})")

        subtotal = product.current_price * quantity
        total += subtotal
        order_details.append({
            "product_obj": product,
            "quantity": quantity,
            "unit_price": product.current_price,
            "subtotal": subtotal,
        })
        
    # Step 2: Create Order record
    new_order = Order(total=total)
    db.add(new_order)
    await db.flush() # Get order ID
    
    # Step 3: Deduct stock and Create Sale records
    for detail in order_details:
        product = detail["product_obj"]
        quantity = detail["quantity"]
        
        # Decrease stock
        product.stock -= quantity
        if product.stock == 0:
            product.is_available = False

        # Record sale linked to order
        sale = Sale(
            product_id=product.id,
            order_id=new_order.id,
            quantity=quantity,
            price_at_sale=detail["unit_price"],
        )
        db.add(sale)

    await db.commit()

    for item_detail in order_details:
        await db.refresh(item_detail["product_obj"])
        item_detail["product"] = item_detail["product_obj"].to_dict()

    # Broadcast stock updates using a fresh query
    products_result = await db.execute(select(Product))
    all_products = products_result.scalars().all()
    await manager.broadcast({
        "type": "stock_update",
        "products": [p.to_dict() for p in all_products],
        "timestamp": datetime.now().isoformat(),
    })

    # ── FacturAPI: crear recibo en background (no bloquea la venta si falla) ──
    receipt_data = None
    try:
        facturapi_items = [
            {
                "product_name": d["product"]["name"],
                "quantity": d["quantity"],
                "unit_price": d["unit_price"],
            }
            for d in order_details
        ]
        receipt_data = await fapi.create_receipt(
            order_id=new_order.id,
            items=facturapi_items,
            total=total,
        )
        if receipt_data:
            # Guardar el ID del recibo en la orden
            await db.execute(
                __import__("sqlalchemy").update(Order)
                .where(Order.id == new_order.id)
                .values(
                    facturapi_receipt_id=receipt_data.get("id"),
                    facturapi_receipt_url=receipt_data.get("self_invoice_url"),
                )
            )
            await db.commit()
    except Exception as e:
        print(f"[FacturAPI] Error en background al crear recibo: {e}")

    # ── Impresión de Ticket ───────────────────────────────────────────────────
    try:
        printer.print_ticket(
            order_id=new_order.id,
            items=[
                {
                    "product_name": d["product"]["name"],
                    "quantity": d["quantity"],
                    "unit_price": d["unit_price"],
                    "subtotal": d["subtotal"],
                }
                for d in order_details
            ],
            total=total,
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        print(f"[Printer] Error al mandar a imprimir: {e}")

    return {
        "success": True,
        "order_id": new_order.id,
        "total": total,
        "items": [
            {
                "product": d["product"],
                "quantity": d["quantity"],
                "unit_price": d["unit_price"],
                "subtotal": d["subtotal"],
            }
            for d in order_details
        ],
        "timestamp": datetime.now().isoformat(),
        "facturapi_receipt_id": receipt_data.get("id") if receipt_data else None,
        "facturapi_self_invoice_url": receipt_data.get("self_invoice_url") if receipt_data else None,
    }


@app.get("/api/status")
async def get_status():
    status = await get_price_status()
    return status


@app.post("/api/recalculate")
async def force_recalculate():
    """Force a price recalculation (for testing)."""
    global next_recalc_time
    
    updated = await recalculate_prices()
    status = await get_price_status()
    
    # Reset the timer as we just recalculated
    next_recalc_time = datetime.now() + timedelta(minutes=RECALC_INTERVAL_MINUTES)
    status["next_recalc_time"] = next_recalc_time.isoformat()

    await manager.broadcast({
        "type": "price_update",
        "products": updated,
        "status": status,
        "timestamp": datetime.now().isoformat(),
    })

    return {"success": True, "products_updated": len(updated)}


# ─── Sales History & Cashier ───────────────────────────────────────────────────

@app.get("/api/sales/history")
async def get_sales_history(
    limit: int = 50,
    offset: int = 0,
    session_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get sales history with product names, ordered by most recent."""
    query = (
        select(Sale, Product.name, Product.emoji, Order.session_id)
        .join(Product, Sale.product_id == Product.id)
        .join(Order, Sale.order_id == Order.id)
        .order_by(desc(Sale.timestamp))
    )

    if session_id is not None:
        query = query.where(Order.session_id == session_id)

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "id": sale.id,
            "product_id": sale.product_id,
            "product_name": name,
            "product_emoji": emoji,
            "quantity": sale.quantity,
            "price_at_sale": sale.price_at_sale,
            "total": sale.price_at_sale * sale.quantity,
            "order_id": sale.order_id,
            "session_id": order_session,
            "timestamp": sale.timestamp.isoformat() if sale.timestamp else None,
        }
        for sale, name, emoji, order_session in rows
    ]


@app.get("/api/sales/summary")
async def get_sales_summary(db: AsyncSession = Depends(get_db)):
    """Get current sales summary (for sales not yet closed in a session)."""
    # Get sales from orders not assigned to a closed session
    query = select(Sale).join(Order, Sale.order_id == Order.id).where(Order.session_id.is_(None))
    result = await db.execute(query)
    sales = result.scalars().all()

    total_revenue = sum(s.price_at_sale * s.quantity for s in sales)
    total_items = sum(s.quantity for s in sales)

    # Count unique orders
    orders_query = select(sqlfunc.count(Order.id)).where(Order.session_id.is_(None))
    total_orders = (await db.execute(orders_query)).scalar() or 0

    # Top products
    product_totals: dict[int, dict] = {}
    for s in sales:
        if s.product_id not in product_totals:
            product_totals[s.product_id] = {"quantity": 0, "revenue": 0}
        product_totals[s.product_id]["quantity"] += s.quantity
        product_totals[s.product_id]["revenue"] += s.price_at_sale * s.quantity

    # Get product names for top products
    top_products = []
    if product_totals:
        product_ids = list(product_totals.keys())
        products_result = await db.execute(
            select(Product).where(Product.id.in_(product_ids))
        )
        products_map = {p.id: p for p in products_result.scalars().all()}

        for pid, data in sorted(product_totals.items(), key=lambda x: x[1]["revenue"], reverse=True)[:5]:
            p = products_map.get(pid)
            if p:
                top_products.append({
                    "product_id": pid,
                    "name": p.name,
                    "emoji": p.emoji,
                    "quantity": data["quantity"],
                    "revenue": data["revenue"],
                })

    return {
        "total_revenue": total_revenue,
        "total_items": total_items,
        "total_orders": total_orders,
        "top_products": top_products,
        "first_sale_at": sales[-1].timestamp.isoformat() if sales else None,
        "last_sale_at": sales[0].timestamp.isoformat() if sales else None,
    }


@app.post("/api/cashier/close")
async def close_cashier(data: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Close current cashier session. Assigns all unassigned orders to a new session."""
    notes = data.get("notes", "") if data else ""

    # Get unassigned orders
    orders_result = await db.execute(select(Order).where(Order.session_id.is_(None)))
    orders = orders_result.scalars().all()

    if not orders:
        raise HTTPException(status_code=400, detail="No hay ventas para cerrar")

    # Get unassigned sales
    query = select(Sale).join(Order, Sale.order_id == Order.id).where(Order.session_id.is_(None))
    result = await db.execute(query)
    sales = result.scalars().all()

    total_revenue = sum(s.price_at_sale * s.quantity for s in sales)
    total_items = sum(s.quantity for s in sales)
    total_orders = len(orders)

    # Determine session start (earliest sale)
    first_sale = min(s.timestamp for s in sales if s.timestamp)

    # Create session
    session = CashierSession(
        opened_at=first_sale,
        closed_at=datetime.now(),
        total_orders=total_orders,
        total_items=total_items,
        total_revenue=total_revenue,
        notes=notes,
    )
    db.add(session)
    await db.flush()  # Get the session ID

    # Assign orders to session
    for order in orders:
        order.session_id = session.id

    # Reset product prices to base_price, enforce new limits
    products_result = await db.execute(select(Product))
    products = products_result.scalars().all()
    now_dt = datetime.now()
    updated_products = []

    for p in products:
        p.min_price = 6000.0
        p.max_price = 12000.0
        if p.current_price != p.base_price:
            history = PriceHistory(
                product_id=p.id,
                old_price=p.current_price,
                new_price=p.base_price,
                timestamp=now_dt
            )
            db.add(history)
            p.current_price = p.base_price
        updated_products.append(p)

    await db.commit()
    await db.refresh(session)

    # Broadcast price update to all clients
    status = await get_price_status()
    await manager.broadcast({
        "type": "price_update",
        "products": [p.to_dict() for p in updated_products],
        "status": status,
        "timestamp": now_dt.isoformat(),
    })

    # ── FacturAPI: emitir factura global al cerrar caja ────────────────────────
    factura_global = None
    try:
        factura_global = await fapi.create_global_invoice(periodicity="day")
    except Exception as e:
        print(f"[FacturAPI] Error emitiendo factura global: {e}")

    return {
        "success": True,
        "session": session.to_dict(),
        "factura_global": {
            "id": factura_global.get("id") if factura_global else None,
            "folio": factura_global.get("folio_number") if factura_global else None,
            "total": factura_global.get("total") if factura_global else None,
            "pdf_url": f"https://www.facturapi.io/v2/invoices/{factura_global.get('id')}/pdf" if factura_global else None,
            "emitida": factura_global is not None,
        },
    }

# ─── Endpoints Impresora ───────────────────────────────────────────────────────
@app.get("/api/print/printers")
async def get_printers():
    """Devuelve la lista de impresoras instaladas en Windows para diagnóstico."""
    return {"printers": printer.list_printers()}

@app.post("/api/print/test")
async def test_print():
    """Imprime un ticket de prueba."""
    success = printer.print_test_ticket()
    if success:
        return {"success": True, "message": "Ticket de prueba enviado a la impresora BARRA."}
    else:
        return {"success": False, "message": "La impresora BARRA no respondió o no se encontró."}



@app.post("/api/crash/trigger")
async def manual_crash_trigger():
    """Manually trigger a market crash."""
    global next_recalc_time
    if trigger_crash_manual():
        # Broadcast the crash immediately
        updated_prices = await recalculate_prices()
        status = await get_price_status()
        next_recalc_time = datetime.now() + timedelta(minutes=RECALC_INTERVAL_MINUTES)
        status["next_recalc_time"] = next_recalc_time.isoformat()

        await manager.broadcast({
            "type": "price_update",
            "products": updated_prices,
            "status": status,
            "timestamp": datetime.now().isoformat(),
        })
        return {"success": True, "message": "Crash trigger successful"}
    
    return {"success": False, "detail": "El crash ya ocurrió en esta caja o ya está activo."}


@app.post("/api/cashier/open")
async def open_cashier(data: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Reset the day: clear all sales, orders, sessions, price history and reset prices."""
    # Delete all data
    await db.execute(delete(Sale))
    await db.execute(delete(Order))
    await db.execute(delete(CashierSession))
    await db.execute(delete(PriceHistory))

    # Reset crash status
    reset_crash_status()

    # Get all products and reset prices
    products_result = await db.execute(select(Product))
    products = products_result.scalars().all()
    now_dt = datetime.now()
    updated_products = []

    for p in products:
        p.current_price = p.base_price
        p.min_price = 6000.0
        p.max_price = 12000.0
        p.stock = 999999
        p.is_available = True
        updated_products.append(p)

    await db.commit()

    # Broadcast price update
    status = await get_price_status()
    await manager.broadcast({
        "type": "price_update",
        "products": [p.to_dict() for p in updated_products],
        "status": status,
        "timestamp": now_dt.isoformat(),
    })

    return {"success": True}


@app.get("/api/cashier/sessions")
async def get_cashier_sessions(db: AsyncSession = Depends(get_db)):
    """List all past cashier sessions."""
    result = await db.execute(
        select(CashierSession).order_by(desc(CashierSession.closed_at))
    )
    sessions = result.scalars().all()
    return [s.to_dict() for s in sessions]


# ─── Backup endpoints ─────────────────────────────────────────────────────────

@app.post("/api/backup/now")
async def create_backup():
    """Create a manual backup."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, create_backup_sync)
    if result:
        return {"success": True, "filename": result}
    raise HTTPException(status_code=500, detail="Error al crear backup")


@app.get("/api/backup/list")
async def list_backups():
    """List available backups."""
    if not os.path.exists(BACKUP_DIR):
        return []
    backups = sorted(glob.glob(os.path.join(BACKUP_DIR, "backup_*.db")), reverse=True)
    return [
        {
            "filename": os.path.basename(b),
            "size_bytes": os.path.getsize(b),
            "created_at": datetime.fromtimestamp(os.path.getmtime(b)).isoformat(),
        }
        for b in backups
    ]


# ─── WebSocket endpoint ───────────────────────────────────────────────────────

@app.websocket("/ws/prices")
async def websocket_prices(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send initial data on connect
        async with async_session() as db:
            result = await db.execute(select(Product).order_by(Product.category, Product.name))
            products = result.scalars().all()
            status = await get_price_status()
            status["next_recalc_time"] = next_recalc_time.isoformat() if next_recalc_time else None

            await websocket.send_json({
                "type": "initial",
                "products": [p.to_dict() for p in products],
                "status": status,
                "timestamp": datetime.now().isoformat(),
            })

        # Keep connection alive - listen for pings
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ─── Frontend static files ────────────────────────────────────────────────────

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

# Mount static directories with html=True so index.html is auto-served
app.mount("/pos", StaticFiles(directory=os.path.join(FRONTEND_DIR, "pos"), html=True), name="pos-static")
app.mount("/wallstreet", StaticFiles(directory=os.path.join(FRONTEND_DIR, "wallstreet"), html=True), name="wallstreet-static")
app.mount("/menu", StaticFiles(directory=os.path.join(FRONTEND_DIR, "menu"), html=True), name="menu-static")
app.mount("/dashboard", StaticFiles(directory=os.path.join(FRONTEND_DIR, "dashboard"), html=True), name="dashboard-static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

