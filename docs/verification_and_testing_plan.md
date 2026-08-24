# Verification and Testing Plan: Last-Mile Delivery Management Platform

## 1. Document Overview and Scope

This document specifies the verification, validation, and testing methodology for the Last-Mile Delivery Management Platform. It establishes the test strategy, automated test suites, end-to-end operational scenarios, security validations, and acceptance criteria to ensure the platform operates with complete correctness, data integrity, and reliability.

---

## 2. Testing Levels and Methodology

| Level | Focus Area | Tools / Harness |
|---|---|---|
| **Level 1: Unit Testing** | Pricing calculations, volumetric weight, SLA multipliers, dynamic surge rules, GST taxes, state transitions | Jest |
| **Level 2: Integration Testing** | REST API endpoints, JWT authentication, Prisma database queries, auto-assignment engine, PDF stream generators | Jest, Supertest |
| **Level 3: End-to-End Scenario Testing** | Full order lifecycle: Quote &rarr; Order Placement &rarr; Assignment &rarr; In Transit &rarr; Failure &rarr; Rescheduling &rarr; Delivery | Automated Test Suite + Browser Validation |
| **Level 4: Security & Role Testing** | Role-based access control (RBAC), unauthorized order manipulation, token tampering, data isolation | Supertest |
| **Level 5: Boundary & Error Testing** | Invalid pincodes, negative dimensions, invalid state transitions, zero availability fallback | Jest, Supertest |

---

## 3. Test Cases and Traceability Matrix

### 3.1 Rate Calculation & Pricing Engine (PRICING)

| Test ID | Module | Scenario Description | Inputs | Expected Result | Status |
|---|---|---|---|---|---|
| `TC-PRC-01` | Rate Engine | Intra-Zone B2C with Actual Weight > Volumetric | Pincodes: 110001 &rarr; 110005, Actual: 2.5kg, Vol: 0.6kg, Tier: Standard | Billed Weight = 2.5kg, Base = 50, Weight = 50, Taxable = 115 (incl. Fuel 15), Tax = 20.70 (18% GST), Total = 135.70 | Automated |
| `TC-PRC-02` | Rate Engine | Inter-Zone B2B COD with Volumetric > Actual | Pincodes: 110001 &rarr; 110016, Actual: 5.0kg, Vol: 12.0kg, Payment: COD | Billed Weight = 12.0kg, Base = 200, Weight = 300, COD = 60, Fuel = 15, Taxable = 575, Total = 678.50 | Automated |
| `TC-PRC-03` | SLA Tiers | Hyperlocal 2H delivery multiplier on Intra-Zone | DeliveryTier: `HYPERLOCAL_2H` (2.0x), Intra-Zone | Base freight multiplied by 2.0x, correctly reflected in taxable amount | Automated |
| `TC-PRC-04` | SLA Tiers | Rejection of Hyperlocal 2H on Inter-Zone route | DeliveryTier: `HYPERLOCAL_2H`, Inter-Zone (110001 &rarr; 110016) | Throws 400 Bad Request: "only available for Intra-Zone" | Automated |
| `TC-PRC-05` | Surge Engine | Remote area surcharge for peripheral pincodes | Drop Pincode: `110058` (Janakpuri Outer) | Automatically appends flat INR 40 remote area surcharge | Automated |
| `TC-PRC-06` | Contracts | Enterprise contract override and volume discount | Customer: `enterprise@corp.com` (Base 100, Rate/kg 12, Disc 10%) | Overrides standard B2B rate cards and deducts 10% volume discount | Automated |
| `TC-PRC-07` | Boundary | Rejection of unmapped pickup or drop pincode | Pickup Pincode: `999999` | Throws 404: "Pincode is not mapped to any serviceable zone" | Automated |
| `TC-PRC-08` | Boundary | Rejection of zero or negative dimensions | Length: -10, Breadth: 10, Height: 10 | Throws 400: "Dimensions must be positive numbers" | Automated |

---

### 3.2 Agent Assignment & Fleet Load Balancing (ASSIGN)

| Test ID | Module | Scenario Description | Inputs | Expected Result | Status |
|---|---|---|---|---|---|
| `TC-ASN-01` | Auto-Assign | Zone Proximity Matching | Order in North Zone (110001) | Auto-assigns available agent registered in North Zone (`agent.north@tracker.com`) | Automated |
| `TC-ASN-02` | Load Balance | Workload distribution among zone agents | 2 agents in same zone (Agent A: 2 active orders, Agent B: 0 active) | Auto-assigns order to Agent B with minimum active orders | Automated |
| `TC-ASN-03` | Fallback | Cross-Zone Fallback when primary zone agents busy | All North Zone agents set to `isAvailable = false` | Automatically assigns available agent from South/Central zone | Automated |
| `TC-ASN-04` | Manual Assign | Admin manual agent assignment | Admin assigns specific agent ID | Order updates to `ASSIGNED`, agent linked, audit event appended | Automated |
| `TC-ASN-05` | Guard | Prevent assignment to terminal orders | Order in `DELIVERED` or `CANCELLED` status | Throws 400: "Cannot assign agent to order in terminal status" | Automated |

