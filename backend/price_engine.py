import asyncio
import random
from datetime import datetime, timedelta
from sqlalchemy import select, func as sqlfunc
from database import async_session
from models import Product, Sale, PriceHistory


# Configuration
RECALC_INTERVAL_MINUTES = 10
DEMAND_WINDOW_MINUTES = 30
PRICE_SENSITIVITY = 0.05    # How aggressively prices change (0-1)

CRASH_DURATION_MINUTES = 20
CRASH_PROBABILITY_PER_RECALC = 0.05 # 5% per cycle (roughly 1 in 20 cycles)
TIME_DECAY_PCT = 0.005 # 0.5% price drop if no sales

# Global state
crash_active = False
crash_end_time = None
has_crashed_this_session = False

def reset_crash_status():
    """Reset the crash state for a new cashier session."""
    global crash_active, crash_end_time, has_crashed_this_session
    crash_active = False
    crash_end_time = None
    has_crashed_this_session = False

def trigger_crash_manual() -> bool:
    """Manually trigger a crash if one hasn't happened yet."""
    global crash_active, crash_end_time, has_crashed_this_session
    if has_crashed_this_session or crash_active:
        return False
    
    now = datetime.now()
    crash_active = True
    has_crashed_this_session = True
    crash_end_time = now + timedelta(minutes=CRASH_DURATION_MINUTES)
    print(f"[{now.strftime('%H:%M:%S')}] 🚨 MARKET CRASH TRIGGERED MANUALLY! 🚨")
    return True

async def recalculate_prices() -> list[dict]:
    """
    Recalculate prices based on demand in the last DEMAND_WINDOW_MINUTES.
    Returns list of product dicts with updated prices.
    """
    global crash_active, crash_end_time, has_crashed_this_session
    now = datetime.now()
    
    # Check if crash is ending
    if crash_active and crash_end_time and now >= crash_end_time:
        crash_active = False
        crash_end_time = None
        print(f"[{now.strftime('%H:%M:%S')}] MARKET CRASH ENDED!")
        
    # See if new crash should start (only if not active and hasn't crashed yet)
    if not crash_active and not has_crashed_this_session:
        if random.random() < CRASH_PROBABILITY_PER_RECALC:
            crash_active = True
            has_crashed_this_session = True
            crash_end_time = now + timedelta(minutes=CRASH_DURATION_MINUTES)
            print(f"[{now.strftime('%H:%M:%S')}] 🚨 MARKET CRASH TRIGGERED RANDOMLY! 🚨")

    async with async_session() as session:
        # Get all products
        result = await session.execute(select(Product))
        products = result.scalars().all()

        if not products:
            return []

        # Get sales in the demand window
        window_start = datetime.now() - timedelta(minutes=DEMAND_WINDOW_MINUTES)
        sales_result = await session.execute(
            select(
                Sale.product_id,
                sqlfunc.sum(Sale.quantity).label("total_qty")
            )
            .where(Sale.timestamp >= window_start)
            .group_by(Sale.product_id)
        )
        sales_by_product = {row.product_id: row.total_qty for row in sales_result}

        # Calculate average demand across all products
        total_demand = sum(sales_by_product.values()) if sales_by_product else 0
        avg_demand = total_demand / len(products) if products else 0

        updated_products = []

        for product in products:
            old_price = product.current_price
            product_demand = sales_by_product.get(product.id, 0)
            
            if crash_active:
                # During crash, everything hits bottom price
                new_price = product.min_price
            else:
                if total_demand > 0:
                    # El usuario pidió: "al hacer 20 ventas de una cerveza suba un 10%"
                    # Eso es exactamente 0.5% (0.005) de aumento sobre la base por CADA venta.
                    adjustment_pct = product_demand * 0.005
                    
                    # Efecto Wall Street: si el producto vende MENOS que la media,
                    # le damos un pequeño empujón hacia abajo (-0.5%) para que otros destaquen, pero más leve
                    if product_demand < avg_demand:
                        adjustment_pct -= 0.005
                        
                    # Mayor volatilidad en comidas
                    sensitivity_multiplier = 2.0 if ("Pizza" in product.name or "Hamburguesa" in product.name) else 1.0
                    
                    # Calculamos el objetivo absoluto a partir del precio BASE.
                    # Esto evita que el precio se vaya a las nubes infinitamente si calculáramos 
                    # el +10% sobre el precio ya inflado una y otra vez en cada pedido.
                    target_price = product.base_price * (1 + (adjustment_pct * sensitivity_multiplier))
                    
                    # Inercia: 50% para que responda rápido a cada nueva compra 
                    new_price = (old_price * 0.50) + (target_price * 0.50)
                else:
                    # Si no hay NADA de demanda en todo el bar, los precios vuelven a su base lentamente
                    target_price = product.base_price
                    new_price = (old_price * 0.95) + (target_price * 0.05)

            # Clamp to min/max
            new_price = max(product.min_price, min(product.max_price, new_price))

            # Round to nearest 100 (cleaner prices)
            new_price = round(new_price / 100) * 100

            product.current_price = new_price

            # Record price history if changed
            if old_price != new_price:
                history = PriceHistory(
                    product_id=product.id,
                    old_price=old_price,
                    new_price=new_price,
                )
                session.add(history)

            updated_products.append(product.to_dict())

        await session.commit()

    return updated_products


async def get_price_status() -> dict:
    """Get current pricing status information."""
    return {
        "recalc_interval_minutes": RECALC_INTERVAL_MINUTES,
        "demand_window_minutes": DEMAND_WINDOW_MINUTES,
        "crash_active": crash_active,
        "crash_end": crash_end_time.isoformat() if crash_end_time else None
    }
