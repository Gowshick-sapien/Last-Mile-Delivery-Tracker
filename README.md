# Last-Mile Delivery Management Platform

A delivery management and last-mile tracking platform featuring dynamic zone-based pricing, volumetric weight calculation, automated fleet load-balancing, immutable tracking audit trails, and self-service failed delivery rescheduling.

---

## 1. Features & Capabilities

- **Dynamic Pricing Engine**: Computes delivery rates dynamically based on package dimensions (L x B x H), actual vs volumetric weight, B2B/B2C rate cards, intra/inter-zone routing, and COD surcharges. All rates are database-driven and admin-configurable.
- **Intelligent Fleet Auto-Assignment**: Assigns delivery agents based on pickup zone proximity and active workload balancing with cross-zone fallback.
- **Role-Based Portals**:
  - **Customer Portal**: Instant quote preview, shipment creation, live shipment management, milestone tracking, and 1-click delivery rescheduling.
  - **Agent Portal**: Active delivery queue, route notes, availability toggle, and progressive status advancement.
  - **Admin Control Center**: Metrics overview, multi-criteria shipment filters, manual and auto-assignment, status overrides, zone/area mappings, and live rate card editors.
  - **Public Tracking Portal**: Real-time shipment timeline search by tracking number.
- **Immutable Tracking Audit Trail**: Every status transition records an unalterable tracking event with actor metadata and timestamps.
- **Failed Delivery Recovery**: Automated failure logging, customer email notifications, and self-service rescheduling with automatic agent reassignment.

---

## 2. Tech Stack

- **Backend Runtime**: Node.js with Express.js
- **Database & ORM**: SQLite (Development) / PostgreSQL (Production) with Prisma ORM
- **Authentication**: JWT (JSON Web Tokens) with bcrypt password hashing
- **Notifications**: Resend API integration with simulated logging fallback
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (Zero build step, high performance)
- **Testing**: Jest and Supertest

---

## 3. Project Directory Structure

```
├── docs/
│   ├── ideation_and_implementation_plan.md   # Phased implementation plan
│   └── system_design.md                      # System design specification (<800 words)
├── prisma/
│   ├── schema.prisma                         # Prisma database schema definition
│   └── seed.js                               # Database seeding script with test data
├── public/                                   # Frontend web application
│   ├── css/
│   │   └── style.css                         # Clean, professional styling
│   ├── js/
│   │   └── api.js                            # Frontend API client and UI utilities
│   ├── admin.html                            # Admin operations portal
│   ├── agent.html                            # Delivery agent portal
│   ├── customer.html                         # Customer dashboard & calculator
│   ├── index.html                            # Login and registration portal
│   └── track.html                            # Public shipment tracking portal
├── src/
│   ├── config/
│   │   ├── env.js                            # Environment configuration loader
│   │   └── prisma.js                         # Prisma client singleton
│   ├── middleware/
│   │   ├── auth.js                           # JWT authentication middleware
│   │   ├── errorHandler.js                   # Global error handler
│   │   └── role.js                           # Role-based access control middleware
│   ├── routes/
│   │   ├── admin.routes.js                   # Admin management APIs
│   │   ├── agent.routes.js                   # Agent delivery APIs
│   │   ├── auth.routes.js                    # Registration and login APIs
│   │   ├── order.routes.js                   # Order creation and quoting APIs
│   │   └── tracking.routes.js                # Public tracking API
│   ├── services/
│   │   ├── assignment.service.js             # Auto-assignment and load balancing
│   │   ├── notification.service.js           # Email dispatch service
│   │   ├── order.service.js                  # Order management service
│   │   ├── rateCalculator.service.js         # Rate calculation engine
│   │   └── status.service.js                 # Status state machine and rescheduling
│   ├── utils/
│   │   └── statusTransitions.js              # State transition rules matrix
│   ├── app.js                                # Express application setup
│   └── server.js                             # Server startup entry point
├── tests/
│   ├── orderLifecycle.test.js                # Integration tests for lifecycle & assignment
│   └── rateCalculator.test.js                # Unit tests for rate calculation engine
├── .env.example                              # Environment configuration template
├── package.json
└── README.md
```

---

## 4. Setup & Installation Guide

### Prerequisites
- Node.js version 18.x or 20.x or higher
- npm package manager

### Step 1: Clone Repository & Install Dependencies
```bash
git clone https://github.com/Gowshick-sapien/Last-Mile-Delivery-Tracker.git
cd Last-Mile-Delivery-Tracker
npm install
```

### Step 2: Configure Environment Variables
Create a `.env` file in the root directory:
```env
PORT=5000
DATABASE_URL="file:./dev.db"
JWT_SECRET="delivery_tracker_super_secret_jwt_key_2026"
JWT_EXPIRES_IN="7d"

# Optional Resend API configuration for transactional emails
RESEND_API_KEY=""
EMAIL_FROM="deliveries@tracker.com"
```

### Step 3: Database Setup & Seeding
Push the database schema and populate with default zones, rate cards, pincodes, and test accounts:
```bash
# Push Prisma schema
npx prisma db push

# Seed sample data
node prisma/seed.js
```

### Step 4: Run Application
```bash
# Start server
npm start
```
The application will be accessible at `http://localhost:5000`.

---

## 5. Seed Test Credentials

| Role | Email | Password | Details |
|---|---|---|---|
| Admin | `admin@tracker.com` | `Admin@123` | Full administrative access |
| Customer 1 | `customer@tracker.com` | `Customer@123` | Retail customer (Priya) |
| Customer 2 | `enterprise@corp.com` | `Customer@123` | Commercial B2B client |
| Agent North | `agent.north@tracker.com` | `Agent@123` | Assigned to North Zone (110001, 110002, 110005) |
| Agent South | `agent.south@tracker.com` | `Agent@123` | Assigned to South Zone (110016, 110017, 110019) |
| Agent Central | `agent.central@tracker.com` | `Agent@123` | Assigned to Central Zone (110006, 110008) |

