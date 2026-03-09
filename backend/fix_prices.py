import asyncio
from sqlalchemy import select
from database import async_session, init_db
from models import Product

async def update():
    await init_db()
    async with async_session() as session:
        res = await session.execute(select(Product).filter(Product.name == "Hamburguesa Clásica"))
        burger = res.scalar_one_or_none()
        if burger:
            burger.min_price = 4000
            burger.max_price = 15000
            if burger.current_price >= 15000 or burger.current_price <= 0:
                burger.current_price = 9000
            if burger.base_price >= 15000 or burger.base_price <= 0:
                burger.base_price = 9000
                
        res = await session.execute(select(Product).filter(Product.name == "Pizza Muzzarella"))
        pizza = res.scalar_one_or_none()
        if pizza:
            pizza.min_price = 5000
            pizza.max_price = 18000
            if pizza.current_price >= 18000 or pizza.current_price <= 0:
                pizza.current_price = 12000
            if pizza.base_price >= 18000 or pizza.base_price <= 0:
                pizza.base_price = 12000

        await session.commit()
        print("Prices fixed successfully!")

if __name__ == "__main__":
    asyncio.run(update())

