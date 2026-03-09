import asyncio
from sqlalchemy import select
from backend.database import async_session, init_db
from backend.models import Product

async def update_stouts():
    await init_db()
    async with async_session() as session:
        # Update Milk Stout to Milk/Extra Stout
        result = await session.execute(select(Product).where(Product.name.like("%Milk Stout%")))
        milk_stout = result.scalar_one_or_none()
        if milk_stout:
            milk_stout.name = "Milk/Extra Stout (Manush)"
            print(f"Updated: {milk_stout.name}")

        # Disable Extra Stout by setting stock to 0
        result = await session.execute(select(Product).where(Product.name.like("%Extra Stout%")))
        # Be careful not to match the newly renamed one if it was saved, but we haven't committed yet
        for p in result.scalars().all():
            if p.id != (milk_stout.id if milk_stout else -1) and "Extra" in p.name:
                p.stock = 0
                p.is_available = False
                print(f"Disabled: {p.name}")

        await session.commit()

if __name__ == "__main__":
    asyncio.run(update_stouts())
