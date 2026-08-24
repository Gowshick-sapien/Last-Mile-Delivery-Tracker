# Last-Mile Delivery Management Platform

A delivery management and last-mile tracking platform featuring multi-tier delivery SLAs, dynamic surge pricing, enterprise volume contracts, automated GST tax invoicing, downloadable 4x6 thermal shipping labels, automated fleet load-balancing, immutable tracking audit trails, and self-service failed delivery rescheduling.

---

## 1. Features & Capabilities

### Pricing, Billing & Commercial Operations
- **Multi-Tier Delivery Speeds (SLAs)**:
  - `HYPERLOCAL_2H`: 2-Hour Hyperlocal Delivery (2.0x multiplier, constrained to Intra-Zone shipments).
  - `SAME_DAY_EXPRESS`: Same-Day Express Delivery (1.5x multiplier, with cutoff validation).
  - `NEXT_DAY_STANDARD`: Next-Day Standard Delivery (1.0x baseline).
- **Dynamic Surge & Surcharges**:
  - Time-of-day peak multipliers (e.g. 18:00 - 21:00 evening rush).
  - Remote / peripheral pincode access surcharges (e.g. outer limits fee).
  - Global fuel index surcharges.
  - Festival and peak season demand adjustments.
- **Enterprise Contracts & Volume Discounts**:
  - Negotiated custom base rates and per-kg rates for corporate B2B clients.
  - Automated tiered percentage volume discounts based on commitment volumes.
- **Automated Invoicing & Shipping Labels**:
  - **4x6 Thermal Shipping Label PDFs**: High-density thermal format with tracking barcodes, cluster routing codes, and parcel specs (`GET /api/orders/:id/label`).
  - **GST-Compliant Tax Invoice PDFs**: Automatic invoice generation with sequential numbering (`INV-YYYYMMDD-XXXX`), itemized charge breakdown, CGST (9%), SGST (9%), and IGST (18%) (`GET /api/orders/:id/invoice`).

### Dispatch, Operations & Self-Service
- **Intelligent Fleet Auto-Assignment**: Assigns delivery agents based on pickup zone proximity and active workload balancing with cross-zone fallback.
- **Role-Based Portals**:
  - **Customer Portal**: Live commercial calculator with SLA speed selector, shipment creation, tracking timeline, and PDF downloads.
  - **Agent Portal**: Active delivery queue, availability toggle, and progressive status advancement.
  - **Admin Control Center**: Metrics overview, multi-criteria shipment filters, SLA tier config, surge matrix editor, enterprise contract manager, manual/auto-assignment, and status overrides.
  - **Public Tracking Portal**: Real-time shipment timeline search by tracking number.
- **Immutable Tracking Audit Trail**: Every status transition records an unalterable tracking event with actor metadata and timestamps.
- **Failed Delivery Recovery**: Automated failure logging, customer email notifications, and self-service rescheduling with automatic agent reassignment.

---

## 2. Tech Stack

- **Backend Runtime**: Node.js with Express.js
- **Database & ORM**: SQLite (Development) / PostgreSQL (Production) with Prisma ORM
- **Authentication**: JWT (JSON Web Tokens) with bcrypt password hashing
- **PDF Generation**: PDFKit (Vector rendering for labels and tax invoices)
- **Notifications**: Resend API integration with simulated logging fallback
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (Zero build step, high performance)
- **Testing**: Jest and Supertest

---

## 3. Project Directory Structure

```
├── docs/
│   ├── ideation_and_implementation_plan.md      # Phased implementation plan
│   ├── pricing_and_billing_enhancement_plan.md  # Advanced pricing & billing design
│   └── system_design.md                         # System design specification (<800 words)
├── prisma/
│   ├── schema.prisma                            # Extended Prisma schema (SLAs, Surges, Contracts, Invoices)
│   └── seed.js                                  # Database seed script with SLAs, Surges, VIP Contracts
├── public/                                      # Frontend web application
│   ├── css/
│   │   └── style.css                            # Clean, professional styling
│   ├── js/
│   │   └── api.js                               # Frontend API client and UI utilities
│   ├── admin.html                               # Admin operations portal (Tiers, Surges, Contracts, Orders)
│   ├── agent.html                               # Delivery agent portal
│   ├── customer.html                            # Customer dashboard & live calculator
│   ├── index.html                               # Login and registration portal
│   └── track.html                               # Public shipment tracking portal
├── src/
│   ├── config/
│   │   ├── env.js                               # Environment configuration loader
│   │   └── prisma.js                            # Prisma client singleton
│   ├── middleware/
│   │   ├── auth.js                              # JWT authentication middleware
│   │   ├── errorHandler.js                      # Global error handler
│   │   └── role.js                              # Role-based access control middleware
│   ├── routes/
│   │   ├── admin.routes.js                      # Admin management APIs (Tiers, Surges, Contracts, Orders)
│   │   ├── agent.routes.js                      # Agent delivery APIs
│   │   ├── auth.routes.js                       # Registration and login APIs
│   │   ├── order.routes.js                      # Order creation, quoting, and PDF downloads
│   │   └── tracking.routes.js                   # Public tracking API
│   ├── services/
│   │   ├── assignment.service.js                # Auto-assignment and load balancing
│   │   ├── notification.service.js              # Email dispatch service
│   │   ├── order.service.js                     # Order and invoice creation service
│   │   ├── pdfGenerator.service.js              # PDF shipping label and tax invoice generator
│   │   ├── rateCalculator.service.js            # Advanced pricing engine (SLAs, Surges, Contracts, GST)
│   │   └── status.service.js                    # Status state machine and rescheduling
│   ├── utils/
│   │   └── statusTransitions.js                 # State transition rules matrix
│   ├── app.js                                   # Express application setup
│   └── server.js                                # Server startup entry point
├── tests/
│   ├── advancedPricing.test.js                  # Unit & integration tests for SLAs, Surges, Contracts, PDFs
│   ├── orderLifecycle.test.js                   # Integration tests for lifecycle & assignment
│   └── rateCalculator.test.js                   # Unit tests for rate calculation engine
├── .env.example                                 # Environment configuration template
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
Push the database schema and populate with default zones, SLAs, surge rules, rate cards, pincodes, and test accounts:
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
The application will run at `http://localhost:5000`.

---

## 5. Seed Test Credentials

| Role | Email | Password | Details |
|---|---|---|---|
| Admin | `admin@tracker.com` | `Admin@123` | Full administrative access |
| Customer (Standard) | `customer@tracker.com` | `Customer@123` | Retail customer (Priya) |
| Customer (Enterprise VIP) | `enterprise@corp.com` | `Customer@123` | VIP contract: Custom Base INR 100, Rate/kg INR 12, 10% Volume Discount |
| Agent North | `agent.north@tracker.com` | `Agent@123` | Assigned to North Zone (110001, 110002, 110005) |
| Agent South | `agent.south@tracker.com` | `Agent@123` | Assigned to South Zone (110016, 110017, 110019) |
| Agent Central | `agent.central@tracker.com` | `Agent@123` | Assigned to Central Zone (110006, 110008) |

---

## 6. Automated Testing

Run the automated test suite covering advanced pricing formulas, SLAs, dynamic surges, client contracts, state transitions, failed delivery handling, and PDF downloads:

```bash
npm test
```
All 12 tests across 3 test suites will execute and pass.