---

## 6. Rate Calculation Logic Explanation

The pricing engine operates through the following deterministic sequence:

1. **Zone Resolution**:
   The system queries the `Area` table to resolve `pickup_pincode` &rarr; `pickup_zone_id` and `drop_pincode` &rarr; `drop_zone_id`.
   - If `pickup_zone_id == drop_zone_id` &rarr; `INTRA`
   - If `pickup_zone_id != drop_zone_id` &rarr; `INTER`

2. **Volumetric Weight Calculation**:
   `Volumetric Weight (kg) = (Length x Breadth x Height) / 5000`

3. **Billed Weight Resolution**:
   `Billed Weight = Max(Actual Weight, Volumetric Weight)`

4. **Rate Card Lookup**:
   Looks up the `RateCard` matching `(Order Type, Zone Type)` to extract `base_charge` and `rate_per_kg`:
   `Weight Charge = Billed Weight x RateCard.rate_per_kg`

5. **COD Surcharge**:
   If payment type is `COD`, fetches flat surcharge from `CODSurcharge` table for the order type:
   `COD Surcharge = CODSurcharge.surcharge_amount` (or 0 for Prepaid)

6. **Total Charge Formula**:
   `Total Charge = Base Charge + Weight Charge + COD Surcharge`

### Example Calculation
- Shipment: 110001 (North Zone) to 110016 (South Zone) &rarr; `INTER`
- Dimensions: 50 x 40 x 30 cm &rarr; Volumetric = 60,000 / 5,000 = 12.0 kg
- Actual Weight: 5.0 kg &rarr; Billed Weight = `Max(5.0, 12.0) = 12.0 kg`
- Rate Card (B2B, INTER): Base Charge = INR 200.0, Rate/kg = INR 25.0
- Payment Mode: `COD` (B2B Surcharge = INR 60.0)
- Calculation:
  - Base Charge = INR 200.00
  - Weight Charge = 12.0 kg x 25.0 = INR 300.00
  - COD Surcharge = INR 60.00
  - **Total Charge = INR 560.00**

---

## 7. Database Schema

```
User (id, name, email, passwordHash, phone, role)
Zone (id, name, description)
Area (id, pincode, areaName, zoneId -> Zone)
RateCard (id, orderType, zoneType, baseCharge, ratePerKg)
CODSurcharge (id, orderType, surchargeAmount)
AgentProfile (id, userId -> User, currentZoneId -> Zone, isAvailable)
Order (id, trackingNumber, customerId -> User, agentId -> User, pickupAddress, pickupPincode, pickupZoneId, dropAddress, dropPincode, dropZoneId, lengthCm, breadthCm, heightCm, actualWeightKg, volumetricWeightKg, billedWeightKg, orderType, paymentType, zoneType, baseCharge, weightCharge, codSurcharge, totalCharge, status, scheduledDate, failureReason)
TrackingEvent (id, orderId -> Order, status, actorId -> User, actorRole, note, createdAt)
Notification (id, orderId -> Order, recipientEmail, recipientRole, subject, content, status, createdAt)
```

---

## 8. API Documentation

### Authentication
- `POST /api/auth/register` - Create customer account
- `POST /api/auth/login` - Authenticate and receive JWT token
- `GET /api/auth/me` - Get profile of authenticated user

### Orders & Quotes
- `POST /api/orders/calculate` - Stateless price quote calculation
- `POST /api/orders` - Place and confirm shipment (with optional auto-assignment)
- `GET /api/orders` - List shipments for authenticated customer
- `GET /api/orders/:id` - Fetch shipment details and tracking events
- `POST /api/orders/:id/reschedule` - Customer reschedule failed delivery

### Agent Operations
- `GET /api/agent/orders` - List assigned deliveries
- `PATCH /api/agent/availability` - Toggle available/busy status
- `PATCH /api/agent/zone` - Update active operational zone
- `PATCH /api/agent/orders/:id/status` - Advance delivery status (`PICKED_UP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`)

### Admin Operations
- `GET /api/admin/stats` - Platform metrics and revenue summary
- `GET /api/admin/orders` - Filterable order management
- `POST /api/admin/orders` - Create shipment on behalf of customer
- `POST /api/admin/orders/:id/auto-assign` - Trigger auto-assignment engine
- `POST /api/admin/orders/:id/assign` - Manual agent assignment
- `PATCH /api/admin/orders/:id/override-status` - Administrative status override
- `CRUD /api/admin/zones` - Operational zones management
- `CRUD /api/admin/areas` - Pincode to zone mappings
- `GET, PUT /api/admin/rate-cards` - Dynamic rate card configuration
- `GET, PUT /api/admin/cod-surcharges` - COD surcharge configuration
- `GET, POST /api/admin/agents` - Fleet management and agent registration

### Public Tracking
- `GET /api/tracking/:trackingNumber` - Public milestone timeline and live shipment tracking

---

## 9. Automated Testing

Run the automated test suite covering rate calculation formulas, auto-assignment, state transitions, failed delivery handling, and authorization:

```bash
npm test
```

---

## 10. Deployment Guide

### Deploying to Render / Railway / Vercel
1. Set Environment Variables:
   - `DATABASE_URL`: PostgreSQL connection string (or SQLite path on persistent disk)
   - `JWT_SECRET`: Secure random string
   - `PORT`: `5000` (or injected by platform)
   - `RESEND_API_KEY`: (Optional) Resend API key
2. Build Command:
   `npm install && npx prisma generate && npx prisma db push && node prisma/seed.js`
3. Start Command:
   `node src/server.js`