---

### 3.3 Delivery Lifecycle, State Machine & Rescheduling (LIFECYCLE)

| Test ID | Module | Scenario Description | Inputs | Expected Result | Status |
|---|---|---|---|---|---|
| `TC-LFC-01` | State Machine | Progressive valid delivery advancement | `CREATED &rarr; ASSIGNED &rarr; PICKED_UP &rarr; IN_TRANSIT &rarr; OUT_FOR_DELIVERY &rarr; DELIVERED` | Status advances at each step, logs actor and timestamp in `TrackingEvent` | Automated |
| `TC-LFC-02` | State Machine | Rejection of invalid status skip | Attempting direct transition `CREATED &rarr; DELIVERED` | Throws 400 Bad Request or 403 Forbidden | Automated |
| `TC-LFC-03` | Failed Delivery | Recording delivery failure with reason | Agent flags status as `FAILED` during `OUT_FOR_DELIVERY` | Order updates to `FAILED`, failure reason saved, customer notified | Automated |
| `TC-LFC-04` | Reschedule | Customer rescheduling failed delivery | Customer submits new valid future date | Status updates to `RESCHEDULED`, auto-reassigns agent, confirmation sent | Automated |
| `TC-LFC-05` | Tracking | Public milestone timeline verification | Query `GET /api/tracking/:trackingNumber` | Returns chronological sequence of all status transitions with actor roles | Automated |

---

### 3.4 Invoicing & Document Generation (DOCUMENTS)

| Test ID | Module | Scenario Description | Inputs | Expected Result | Status |
|---|---|---|---|---|---|
| `TC-DOC-01` | Invoice | Automated GST invoice generation on order creation | Order created via `POST /api/orders` | Auto-creates `Invoice` record with `INV-YYYYMMDD-XXXX` and GST breakdown | Automated |
| `TC-DOC-02` | PDF Label | Download 4x6 thermal shipping label PDF | `GET /api/orders/:id/label` | Returns `200 OK` with header `Content-Type: application/pdf` | Automated |
| `TC-DOC-03` | PDF Invoice | Download GST Tax Invoice PDF | `GET /api/orders/:id/invoice` | Returns `200 OK` with header `Content-Type: application/pdf` | Automated |

---

### 3.5 Security & Authorization (SECURITY)

| Test ID | Module | Scenario Description | Inputs | Expected Result | Status |
|---|---|---|---|---|---|
| `TC-SEC-01` | Auth | Customer cannot access admin routes | Customer token sent to `GET /api/admin/zones` | Returns `403 Forbidden` | Automated |
| `TC-SEC-02` | Auth | Unauthenticated request rejected | No `Authorization` header sent to protected endpoint | Returns `401 Unauthorized` | Automated |
| `TC-SEC-03` | Isolation | Customer cannot view another customer's order | Customer A queries Order ID belonging to Customer B | Returns `403 Forbidden` | Automated |
| `TC-SEC-04` | Agent Auth | Agent cannot update order assigned to another agent | Agent A attempts status update on order assigned to Agent B | Returns `403 Forbidden: "Unauthorized agent"` | Automated |

---

## 4. System Setup and Execution Instructions

### 4.1 Prerequisites
- Node.js (v18.x, v20.x, or v22.x)
- npm package manager

### 4.2 Installation and Configuration

1. **Clone the repository and enter the directory**:
   ```bash
   git clone https://github.com/Gowshick-sapien/Last-Mile-Delivery-Tracker.git
   cd Last-Mile-Delivery-Tracker
   ```

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create or verify the `.env` configuration file in the project root:
   ```env
   PORT=5000
   DATABASE_URL="file:./dev.db"
   JWT_SECRET="delivery_tracker_super_secret_jwt_key_2026"
   JWT_EXPIRES_IN="7d"

   # Optional Resend API key for live transactional emails
   RESEND_API_KEY=""
   EMAIL_FROM="deliveries@tracker.com"
   ```

4. **Initialize Database Schema and Seed Data**:
   ```bash
   # Push Prisma schema to SQLite/PostgreSQL
   npx prisma db push

   # Populate zones, rate cards, SLAs, surge rules, and test accounts
   node prisma/seed.js
   ```

5. **Start the Application Server**:
   ```bash
   # Start production/local server
   npm start

   # Or start development server with file watching
   npm run dev
   ```
   The application server will listen on `http://localhost:5000`.

