# Implementation Plan: Advanced Pricing, Billing, and Commercial Operations

## 1. Overview and Objectives

This document details the engineering specification and phased implementation roadmap for upgrading the Last-Mile Delivery Tracker platform with enterprise-grade pricing, multi-tier SLAs, dynamic surge management, contract-based pricing, and automated PDF document generation.

---

## 2. Core Functional Requirements

### 2.1 Multi-Tier Delivery Speeds (SLAs)
- **Delivery Tiers**:
  - `HYPERLOCAL_2H`: 2-Hour Hyperlocal Delivery (Multiplier: 2.0x, restricted to Intra-Zone within same cluster).
  - `SAME_DAY_EXPRESS`: Same-Day Express Delivery (Multiplier: 1.5x, order placed before daily cutoff time e.g., 14:00).
  - `NEXT_DAY_STANDARD`: Next-Day Standard Delivery (Multiplier: 1.0x, default SLA).
- **Enforcement Rules**:
  - Automatically evaluate cutoff hours. Orders placed after cutoff for Same-Day default to Next-Day.
  - Disable Hyperlocal tier if pickup and drop pincodes span across different zones (`INTER`).

### 2.2 Dynamic Surge and Surcharges
- **Surge Types**:
  - **Time-of-Day Surge**: Multiplier applied during peak traffic or night operations (e.g., 18:00 - 21:00).
  - **Festival / Peak Day Surcharge**: Date-range flat surcharge or multiplier configured for festive high-demand periods.
  - **Remote / Hard-to-Reach Area Access Fee**: Flat fee mapped to specific peripheral pincodes or zones.
  - **Fuel Index Surcharge**: Percentage adjustment tied to fluctuating fuel prices.
- **Rule Engine**: Evaluates active rules matching order timestamp, locations, and global configs.

### 2.3 Enterprise Volume Discounts and Contract Pricing
- **Client Rate Card Overrides**:
  - Allows assigning dedicated B2B rate cards to specific corporate accounts that override the global B2B rate cards.
- **Tiered Volume Discounts**:
  - Automated percentage discounts based on monthly shipped volume brackets (e.g., >100 orders = 5% discount, >500 orders = 12% discount).

### 2.4 Automated Invoicing and Shipping Labels
- **Shipping Label Generator**:
  - Generates standard 4x6 inch thermal shipping label PDFs.
  - Includes Tracking Number Barcode / QR Code, pickup and delivery routing clusters, package weight, order type, and COD amount.
- **GST-Compliant Tax Invoicing**:
  - Automatically generates tax invoices with auto-incremented invoice numbers (`INV-YYYY-XXXX`).
  - Itemizes Subtotal, Speed Surcharge, Surge Fees, COD Fees, Volume Discounts, CGST (9%), SGST (9%), and IGST (18%).

---

## 3. Database Schema Extensions

```prisma
model DeliveryTier {
  id              String   @id @default(uuid())
  code            String   @unique // HYPERLOCAL_2H, SAME_DAY_EXPRESS, NEXT_DAY_STANDARD
  name            String
  multiplier      Float    @default(1.0)
  slaHours        Int      // 2, 8, 24
  cutoffHour      Int?     // e.g. 14 for 2:00 PM
  allowedZoneType String   @default("ALL") // ALL, INTRA_ONLY
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model SurgeRule {
  id              String    @id @default(uuid())
  name            String
  surgeType       String    // TIME_OF_DAY, FESTIVAL, REMOTE_AREA, FUEL_INDEX
  multiplier      Float     @default(1.0)
  flatAmount      Float     @default(0.0)
  startHour       Int?      // 0-23
  endHour         Int?      // 0-23
  startDate       DateTime?
  endDate         DateTime?
  zoneId          String?
  pincode         String?
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model ClientContract {
  id                 String   @id @default(uuid())
  customerId         String   @unique
  customBaseCharge   Float?
  customRatePerKg    Float?
  discountPercentage Float    @default(0.0)
  minMonthlyVolume   Int      @default(0)
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model Invoice {
  id              String   @id @default(uuid())
  invoiceNumber   String   @unique
  orderId         String   @unique
  taxableAmount   Float
  taxRate         Float    @default(18.0) // 18% GST
  cgstAmount      Float    @default(0.0)
  sgstAmount      Float    @default(0.0)
  igstAmount      Float    @default(0.0)
  totalAmount     Float
  isInterState    Boolean  @default(false)
  pdfUrl          String?
  createdAt       DateTime @default(now())
}
```

