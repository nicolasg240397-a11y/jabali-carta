"""
migrate_facturapi.py — Agrega columnas de FacturAPI a la tabla orders existente.
Ejecutar una sola vez: python migrate_facturapi.py
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "bar_wallstreet.db")

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Ver columnas actuales
    cursor.execute("PRAGMA table_info(orders)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"Columnas actuales en 'orders': {columns}")

    added = []

    if "facturapi_receipt_id" not in columns:
        cursor.execute("ALTER TABLE orders ADD COLUMN facturapi_receipt_id TEXT")
        added.append("facturapi_receipt_id")

    if "facturapi_receipt_url" not in columns:
        cursor.execute("ALTER TABLE orders ADD COLUMN facturapi_receipt_url TEXT")
        added.append("facturapi_receipt_url")

    conn.commit()
    conn.close()

    if added:
        print(f"✅ Columnas agregadas: {added}")
    else:
        print("✅ La base de datos ya estaba actualizada, no hubo cambios.")

if __name__ == "__main__":
    migrate()
