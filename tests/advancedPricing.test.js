const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { calculateRate } = require('../src/services/rateCalculator.service');

describe('Advanced Pricing, SLAs, Dynamic Surge, and Invoicing Tests', () => {
  let customerToken = '';
  let enterpriseToken = '';
  let enterpriseUserId = '';

  beforeAll(async () => {
    // 1. Login regular customer
    const custRes = await request(app).post('/api/auth/login').send({
      email: 'customer@tracker.com',
      password: 'Customer@123'
    });
    customerToken = custRes.body.token;

    // 2. Login enterprise customer with contract
    const entRes = await request(app).post('/api/auth/login').send({
      email: 'enterprise@corp.com',
      password: 'Customer@123'
    });
    enterpriseToken = entRes.body.token;
    enterpriseUserId = entRes.body.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('Multi-Tier SLA: Hyperlocal 2H doubles base freight on Intra-Zone', async () => {
    // 110001 to 110005 (North Zone -> INTRA), 2.5 kg B2C
    // Standard Base Cost = 50 + (2.5 * 20) = 100.00
    // Hyperlocal 2H Multiplier = 2.0x -> Speed Adjusted = 200.00
    // Fuel Index surge = +15.00
    // Taxable = 215.00
    // GST 18% = 38.70
    // Total = 253.70
    const quote = await calculateRate({
      pickupPincode: '110001',
      dropPincode: '110005',
      lengthCm: 20,
      breadthCm: 15,
      heightCm: 10,
      actualWeightKg: 2.5,
      orderType: 'B2C',
      paymentType: 'PREPAID',
      deliveryTierCode: 'HYPERLOCAL_2H'
    });

    expect(quote.zoneType).toBe('INTRA');
    expect(quote.deliveryTier.code).toBe('HYPERLOCAL_2H');
    expect(quote.costBreakdown.baseSubtotal).toBe(100.0);
    expect(quote.costBreakdown.speedAdjustedSubtotal).toBe(200.0);
    expect(quote.costBreakdown.taxRate).toBe(18.0);
    expect(quote.costBreakdown.cgstAmount).toBe(parseFloat((quote.costBreakdown.taxAmount / 2).toFixed(2)));
  });

  test('Multi-Tier SLA: Rejects Hyperlocal 2H on Inter-Zone orders', async () => {
    // 110001 (North Zone) to 110016 (South Zone) -> INTER
    await expect(
      calculateRate({
        pickupPincode: '110001',
        dropPincode: '110016',
        lengthCm: 20,
        breadthCm: 15,
        heightCm: 10,
        actualWeightKg: 2.5,
        orderType: 'B2C',
        paymentType: 'PREPAID',
        deliveryTierCode: 'HYPERLOCAL_2H'
      })
    ).rejects.toThrow(/only available for Intra-Zone/i);
  });

  test('Dynamic Surge: Applies Remote Area fee for peripheral pincode 110058', async () => {
    // Drop at 110058 (Janakpuri Outer - Remote Area Rule: Flat 40.0)
    const quote = await calculateRate({
      pickupPincode: '110001',
      dropPincode: '110058',
      lengthCm: 10,
      breadthCm: 10,
      heightCm: 10,
      actualWeightKg: 1.0,
      orderType: 'B2C',
      paymentType: 'PREPAID',
      deliveryTierCode: 'NEXT_DAY_STANDARD'
    });

    const remoteSurge = quote.costBreakdown.appliedSurges.find(s => s.type === 'REMOTE_AREA');
    expect(remoteSurge).toBeDefined();
    expect(remoteSurge.amount).toBe(40.0);
  });

  test('Enterprise Contract: Custom rates and 10% volume discount applied for VIP client', async () => {
    // Enterprise client (Base: 100, Rate/kg: 12, Discount: 10%)
    // Shipment: 110001 -> 110016 (INTER), 10 kg B2B
    // Base Cost = 100 + (10 * 12) = 220.00
    // Speed Standard (1.0x) = 220.00
    // Discount 10% = 22.00 -> Discounted = 198.00
    const quote = await calculateRate({
      pickupPincode: '110001',
      dropPincode: '110016',
      lengthCm: 20,
      breadthCm: 20,
      heightCm: 20,
      actualWeightKg: 10.0,
      orderType: 'B2B',
      paymentType: 'PREPAID',
      deliveryTierCode: 'NEXT_DAY_STANDARD',
      customerId: enterpriseUserId
    });

    expect(quote.isContractApplied).toBe(true);
    expect(quote.costBreakdown.baseCharge).toBe(100.0);
    expect(quote.costBreakdown.ratePerKg).toBe(12.0);
    expect(quote.costBreakdown.discountPercentage).toBe(10.0);
    expect(quote.costBreakdown.discountAmount).toBe(22.0);
  });

  test('Order Placement with Automated GST Invoice and PDF downloads', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        pickupAddress: 'Connaught Place Warehouse',
        pickupPincode: '110001',
        dropAddress: 'Mayur Vihar Phase 1',
        dropPincode: '110091',
        lengthCm: 25,
        breadthCm: 20,
        heightCm: 15,
        actualWeightKg: 2.0,
        orderType: 'B2C',
        paymentType: 'PREPAID',
        deliveryTierCode: 'SAME_DAY_EXPRESS',
        autoAssign: false
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.order.speedMultiplier).toBe(1.5);
    expect(res.body.invoice).toBeDefined();
    expect(res.body.invoice.invoiceNumber).toMatch(/^INV-/);

    const orderId = res.body.order.id;

    // Test Shipping Label PDF Generation
    const labelRes = await request(app)
      .get(`/api/orders/${orderId}/label`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(labelRes.status).toBe(200);
    expect(labelRes.headers['content-type']).toBe('application/pdf');

    // Test Tax Invoice PDF Generation
    const invoiceRes = await request(app)
      .get(`/api/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(invoiceRes.status).toBe(200);
    expect(invoiceRes.headers['content-type']).toBe('application/pdf');
  });
});