---

## 4. Rate Engine Calculation Pipeline

```
Step 1: Base & Weight Charge (Client Contract Override OR Standard RateCard)
  Base Rate = Contract.customBaseCharge ?? RateCard.baseCharge
  Per Kg Rate = Contract.customRatePerKg ?? RateCard.ratePerKg
  Base Cost = Base Rate + (Billed Weight * Per Kg Rate)

Step 2: Speed Multiplier (DeliveryTier)
  Speed Adjusted Cost = Base Cost * DeliveryTier.multiplier

Step 3: Volume Discounts
  Discount Amount = Speed Adjusted Cost * (Contract.discountPercentage / 100)
  Discounted Subtotal = Speed Adjusted Cost - Discount Amount

Step 4: Dynamic Surge & Access Surcharges
  Surge Total = Sum of active SurgeRules (Time-of-day Multiplier + Festival + Remote Fee + Fuel Index)

Step 5: COD Surcharge
  COD Surcharge = Applied if Payment Type == 'COD'

Step 6: Total Net Charge
  Taxable Value = Discounted Subtotal + Surge Total + COD Surcharge

Step 7: Tax Calculation (GST 18%)
  If Intra-State: CGST (9%) + SGST (9%)
  If Inter-State: IGST (18%)
  Gross Invoice Amount = Taxable Value + Tax Amount
```

---

## 5. Phased Implementation Roadmap

### Phase 1: Database Migration & Configuration Models
- Update `prisma/schema.prisma` with `DeliveryTier`, `SurgeRule`, `ClientContract`, `Invoice`, and Order relations.
- Update `prisma/seed.js` with standard SLA tiers, sample peak surge rules, and a VIP corporate contract.
- Run migrations and verify relational integrity.

### Phase 2: Rate Engine Refactoring & Surge Resolver
- Extend `src/services/rateCalculator.service.js` to support:
  - SLA tier selection and cutoff validation.
  - Surge rule evaluation based on current timestamp, target pincodes, and active multipliers.
  - Corporate contract rate overrides and volume discount deductions.
- Write unit tests in `tests/advancedPricing.test.js` validating all pricing formulas and precedence rules.

### Phase 3: Document Generation Service (Labels & Invoices)
- Install `pdfkit` and `bwip-js` (barcode generator) or lightweight HTML-to-PDF pipeline.
- Implement `src/services/pdfGenerator.service.js`:
  - `generateShippingLabel(order)`: 4x6 inch label with barcode, routing codes, addresses, and parcel weight.
  - `generateTaxInvoice(order, invoiceData)`: GST invoice with complete charge breakdown and billing tax details.
- Add endpoints:
  - `GET /api/orders/:id/label` (Download PDF label)
  - `GET /api/orders/:id/invoice` (Download Tax Invoice PDF)

### Phase 4: Admin Management Portals & APIs
- **SLA & Surge Management**:
  - `CRUD /api/admin/delivery-tiers`
  - `CRUD /api/admin/surge-rules`
- **Contract & Enterprise Pricing**:
  - `CRUD /api/admin/client-contracts`
- **Admin UI Tabs**:
  - Dedicated tabs in `public/admin.html` for managing delivery tiers, surge multipliers, enterprise contracts, and viewing billing logs.

### Phase 5: Customer Portal & Checkout Enhancements
- Update `public/customer.html` order form:
  - SLA speed selector with live cost delta (Standard vs Same-Day Express vs Hyperlocal 2H).
  - Itemized pricing breakdown displaying base cost, speed multiplier, active surges, volume discount, and GST tax.
  - Download buttons for Shipping Label and Tax Invoice in the order history and details modal.

### Phase 6: Automated End-to-End Verification
- Integration tests validating:
  - Hyperlocal tier rejection on Inter-Zone orders.
  - Dynamic surge application during peak hours.
  - Corporate client contract pricing override.
  - Accurate GST calculation and invoice generation.
