# System Design Document: Last-Mile Delivery Management Platform

## 1. Executive Architecture Summary

The Last-Mile Delivery Tracker platform is designed using a modular, service-oriented monolithic architecture. Built with Node.js/Express and backed by PostgreSQL/SQLite via Prisma ORM, it cleanly separates routing, domain services, data persistence, and real-time client presentation. The platform guarantees strict state consistency, auditability of deliveries, dynamic pricing without hardcoded logic, and intelligent fleet balancing.

---

## 2. Rate Calculation Engine and Pricing Model

The Rate Calculation Engine computes shipment costs deterministically using multi-attribute operational parameters:

1. **Dimensional Weight Assessment**:
   Package dimensions (Length, Breadth, Height in centimeters) are converted to volumetric weight in kilograms using the industry standard IATA divisor:
   `Volumetric Weight (kg) = (Length x Breadth x Height) / 5000`
   
2. **Billed Weight Resolution**:
   To prevent revenue loss on low-density parcels, the billable weight is resolved as:
   `Billed Weight = Max(Actual Weight, Volumetric Weight)`

3. **Dynamic Rate Card Application**:
   Pricing matrices are stored in the database (`RateCard` model) keyed by `(Order Type, Zone Type)` pairs:
   - Order Types: B2B (commercial) and B2C (retail)
   - Zone Types: Intra-Zone (intra-cluster movement) and Inter-Zone (cross-cluster transit)
   
   `Weight Charge = Billed Weight x RateCard.rate_per_kg`
   `Subtotal = RateCard.base_charge + Weight Charge`

4. **Cash on Delivery (COD) Surcharge**:
   If payment mode is COD, a configurable flat surcharge (`CODSurcharge` table) corresponding to the order type is appended to mitigate cash-handling overhead.
   `Total Charge = Subtotal + COD Surcharge`

All rates, bases, and surcharges are admin-configurable at runtime with zero application restarts.

---

## 3. Zone Detection Approach

Instead of relying on fragile and expensive external reverse-geocoding APIs, zone detection uses a deterministic relational mapping:

1. **Area Registry**: The platform maintains an `Area` registry mapping discrete postal pincodes to high-level operational hubs (`Zone`).
2. **Resolution Pipeline**: When an order is quoted, both `pickup_pincode` and `drop_pincode` are queried against the `Area` table to extract `pickup_zone_id` and `drop_zone_id`.
3. **Topology Classification**:
   - If `pickup_zone_id == drop_zone_id`, the shipment is categorized as `INTRA`.
   - If `pickup_zone_id != drop_zone_id`, the shipment is categorized as `INTER`.
4. **Validation**: Unmapped or unserviceable pincodes immediately trigger actionable 404 responses before order persistence.

---

## 4. Intelligent Auto-Assignment Logic

The auto-assignment subsystem coordinates dispatch operations without requiring complex geospatial math:

1. **Pickup Locality Clustering**: The system retrieves all registered agents associated with the order's `pickup_zone_id` whose status is flagged `is_available = true`.
2. **Active Workload Balancing**:
   For each candidate agent, the system computes the number of active, non-terminal deliveries (statuses `ASSIGNED`, `PICKED_UP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`):
   `Active Orders = Count(Order WHERE agent_id = agent.id AND status IN ActiveStatuses)`
   The agent with the minimum active workload is assigned the shipment.
3. **Cross-Zone Fallback**:
   If no available agents exist in the immediate pickup zone, the search expands across all operational zones, assigning the global agent with the least active workload.
4. **Failure Safeguard**: If all fleet agents are offline or busy, the order remains in `CREATED` status, flagging admin operators for manual override.

---

## 5. Order Lifecycle and Failed Delivery Handling

Deliveries transition across a formal finite-state machine (FSM) backed by an append-only `TrackingEvent` ledger:

```
[CREATED] -> [ASSIGNED] -> [PICKED_UP] -> [IN_TRANSIT] -> [OUT_FOR_DELIVERY] -> [DELIVERED]
                                                                  |
                                                                  v
                                                               [FAILED]
                                                                  |
                                                           (Customer Reschedule)
                                                                  v
                                                            [RESCHEDULED] -> [ASSIGNED]
```

### State Transition & Immutability Rules
- Every status update creates an immutable `TrackingEvent` entry containing the order ID, target status, actor role, actor ID, and operational notes. The audit trail cannot be modified or deleted.
- Non-conforming status jumps (e.g. `CREATED` directly to `DELIVERED`) are rejected with `400 Bad Request`.

### Failed Delivery & Rescheduling Protocol
1. If delivery fails during `OUT_FOR_DELIVERY`, the agent marks the order `FAILED` and submits a mandatory failure reason.
2. The customer is immediately dispatched a notification containing a one-click rescheduling link.
3. The customer selects a new delivery date via the tracking interface.
4. The system updates the order to `RESCHEDULED`, unlinks the prior attempt, and triggers the auto-assignment engine to provision an active agent for the new date.
