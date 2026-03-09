from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    emoji = Column(String, nullable=False)
    base_price = Column(Float, nullable=False)
    current_price = Column(Float, nullable=False)
    min_price = Column(Float, nullable=False)
    max_price = Column(Float, nullable=False)
    stock = Column(Integer, nullable=False, default=0)
    is_available = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "emoji": self.emoji,
            "base_price": self.base_price,
            "current_price": self.current_price,
            "min_price": self.min_price,
            "max_price": self.max_price,
            "stock": self.stock,
            "is_available": self.is_available,
        }


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("cashier_sessions.id"), nullable=True)
    total = Column(Float, nullable=False, default=0)
    timestamp = Column(DateTime, server_default=func.now())
    # FacturAPI
    facturapi_receipt_id = Column(String, nullable=True)
    facturapi_receipt_url = Column(String, nullable=True)  # URL de autofactura del cliente


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    price_at_sale = Column(Float, nullable=False)
    timestamp = Column(DateTime, server_default=func.now())


class CashierSession(Base):
    __tablename__ = "cashier_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    opened_at = Column(DateTime, server_default=func.now())
    closed_at = Column(DateTime, nullable=True)
    total_orders = Column(Integer, default=0)
    total_items = Column(Integer, default=0)
    total_revenue = Column(Float, default=0)
    notes = Column(String, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "opened_at": self.opened_at.isoformat() if self.opened_at else None,
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "total_orders": self.total_orders,
            "total_items": self.total_items,
            "total_revenue": self.total_revenue,
            "notes": self.notes,
        }


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    old_price = Column(Float, nullable=False)
    new_price = Column(Float, nullable=False)
    timestamp = Column(DateTime, server_default=func.now())
