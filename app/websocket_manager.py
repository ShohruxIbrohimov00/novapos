"""
NovaPOS — WebSocket Manager v2.1
==================================
Yaxshilanishlar:
  ✅ asyncio.Lock — concurrent broadcast xavfsiz
  ✅ broadcast() / broadcast_except() / send_personal()
  ✅ Dead connection tozalash (avtomatik)
  ✅ get_online_employees() — monitoring
  ✅ Event konstantlari — typo xatoliklaridan himoya
  ✅ send_to_employee() — ma'lum bir xodimga yuborish
  ✅ ping/pong heartbeat
"""

from fastapi import WebSocket
from typing import Dict, Set, Optional, Any
from datetime import datetime
import json
import asyncio
import logging

from app.timezone_utils import now_tashkent

logger = logging.getLogger(__name__)


# ============================================
# WebSocket Event konstantlari
# ============================================
# Frontend ham aynan shu nomlardan foydalanishi SHART
# Bu yerda o'zgartirish frontend da ham o'zgartirishni talab qiladi

class WSEvent:
    # Ulanish
    CONNECTED           = "connected"
    DISCONNECTED        = "disconnected"

    # Mahsulotlar
    PRODUCT_ADDED       = "product_added"
    PRODUCT_UPDATED     = "product_updated"
    PRODUCT_DELETED     = "product_deleted"
    STOCK_UPDATED       = "stock_updated"      # Miqdor o'zgarganda (sotuv, kirim, tuzatish)
    LOW_STOCK           = "low_stock"          # Min chegara ostiga tushganda

    # Sotuvlar
    SALE_CREATED        = "sale_created"
    SALE_CANCELLED      = "sale_cancelled"
    SALE_RETURN         = "sale_return"        # Qaytarish amalga oshirilganda

    # Mijozlar
    CUSTOMER_UPDATED    = "customer_updated"   # Qarz o'zgarganda
    DEBT_PAID           = "debt_paid"

    # Xodimlar
    EMPLOYEE_ACTIVITY   = "employee_activity"  # login/logout/sale

    # Kirim
    SUPPLY_ADDED        = "supply_added"

    # Heartbeat
    PONG                = "pong"


# ============================================
# WSConnection
# ============================================

class WSConnection:
    """Bitta WebSocket ulanishi haqida ma'lumot"""
    __slots__ = ("ws", "employee_id", "employee_name", "role", "connected_at", "store_id")

    def __init__(
        self,
        ws:            WebSocket,
        store_id:      int,
        employee_id:   int,
        employee_name: str,
        role:          str,
    ):
        self.ws            = ws
        self.store_id      = store_id
        self.employee_id   = employee_id
        self.employee_name = employee_name
        self.role          = role
        self.connected_at  = now_tashkent()


# ============================================
# ConnectionManager
# ============================================

