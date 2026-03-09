import asyncio
from sqlalchemy import select
from database import async_session, init_db
from models import Product

async def update():
    await init_db()
    async with async_session() as session:
        # 1. Fix Pizza Muzzarella and increase min/max price
        res = await session.execute(select(Product).where(Product.name == "Pizza Muzzarella"))
        pizza = res.scalar_one_or_none()
        if pizza:
            pizza.stock = 50
            pizza.is_available = True
            pizza.min_price = 5000   # Wide margin for volatility
            pizza.max_price = 45000

        # 2. Fix Hamburguesa price range
        res = await session.execute(select(Product).where(Product.name == "Hamburguesa Clásica"))
        burger = res.scalar_one_or_none()
        if burger:
            burger.min_price = 4000
            burger.max_price = 45000

        # 3. Update existing Cerveza category
        res = await session.execute(select(Product).where(Product.name == "Cerveza Artesanal IPA"))
        ipa = res.scalar_one_or_none()
        if ipa:
            ipa.category = "Cerveza"

        await session.commit()

        # 4. Add Empanadas
        empanadas = [
            "Empanada de Carne", "Empanada de Jamón y Queso", "Empanada de Cuatro Quesos",
            "Empanada Caprese", "Empanada de Humita", "Empanada de Verdura", "Empanada de Pollo al Verdeo"
        ]
        for name in empanadas:
            res = await session.execute(select(Product).where(Product.name == name))
            if not res.scalar_one_or_none():
                session.add(Product(
                    name=name, category="Empanadas", emoji="🥟",
                    base_price=3000, current_price=3000, min_price=1500, max_price=6000, stock=50
                ))
        
        # 5. Add Beers
        beers = ["Session IPA", "Pilsen", "Irish", "Milk Stout", "APA"]
        for name in beers:
            # Check if name is generic or requires prefix
            real_name = f"Cerveza {name}"
            res = await session.execute(select(Product).where(Product.name == real_name))
            if not res.scalar_one_or_none():
                session.add(Product(
                    name=real_name, category="Cerveza", emoji="🍺",
                    base_price=9000, current_price=9000, min_price=5000, max_price=15000, stock=100
                ))
        
        await session.commit()
        print("Database updates applied successfully!")

if __name__ == "__main__":
    asyncio.run(update())
