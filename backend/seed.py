from database import async_session, init_db
from models import Product, PriceHistory
from sqlalchemy import select
from datetime import datetime, timedelta
import asyncio
import random


SEED_PRODUCTS = [
    {
        "name": "Apa Born & Released (Manush)",
        "category": "Cerveza",
        "emoji": "🍺",
        "base_price": 9000,
        "current_price": 9000,
        "min_price": 6000,
        "max_price": 12000,
        "stock": 100,
    },
    {
        "name": "Session IPA (Manush)",
        "category": "Cerveza",
        "emoji": "🍺",
        "base_price": 9000,
        "current_price": 9000,
        "min_price": 6000,
        "max_price": 12000,
        "stock": 100,
    },
    {
        "name": "Old Garage IPA (Manush)",
        "category": "Cerveza",
        "emoji": "🍺",
        "base_price": 9000,
        "current_price": 9000,
        "min_price": 6000,
        "max_price": 12000,
        "stock": 100,
    },
    {
        "name": "Pilsen (Manush)",
        "category": "Cerveza",
        "emoji": "🍺",
        "base_price": 9000,
        "current_price": 9000,
        "min_price": 6000,
        "max_price": 12000,
        "stock": 100,
    },
    {
        "name": "Irish Cream Ale (Manush)",
        "category": "Cerveza",
        "emoji": "🍺",
        "base_price": 9000,
        "current_price": 9000,
        "min_price": 6000,
        "max_price": 12000,
        "stock": 100,
    },
    {
        "name": "Milk Stout (Manush)",
        "category": "Cerveza",
        "emoji": "🍺",
        "base_price": 9000,
        "current_price": 9000,
        "min_price": 6000,
        "max_price": 12000,
        "stock": 100,
    },
    {
        "name": "Extra Stout (Manush)",
        "category": "Cerveza",
        "emoji": "🍺",
        "base_price": 9000,
        "current_price": 9000,
        "min_price": 6000,
        "max_price": 12000,
        "stock": 100,
    },
]


async def seed_database():
    """Seed the database with initial products if empty."""
    await init_db()

    async with async_session() as session:
        result = await session.execute(select(Product))
        existing = result.scalars().all()

        if existing:
            print(f"Database already has {len(existing)} products. Skipping seed.")
            return

        now = datetime.now()
        
        for data in SEED_PRODUCTS:
            product = Product(**data)
            session.add(product)
            await session.flush() # get product ID
            
            # Generate 24 hours of fake history (e.g. 1 point every 30 minutes)
            # 48 points total
            history = []
            base_price = product.base_price
            current_sim_price = base_price
            
            for i in range(48, 0, -1):
                timestamp = now - timedelta(minutes=i*30)
                # Random walk
                change = random.uniform(-0.05, 0.05) # +/- 5% max change per step
                new_price = current_sim_price * (1 + change)
                
                # Clamp
                new_price = max(product.min_price, min(product.max_price, new_price))
                new_price = round(new_price / 100) * 100
                
                if new_price != current_sim_price:
                    history.append(
                        PriceHistory(
                            product_id=product.id,
                            old_price=current_sim_price,
                            new_price=new_price,
                            timestamp=timestamp
                        )
                    )
                current_sim_price = new_price
                
            # Set the final simulated price as current
            if history:
                 product.current_price = history[-1].new_price
            
            session.add_all(history)

        await session.commit()
        print(f"Seeded {len(SEED_PRODUCTS)} products with history successfully!")


if __name__ == "__main__":
    asyncio.run(seed_database())
