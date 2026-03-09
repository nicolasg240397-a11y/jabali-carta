import asyncio
import os
from database import engine, Base, DATABASE_DIR
from seed import seed_database

DB_FILE = os.path.join(DATABASE_DIR, "bar_wallstreet.db")

async def reset():
    print("Dropping all tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    
    print("Seeding database...")
    await seed_database()
    print("Done!")

if __name__ == "__main__":
    asyncio.run(reset())
