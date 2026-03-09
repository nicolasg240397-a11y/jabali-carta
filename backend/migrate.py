"""One-time migration: add missing columns/tables to existing database."""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bar_wallstreet.db")

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check existing tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    print(f"Existing tables: {tables}")

    # 1) Add session_id column to sales if missing
    cursor.execute("PRAGMA table_info(sales)")
    sales_columns = [row[1] for row in cursor.fetchall()]
    print(f"Sales columns: {sales_columns}")

    if "session_id" not in sales_columns:
        print("Adding session_id column to sales...")
        cursor.execute("ALTER TABLE sales ADD COLUMN session_id INTEGER REFERENCES cashier_sessions(id)")
        print("Done!")
    else:
        print("session_id already exists in sales.")

    # 2) Create cashier_sessions table if missing
    if "cashier_sessions" not in tables:
        print("Creating cashier_sessions table...")
        cursor.execute("""
            CREATE TABLE cashier_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                closed_at DATETIME,
                total_orders INTEGER DEFAULT 0,
                total_items INTEGER DEFAULT 0,
                total_revenue FLOAT DEFAULT 0,
                notes VARCHAR
            )
        """)
        print("Done!")
    else:
        print("cashier_sessions table already exists.")

    # 3) Create price_history table if missing
    if "price_history" not in tables:
        print("Creating price_history table...")
        cursor.execute("""
            CREATE TABLE price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL REFERENCES products(id),
                old_price FLOAT NOT NULL,
                new_price FLOAT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        print("Done!")
    else:
        print("price_history table already exists.")

    conn.commit()
    conn.close()
    print("\nMigration complete!")

if __name__ == "__main__":
    migrate()
