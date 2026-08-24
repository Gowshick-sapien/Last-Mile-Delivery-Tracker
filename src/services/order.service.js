const crypto = require('crypto');
const prisma = require('../config/prisma');
const { calculateRate } = require('./rateCalculator.service');
const { autoAssignAgent } = require('./assignment.service');
const { sendNotification } = require('./notification.service');

function generateTrackingNumber() {
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TRK-${datePrefix}-${randomSuffix}`;
}

/**
 * Creates a new delivery order.
 * - Computes rate breakdown dynamically
 * - Resolves pickup and drop zones
 * - Persists order
 * - Appends initial TrackingEvent
 * - Sends confirmation notification
 * - Optionally triggers immediate auto-assignment
 */
async function createOrder({
  customerId,
  pickupAddress,
  pickupPincode,
  dropAddress,
  dropPincode,
  lengthCm,
  breadthCm,
  heightCm,
  actualWeightKg,
  orderType,
  paymentType,
  autoAssign = false,
  creatorRole = 'CUSTOMER',
  creatorId = null
}) {
  if (!pickupAddress || !pickupAddress.trim()) {
    const err = new Error('Pickup address is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!dropAddress || !dropAddress.trim()) {
    const err = new Error('Drop address is required.');
    err.statusCode = 400;
    throw err;
  }

  // 1. Calculate rate and resolve zones
  const rateQuote = await calculateRate({
    pickupPincode,
    dropPincode,
    lengthCm,
    breadthCm,
    heightCm,
    actualWeightKg,
    orderType,
    paymentType
  });

  const trackingNumber = generateTrackingNumber();

  // 2. Persist order in database
  const order = await prisma.order.create({
    data: {
      trackingNumber,
      customerId,
      pickupAddress: pickupAddress.trim(),
      pickupPincode: String(pickupPincode).trim(),
      pickupZoneId: rateQuote.pickupArea.zoneId,
      dropAddress: dropAddress.trim(),
      dropPincode: String(dropPincode).trim(),
      dropZoneId: rateQuote.dropArea.zoneId,
      lengthCm: rateQuote.dimensions.lengthCm,
      breadthCm: rateQuote.dimensions.breadthCm,
      heightCm: rateQuote.dimensions.heightCm,
      actualWeightKg: rateQuote.weightDetails.actualWeightKg,
      volumetricWeightKg: rateQuote.weightDetails.volumetricWeightKg,
      billedWeightKg: rateQuote.weightDetails.billedWeightKg,
      orderType: rateQuote.orderType,
      paymentType: rateQuote.paymentType,
      zoneType: rateQuote.zoneType,
      baseCharge: rateQuote.costBreakdown.baseCharge,
      weightCharge: rateQuote.costBreakdown.weightCharge,
      codSurcharge: rateQuote.costBreakdown.codSurcharge,
      totalCharge: rateQuote.costBreakdown.totalCharge,
      status: 'CREATED'
    },
    include: {
      customer: true,
      pickupZone: true,
      dropZone: true
    }
  });

  // 3. Create initial tracking event
  await prisma.trackingEvent.create({
    data: {
      orderId: order.id,
      status: 'CREATED',
      actorId: creatorId || customerId,
      actorRole: creatorRole,
      note: `Order placed. Billed Weight: ${order.billedWeightKg}kg, Total: INR ${order.totalCharge.toFixed(2)} (${order.paymentType})`
    }
  });

  // 4. Dispatch order confirmation notification
  await sendNotification({
    order,
    eventType: 'CREATED'
  });

  // 5. If autoAssign requested, run assignment
  let assignedAgent = null;
  if (autoAssign) {
    try {
      const assignmentResult = await autoAssignAgent(order.id, creatorId, creatorRole);
      assignedAgent = assignmentResult.assignedAgent;
      order.status = 'ASSIGNED';
      order.agentId = assignedAgent.id;
    } catch (assignError) {
      console.warn(`[Order Create] Auto-assign skipped: ${assignError.message}`);
    }
  }

  return {
    order,
    rateQuote,
    assignedAgent
  };
}

/**
 * Fetch orders for a specific customer
 */
async function getCustomerOrders(customerId) {
  return prisma.order.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      pickupZone: true,
      dropZone: true,
      agent: {
        select: { id: true, name: true, phone: true, email: true }
      },
      trackingEvents: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });
}

/**
 * Fetch a single order by ID or Tracking Number
 */
async function getOrderDetails(identifier) {
  return prisma.order.findFirst({
    where: {
      OR: [
        { id: identifier },
        { trackingNumber: identifier }
      ]
    },
    include: {
      customer: {
        select: { id: true, name: true, email: true, phone: true }
      },
      agent: {
        select: { id: true, name: true, email: true, phone: true }
      },
      pickupZone: true,
      dropZone: true,
      trackingEvents: {
        orderBy: { createdAt: 'asc' },
        include: {
          actor: {
            select: { id: true, name: true, role: true }
          }
        }
      },
      notifications: {
        orderBy: { createdAt: 'desc' }
      }
    }
  });
}

/**
 * Fetch all orders for admin with optional filters
 */
async function getAdminOrders({ status, zoneId, agentId, orderType, paymentType, search }) {
  const where = {};

  if (status && status.trim() !== '') {
    where.status = status.trim().toUpperCase();
  }

  if (zoneId && zoneId.trim() !== '') {
    where.OR = [
      { pickupZoneId: zoneId },
      { dropZoneId: zoneId }
    ];
  }

  if (agentId && agentId.trim() !== '') {
    where.agentId = agentId;
  }

  if (orderType && orderType.trim() !== '') {
    where.orderType = orderType.trim().toUpperCase();
  }

  if (paymentType && paymentType.trim() !== '') {
    where.paymentType = paymentType.trim().toUpperCase();
  }

  if (search && search.trim() !== '') {
    const term = search.trim();
    where.OR = [
      { trackingNumber: { contains: term } },
      { pickupAddress: { contains: term } },
      { dropAddress: { contains: term } },
      { customer: { name: { contains: term } } },
      { customer: { email: { contains: term } } }
    ];
  }

  return prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: {
        select: { id: true, name: true, email: true, phone: true }
      },
      agent: {
        select: { id: true, name: true, email: true, phone: true }
      },
      pickupZone: true,
      dropZone: true,
      trackingEvents: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });
}

module.exports = {
  generateTrackingNumber,
  createOrder,
  getCustomerOrders,
  getOrderDetails,
  getAdminOrders
};