### 4.3 Web Portal Access Endpoints

| Portal | URL | Purpose |
|---|---|---|
| **Landing & Auth** | `http://localhost:5000/index.html` | Customer/Agent/Admin authentication and quick demo credentials |
| **Customer Portal** | `http://localhost:5000/customer.html` | Rate calculator, order placement, live tracking, invoice/label download |
| **Agent Portal** | `http://localhost:5000/agent.html` | Delivery task queue, availability toggle, and progressive status updates |
| **Admin Operations** | `http://localhost:5000/admin.html` | Metrics, order dispatch, SLAs, surge rules, contracts, and zones |
| **Public Tracking** | `http://localhost:5000/track.html` | Public milestone tracking by tracking number (e.g. `TRK-...`) |

### 4.4 Test User Credentials

| Role | Email Address | Password | Operational Profile |
|---|---|---|---|
| **Admin** | `admin@tracker.com` | `Admin@123` | Full administrative control |
| **Customer (Standard)** | `customer@tracker.com` | `Customer@123` | Standard retail customer account |
| **Customer (Enterprise VIP)** | `enterprise@corp.com` | `Customer@123` | VIP contract: Custom Base INR 100, Rate/kg INR 12, 10% Volume Discount |
| **Agent (North Zone)** | `agent.north@tracker.com` | `Agent@123` | Assigned to North Zone (Pincodes: 110001, 110002, 110005) |
| **Agent (South Zone)** | `agent.south@tracker.com` | `Agent@123` | Assigned to South Zone (Pincodes: 110016, 110017, 110019) |
| **Agent (Central Zone)** | `agent.central@tracker.com` | `Agent@123` | Assigned to Central Zone (Pincodes: 110006, 110008) |

---

## 5. Test Execution Instructions

### 5.1 Running the Automated Test Suite

Execute the complete automated test suite in the project root:

```bash
# Run all unit and integration tests
npm test
```

To run a specific test suite individually:

```bash
# Run pricing engine tests
npx jest tests/rateCalculator.test.js

# Run advanced pricing, SLAs, surges, contracts, and PDF tests
npx jest tests/advancedPricing.test.js

# Run order lifecycle, auto-assignment, and tracking tests
npx jest tests/orderLifecycle.test.js
```

---

## 6. Manual Verification and UI Walkthrough Checklist

### Customer Portal (`/customer.html`)
- [ ] Login using `customer@tracker.com` / `Customer@123`.
- [ ] Fill pickup pincode `110001` and drop pincode `110016`.
- [ ] Change SLA tier to `SAME_DAY_EXPRESS` and verify live quote updates dynamically.
- [ ] Confirm and place order. Verify immediate appearance in shipment history.
- [ ] Click **Label PDF** to open the 4x6 thermal label in a browser tab.
- [ ] Click **Invoice PDF** to verify GST itemization, CGST/SGST/IGST, and invoice numbering.
- [ ] Click **Timeline** to inspect the audit log.

### Agent Portal (`/agent.html`)
- [ ] Login using `agent.north@tracker.com` / `Agent@123`.
- [ ] Toggle availability button between **Available** and **Busy**.
- [ ] Find assigned package and advance status: **Mark Picked Up** &rarr; **Mark In Transit** &rarr; **Out for Delivery**.
- [ ] On Out for Delivery, click **Failed**, choose "Customer unavailable" and submit.
- [ ] Verify order status shifts to `FAILED`.

### Customer Reschedule Flow (`/customer.html` or `/track.html`)
- [ ] As customer, view failed shipment and click **Reschedule**.
- [ ] Select tomorrow's date and submit.
- [ ] Verify status moves to `RESCHEDULED` and auto-reassigns a delivery agent.

### Admin Operations Center (`/admin.html`)
- [ ] Login using `admin@tracker.com` / `Admin@123`.
- [ ] Review KPI metric cards (Total shipments, Revenue, Active agents, Contracts).
- [ ] Filter shipments table by status and search terms.
- [ ] Navigate to **SLA Speed Tiers**, **Dynamic Surges**, and **Enterprise Contracts** tabs to verify runtime configurations.
- [ ] Trigger an administrative status override on an active order.

---

## 7. Acceptance Criteria (Definition of Done)

1. **Test Execution**: 100% of unit and integration test suites pass with zero failures.
2. **Formula Precision**: Volumetric weight `(L x B x H) / 5000` and `MAX(actual, volumetric)` calculated to exact decimal precision.
3. **Data Immutability**: No `TrackingEvent` records can be altered or purged after creation.
4. **Security Enforcement**: No cross-tenant data leaks between customer accounts; strict role gating across Admin, Agent, and Customer portals.
5. **Document Integrity**: Valid PDF streams generated on demand for all confirmed shipments with barcodes and tax itemization.
