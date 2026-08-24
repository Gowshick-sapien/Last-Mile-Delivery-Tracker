# Last-Mile Delivery Tracker - Ideation and Implementation Plan

## 1. Project Overview

The Last-Mile Delivery Tracker is a delivery management platform designed for e-commerce and logistics operations. It handles dynamic zone-based pricing, volumetric weight calculations, intelligent agent assignment, order lifecycle management with immutable event logs, failed delivery rescheduling, and automated customer notifications.

---

## 2. Core Requirements and Scope

### Inputs
- Pickup address and pincode
- Drop address and pincode
- Package dimensions: Length (cm), Breadth (cm), Height (cm)
- Actual weight (kg)
- Order type: B2B or B2C
- Payment type: Prepaid or Cash on Delivery (COD)

### System Outputs
- Quotation and auto-calculated final charge
- Delivery agent assignment (manual or automatic)
- End-to-end tracking timeline
- Automated email notifications on status transitions

### Role-Based Capabilities
- **Customer**: Register, login, request quotes, confirm orders, track orders via public/private timeline, reschedule failed deliveries.
- **Admin**: Manage zones and area mappings, configure B2B/B2C intra/inter-zone rate cards, configure COD surcharges, create orders on behalf of customers, view all orders with multi-parameter filtering, manually assign or trigger auto-assignment of agents, override order status.
- **Delivery Agent**: Update availability status, view assigned deliveries, advance order status through the delivery lifecycle, log delivery failure reasons.

---

## 3. System Architecture and Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Backend Runtime | Node.js with Express | Fast setup, modular routing, extensive ecosystem |
| Database | PostgreSQL | Strong ACID compliance, relational integrity for rate cards and audit trails |
| ORM / Query Builder | Prisma ORM | Schema-first migrations, type-safe queries, relational relations |
| Authentication | JWT with bcrypt | Stateless token-based auth with role-based authorization middleware |
| Email Service | Resend API (Free Tier) | Reliable transactional email delivery with simple REST API |
| Frontend | Vanilla HTML5, CSS3, JavaScript | Lightweight, zero-build dependency, responsive and clean interface |

---

## 4. Domain Data Model

### Database Entities

```
User
  - id: UUID / Int (PK)
  - name: String
  - email: String (Unique)
  - password_hash: String
  - phone: String
  - role: Enum (CUSTOMER, AGENT, ADMIN)
  - created_at: DateTime

Zone
  - id: UUID / Int (PK)
  - name: String (Unique)
  - description: String
  - created_at: DateTime

Area
  - id: UUID / Int (PK)
  - pincode: String (Unique)
  - area_name: String
  - zone_id: FK -> Zone(id)
  - created_at: DateTime

RateCard
  - id: UUID / Int (PK)
  - order_type: Enum (B2B, B2C)
  - zone_type: Enum (INTRA, INTER)
  - base_charge: Decimal
  - rate_per_kg: Decimal
  - created_at: DateTime
  - updated_at: DateTime

CODSurcharge
  - id: UUID / Int (PK)
  - order_type: Enum (B2B, B2C)
  - surcharge_amount: Decimal
  - created_at: DateTime
  - updated_at: DateTime

AgentProfile
  - id: UUID / Int (PK)
  - user_id: FK -> User(id) (Unique)
  - current_zone_id: FK -> Zone(id)
  - is_available: Boolean
  - active_order_count: Int
  - updated_at: DateTime

Order
  - id: UUID / Int (PK)
  - tracking_number: String (Unique)
  - customer_id: FK -> User(id)
  - agent_id: FK -> User(id) (Nullable)
  - pickup_address: Text
  - pickup_pincode: String
  - pickup_zone_id: FK -> Zone(id)
  - drop_address: Text
  - drop_pincode: String
  - drop_zone_id: FK -> Zone(id)
  - length_cm: Decimal
  - breadth_cm: Decimal
  - height_cm: Decimal
  - actual_weight_kg: Decimal
  - volumetric_weight_kg: Decimal
  - billed_weight_kg: Decimal
  - order_type: Enum (B2B, B2C)
  - payment_type: Enum (PREPAID, COD)
  - zone_type: Enum (INTRA, INTER)
  - base_charge: Decimal
  - weight_charge: Decimal
  - cod_surcharge: Decimal
  - total_charge: Decimal
  - status: Enum (CREATED, ASSIGNED, PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, FAILED, RESCHEDULED, CANCELLED)
  - scheduled_date: Date
  - failure_reason: Text (Nullable)
  - created_at: DateTime
  - updated_at: DateTime

TrackingEvent
  - id: UUID / Int (PK)
  - order_id: FK -> Order(id)
  - status: String
  - actor_id: FK -> User(id) (Nullable)
  - actor_role: String
  - note: String (Nullable)
  - created_at: DateTime
```

