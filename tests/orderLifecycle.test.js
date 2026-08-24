const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');

describe('Order Lifecycle, Auto-Assignment, and Tracking Integration Tests', () => {
  let adminToken = '';
  let customerToken = '';
  let agentToken = '';
  let customerId = '';
  let agentId = '';

  beforeAll(async () => {
    // 1. Login as Admin
    const adminRes = await request(app).post('/api/auth/login').send({
      email: 'admin@tracker.com',
      password: 'Admin@123'
    });
    adminToken = adminRes.body.token;

    // 2. Login as Customer
    const customerRes = await request(app).post('/api/auth/login').send({
      email: 'customer@tracker.com',
      password: 'Customer@123'
    });
    customerToken = customerRes.body.token;
    customerId = customerRes.body.user.id;

    // 3. Login as Agent North
    const agentRes = await request(app).post('/api/auth/login').send({
      email: 'agent.north@tracker.com',
      password: 'Agent@123'
    });
    agentToken = agentRes.body.token;
    agentId = agentRes.body.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('Customer creates order with auto-calculation and auto-assignment', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        pickupAddress: 'Shop 12, Connaught Place',
        pickupPincode: '110001', // North Zone
        dropAddress: 'Flat 401, Hauz Khas',
        dropPincode: '110016', // South Zone
        lengthCm: 30,
        breadthCm: 20,
        heightCm: 15, // Volumetric = 9000 / 5000 = 1.8 kg
        actualWeightKg: 3.0, // Billed Weight = 3.0 kg
        orderType: 'B2C',
        paymentType: 'COD',
        autoAssign: true
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.order.trackingNumber).toMatch(/^TRK-/);
    expect(res.body.order.status).toBe('ASSIGNED');
    expect(res.body.order.agentId).toBeDefined();
    // B2C INTER: base 80 + (3.0 * 35 = 105) + COD 30 = 215.00
    expect(res.body.order.totalCharge).toBe(215.0);

    const orderId = res.body.order.id;
    const trackingNumber = res.body.order.trackingNumber;

    // Verify tracking events
    const orderDetails = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(orderDetails.status).toBe(200);
    expect(orderDetails.body.order.trackingEvents.length).toBeGreaterThanOrEqual(2); // CREATED + ASSIGNED

    // Agent advances status: ASSIGNED -> PICKED_UP
    const pickupRes = await request(app)
      .patch(`/api/agent/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        status: 'PICKED_UP',
        note: 'Package received from merchant in good condition.'
      });

    expect(pickupRes.status).toBe(200);
    expect(pickupRes.body.order.status).toBe('PICKED_UP');

    // Agent advances status: PICKED_UP -> IN_TRANSIT
    const transitRes = await request(app)
      .patch(`/api/agent/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'IN_TRANSIT' });

    expect(transitRes.status).toBe(200);
    expect(transitRes.body.order.status).toBe('IN_TRANSIT');

    // Agent advances status: IN_TRANSIT -> OUT_FOR_DELIVERY
    const outRes = await request(app)
      .patch(`/api/agent/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'OUT_FOR_DELIVERY' });

    expect(outRes.status).toBe(200);
    expect(outRes.body.order.status).toBe('OUT_FOR_DELIVERY');

    // Delivery Fails: OUT_FOR_DELIVERY -> FAILED
    const failRes = await request(app)
      .patch(`/api/agent/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        status: 'FAILED',
        failureReason: 'Customer premises locked and phone unreachable.'
      });

    expect(failRes.status).toBe(200);
    expect(failRes.body.order.status).toBe('FAILED');
    expect(failRes.body.order.failureReason).toContain('Customer premises locked');

    // Customer Reschedules the failed order
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const rescheduleRes = await request(app)
      .post(`/api/orders/${orderId}/reschedule`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        newScheduledDate: dateStr,
        note: 'Please deliver after 2 PM tomorrow.'
      });

    expect(rescheduleRes.status).toBe(200);
    expect(rescheduleRes.body.order.status).toBe('ASSIGNED');

    // Verify Public Tracking Endpoint
    const publicTrack = await request(app).get(`/api/tracking/${trackingNumber}`);
    expect(publicTrack.status).toBe(200);
    expect(publicTrack.body.shipment.trackingNumber).toBe(trackingNumber);
    expect(publicTrack.body.shipment.timeline.length).toBeGreaterThanOrEqual(6);
  });

  test('Rejects invalid status transitions', async () => {
    // Create an order without autoAssign (status: CREATED)
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        pickupAddress: 'Karol Bagh Market',
        pickupPincode: '110005',
        dropAddress: 'Daryaganj',
        dropPincode: '110002',
        lengthCm: 10,
        breadthCm: 10,
        heightCm: 10,
        actualWeightKg: 1,
        orderType: 'B2C',
        paymentType: 'PREPAID',
        autoAssign: false
      });

    const orderId = res.body.order.id;

    // Agent attempts to directly mark CREATED as DELIVERED -> Must Fail
    const invalidRes = await request(app)
      .patch(`/api/agent/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'DELIVERED' });

    expect(invalidRes.status).toBe(403); // Agent not assigned to unassigned order
  });

  test('Enforces Role-Based Access on Admin Routes', async () => {
    const res = await request(app)
      .get('/api/admin/zones')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