class ConnectionManager:
    """
    Har bir do'kon uchun alohida WebSocket ulanishlar.
    store_id → set of WSConnection

    API routerlardan foydalanish:
        from app.websocket_manager import ws_manager

        await ws_manager.broadcast(
            store_id = sale.store_id,
            event    = WSEvent.SALE_CREATED,
            data     = { ... }
        )
    """

    def __init__(self):
        # { store_id: { WSConnection, ... } }
        self._rooms: Dict[int, Set[WSConnection]] = {}
        self._lock  = asyncio.Lock()

    # ─── Ulanish ──────────────────────────────────────────────
    async def connect(
        self,
        websocket:     WebSocket,
        store_id:      int,
        employee_id:   int,
        employee_name: str,
        role:          str = "cashier",
    ) -> WSConnection:
        await websocket.accept()
        conn = WSConnection(
            ws            = websocket,
            store_id      = store_id,
            employee_id   = employee_id,
            employee_name = employee_name,
            role          = role,
        )
        async with self._lock:
            if store_id not in self._rooms:
                self._rooms[store_id] = set()
            self._rooms[store_id].add(conn)

        logger.info(
            f"[WS] ✅ Store {store_id} — {employee_name} ({role}) ulandi. "
            f"Jami: {self.get_connections_count(store_id)}"
        )
        return conn

    # ─── Uzilish ──────────────────────────────────────────────
    async def disconnect(self, conn: WSConnection, store_id: int):
        async with self._lock:
            room = self._rooms.get(store_id)
            if room:
                room.discard(conn)
                if not room:
                    del self._rooms[store_id]

        logger.info(
            f"[WS] ❌ Store {store_id} — {conn.employee_name} uzildi. "
            f"Qoldi: {self.get_connections_count(store_id)}"
        )

    # ─── Broadcast — barcha kasslarga ─────────────────────────
    async def broadcast(
        self,
        store_id: int,
        event:    str,
        data:     dict,
    ):
        """Bir do'kondagi BARCHA ulanishlarga yuborish"""
        await self._send_to_room(store_id, event, data, exclude_conn=None)

    # ─── Broadcast — o'zidan boshqa kasslarga ─────────────────
    async def broadcast_except(
        self,
        store_id:      int,
        event:         str,
        data:          dict,
        exclude_conn:  Optional[WSConnection] = None,
    ):
        """Bir kassa o'ziga yubormaslik uchun"""
        await self._send_to_room(store_id, event, data, exclude_conn=exclude_conn)

    # ─── Personal — faqat bitta kassa ─────────────────────────
    async def send_personal(
        self,
        conn:  WSConnection,
        event: str,
        data:  dict,
    ):
        msg = self._build_message(event, data)
        try:
            await conn.ws.send_text(msg)
        except Exception as e:
            logger.warning(f"[WS] Personal send xato ({conn.employee_name}): {e}")

    # ─── Ma'lum employee ga yuborish ──────────────────────────
    async def send_to_employee(
        self,
        store_id:    int,
        employee_id: int,
        event:       str,
        data:        dict,
    ):
        """Bir do'konda ma'lum xodimning barcha qurilmalariga yuborish"""
        async with self._lock:
            room = self._rooms.get(store_id)
            if not room:
                return
            conns = {c for c in room if c.employee_id == employee_id}

        if not conns:
            return

        msg  = self._build_message(event, data)
        dead: Set[WSConnection] = set()

        for conn in conns:
            try:
                await conn.ws.send_text(msg)
            except Exception:
                dead.add(conn)

        if dead:
            await self._cleanup_dead(store_id, dead)

    # ─── Ichki yordamchi ──────────────────────────────────────
    async def _send_to_room(
        self,
        store_id:     int,
        event:        str,
        data:         dict,
        exclude_conn: Optional[WSConnection],
    ):
        async with self._lock:
            room = self._rooms.get(store_id)
            if not room:
                return
            conns = set(room)  # snapshot — lock ichida to'liq nusxa

        msg  = self._build_message(event, data)
        dead: Set[WSConnection] = set()

        # Lock tashqarisida yuborish — deadlock oldini olish
        for conn in conns:
            if exclude_conn and conn is exclude_conn:
                continue
            try:
                await conn.ws.send_text(msg)
            except Exception:
                dead.add(conn)

        if dead:
            await self._cleanup_dead(store_id, dead)
            logger.info(f"[WS] Store {store_id} — {len(dead)} ta uzilgan tozalandi")

    async def _cleanup_dead(self, store_id: int, dead: Set[WSConnection]):
        async with self._lock:
            room = self._rooms.get(store_id)
            if room:
                room -= dead
                if not room:
                    del self._rooms[store_id]

    @staticmethod
    def _build_message(event: str, data: dict) -> str:
        return json.dumps(
            {
                "event": event,
                "data":  data,
                "ts":    now_tashkent().isoformat(),
            },
            ensure_ascii = False,
            default      = str,  # datetime, enum → str
        )

    # ─── Monitoring ───────────────────────────────────────────
    def get_connections_count(self, store_id: int) -> int:
        return len(self._rooms.get(store_id, set()))

    def get_online_employees(self, store_id: int) -> list[dict]:
        room = self._rooms.get(store_id, set())
        return [
            {
                "employee_id":   c.employee_id,
                "employee_name": c.employee_name,
                "role":          c.role,
                "connected_at":  c.connected_at.isoformat(),
            }
            for c in room
        ]

    def is_employee_online(self, store_id: int, employee_id: int) -> bool:
        room = self._rooms.get(store_id, set())
        return any(c.employee_id == employee_id for c in room)

    def get_all_stats(self) -> dict:
        """/health endpoint uchun"""
        return {
            str(store_id): {
                "connections": len(room),
                "employees":   [c.employee_name for c in room],
            }
            for store_id, room in self._rooms.items()
        }

    @property
    def total_connections(self) -> int:
        return sum(len(r) for r in self._rooms.values())


# ─── Global instance ──────────────────────────────────────────
ws_manager = ConnectionManager()


# ============================================
# WS Event builder yordamchilar
# API routerlar bu funksiyalardan foydalanadi
# ============================================

def build_sale_event(sale, items: list) -> dict:
    """sale_created / sale_cancelled uchun payload"""
    return {
        "sale_id":        sale.id,
        "receipt_number": sale.receipt_number,
        "total_amount":   sale.total_amount,
        "total_profit":   sale.total_profit,
        "payment_method": sale.payment_method.value if hasattr(sale.payment_method, "value") else sale.payment_method,
        "employee_id":    sale.employee_id,
        "employee_name":  sale.employee.full_name if sale.employee else None,
        "customer_name":  sale.customer.full_name if sale.customer else None,
        "items_count":    len(items),
        "items":          [
            {
                "product_id":   i.product_id,
                "product_name": i.product_name,
                "quantity":     i.quantity,
                "unit_price":   i.unit_price,
                "final_amount": i.final_amount,
            }
            for i in items
        ],
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
    }


def build_stock_event(product, old_qty: float, new_qty: float, reason: str = "") -> dict:
    """stock_updated uchun payload"""
    return {
        "product_id":   product.id,
        "product_name": product.name,
        "old_quantity": old_qty,
        "new_quantity": new_qty,
        "difference":   round(new_qty - old_qty, 3),
        "unit_type":    product.unit_type.value if hasattr(product.unit_type, "value") else product.unit_type,
        "reason":       reason,
        # Frontend uchun: past chegara ostidami?
        "is_low_stock": new_qty <= product.min_stock_limit,
    }


def build_return_event(ret, product_name: str, new_qty: float) -> dict:
    """sale_return uchun payload"""
    return {
        "return_id":      ret.id,
        "sale_id":        ret.sale_id,
        "product_id":     ret.product_id,
        "product_name":   product_name,
        "quantity":       ret.quantity,
        "refund_amount":  ret.refund_amount,
        "new_stock":      new_qty,
        "employee_name":  ret.employee_name,
        "created_at":     ret.created_at.isoformat() if ret.created_at else None,
    }


def build_supply_event(batch, product_name: str, new_qty: float, employee_name: str = "") -> dict:
    """supply_added uchun payload"""
    return {
        "batch_id":        batch.id,
        "product_id":      batch.product_id,
        "product_name":    product_name,
        "quantity_added":  batch.quantity_received,
        "new_stock":       new_qty,
        "supply_price":    batch.supply_price,
        "total_cost":      batch.total_cost,
        "supply_type":     batch.supply_type.value if hasattr(batch.supply_type, "value") else batch.supply_type,
        "employee_name":   employee_name,
        "created_at":      batch.created_at.isoformat() if batch.created_at else None,
    }