---

## 5. Core Business Logic Engines

### 5.1 Rate Calculation Engine

1. **Zone Resolution**:
   - Resolve `pickup_zone_id` from `Area` table using `pickup_pincode`.
   - Resolve `drop_zone_id` from `Area` table using `drop_pincode`.
   - If either pincode is unmapped, return an unserviceable area error.
2. **Zone Type Determination**:
   - If `pickup_zone_id == drop_zone_id` -> `INTRA`.
   - Else -> `INTER`.
3. **Volumetric Weight**:
   - `volumetric_weight_kg = (length_cm * breadth_cm * height_cm) / 5000`
4. **Billed Weight Calculation**:
   - `billed_weight_kg = MAX(actual_weight_kg, volumetric_weight_kg)`
5. **Rate Card Lookup**:
   - Query `RateCard` by `(order_type, zone_type)`.
   - Extract `base_charge` and `rate_per_kg`.
   - `weight_charge = billed_weight_kg * rate_per_kg`
6. **COD Surcharge**:
   - If `payment_type == COD`, query `CODSurcharge` for `order_type`.
   - Else `cod_surcharge = 0`.
7. **Total Charge**:
   - `total_charge = base_charge + weight_charge + cod_surcharge`

### 5.2 Dynamic Agent Assignment Engine

1. Determine the order's `pickup_zone_id`.
2. Query all `AgentProfile` records where `current_zone_id == pickup_zone_id` and `is_available == true`.
3. Select the agent with the lowest `active_order_count` (load balancing).
4. If no agent is found in the primary zone, fall back to any available agent across all zones with the lowest active load.
5. If no agents are available, flag the order for manual admin intervention.
6. Once assigned:
   - Link `agent_id` to `Order`.
   - Increment agent's active order count.
   - Advance status to `ASSIGNED`.
   - Create immutable `TrackingEvent`.

### 5.3 Order Lifecycle and Failed Delivery Handling

Valid Status Transitions:
- `CREATED -> ASSIGNED`
- `ASSIGNED -> PICKED_UP`
- `PICKED_UP -> IN_TRANSIT`
- `IN_TRANSIT -> OUT_FOR_DELIVERY`
- `OUT_FOR_DELIVERY -> DELIVERED` (Terminal Success)
- `OUT_FOR_DELIVERY -> FAILED`
- `FAILED -> RESCHEDULED` (Triggered by customer selecting a new date)
- `RESCHEDULED -> ASSIGNED` (Agent reassigned)
- `ANY -> CANCELLED` (Admin override)

When delivery fails:
1. Agent marks status `FAILED` with a mandatory reason note.
2. Order status updates to `FAILED`.
3. `TrackingEvent` is appended.
4. Notification is dispatched to the customer containing a reschedule link.
5. Customer selects a new delivery date, triggering `POST /orders/:id/reschedule`.
6. Order is reset to `RESCHEDULED`, unassigned from previous agent, and auto-assigned to an active agent for the new date.

---

## 6. Small Deliverables and Implementation Roadmap

### Deliverable 1: Project Setup, Database Schema, and Seeding
- Initialize Node.js project, install Prisma, Express, cors, dotenv, bcryptjs, jsonwebtoken.
- Construct `schema.prisma` with all entities, enums, and foreign key relations.
- Write `prisma/seed.js` with default zones (North, South, Central), sample pincodes, rate cards, COD surcharges, and sample users (Admin, Agent, Customer).
- Validate migrations and database connection.

### Deliverable 2: Authentication and Role-Based Authorization
- Implement `POST /api/auth/register` (Customer registration).
- Implement `POST /api/auth/login` (Returns signed JWT with user ID and role).
- Build `authenticateToken` middleware.
- Build `requireRole(['ADMIN', 'AGENT', 'CUSTOMER'])` middleware.
- Build `GET /api/auth/me` to fetch authenticated profile.

### Deliverable 3: Admin Configuration APIs (Zones and Rate Cards)
- Zone Management:
  - `GET /api/admin/zones`
  - `POST /api/admin/zones`
  - `POST /api/admin/zones/:zoneId/areas` (Map pincode to zone)
- Rate Card and Surcharge Management:
  - `GET /api/admin/rate-cards`
  - `PUT /api/admin/rate-cards`
  - `GET /api/admin/cod-surcharges`
  - `PUT /api/admin/cod-surcharges`

### Deliverable 4: Rate Calculation and Order Creation
- Implement `POST /api/orders/calculate` (Stateless quotation endpoint returning weight and cost breakdown).
- Implement `POST /api/orders` (Order creation with validation, charge calculation, and initial tracking event).
- Implement `GET /api/orders` (Customer order list) and `GET /api/orders/:id` (Order detail with tracking events).
- Implement `GET /api/admin/orders` (Admin order list with filtering by status, zone, agent, and date).

### Deliverable 5: Agent Management and Intelligent Assignment
- Implement `PATCH /api/agent/availability` and `PATCH /api/agent/zone`.
- Implement `POST /api/admin/orders/:id/assign` (Manual agent assignment).
- Implement `POST /api/admin/orders/:id/auto-assign` (Intelligent zone-matching and load-balanced assignment).
- Implement `GET /api/agent/orders` (Agent's assigned tasks).

### Deliverable 6: Delivery Lifecycle, Tracking, and Rescheduling
- Implement `PATCH /api/agent/orders/:id/status` (Enforce valid state machine transitions).
- Implement `PATCH /api/admin/orders/:id/override-status` (Admin force update).
- Implement `POST /api/orders/:id/reschedule` (Customer rescheduling after failure).
- Implement `GET /api/tracking/:trackingNumber` (Public tracking timeline endpoint).

### Deliverable 7: Transactional Email Notifications
- Configure Resend email provider client.
- Create email notification triggers for:
  - Order Created / Confirmed
  - Agent Assigned
  - Status Updates (Picked Up, In Transit, Out for Delivery, Delivered)
  - Delivery Failed (with action link to reschedule)
  - Rescheduled Order Confirmed
- Ensure email errors are non-blocking and logged gracefully.

### Deliverable 8: Clean and Functional Frontend UI
- Structure a clean, unified dashboard with Vanilla HTML/CSS/JS:
  - `public/index.html` - Login and Registration.
  - `public/customer.html` - Customer dashboard, order creation form with live price quotation preview, order history, and tracking view.
  - `public/agent.html` - Agent portal to toggle availability and update status of assigned packages.
  - `public/admin.html` - Admin portal for zone setup, rate configuration, order overview with filters, manual/auto assignment, and status override.
  - `public/track.html` - Public tracking page showing order timeline and reschedule prompt if failed.

---

## 7. Verification and Testing Checklist

- Rate Calculation Verification:
  - Intra-zone B2C prepaid with actual weight > volumetric weight.
  - Inter-zone B2B COD with volumetric weight > actual weight (surcharge included).
  - Unmapped pincode handling.
- Assignment Logic Verification:
  - Auto-assignment selects agent in same zone with lowest active load.
  - Fallback assignment when primary zone has no free agents.
- Lifecycle and Immutability Verification:
  - Invalid state transitions rejected with 400 Bad Request.
  - Tracking timeline shows unbroken sequence of timestamped events.
  - Rescheduling reassigns agent and logs new event.
- Frontend End-to-End Verification:
  - Complete flow from customer quote -> admin assignment -> agent delivery -> customer tracking.
