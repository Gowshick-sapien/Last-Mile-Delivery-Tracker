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

function generateInvoiceNumber() {
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INV-${datePrefix}-${randomSuffix}`;
}

/**
 * Creates a new delivery order with pricing, tax breakdown, and automated invoice creation.
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
  orderType = 'B2C',
  paymentType = 'PREPAID',
  deliveryTierCode = 'NEXT_DAY_STANDARD',
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

  // 1. Calculate rate and resolve pricing, surge, SLAs, and taxes
  const rateQuote = await calculateRate({
    pickupPincode,
    dropPincode,
    lengthCm,
    breadthCm,
    heightCm,
    actualWeightKg,
    orderType,
    paymentType,
    deliveryTierCode,
    customerId
  });

  const trackingNumber = generateTrackingNumber();
  const invoiceNumber = generateInvoiceNumber();

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
      deliveryTierCode: rateQuote.deliveryTier.code,
      speedMultiplier: rateQuote.deliveryTier.multiplier,
      baseCharge: rateQuote.costBreakdown.baseCharge,
      weightCharge: rateQuote.costBreakdown.baseWeightCharge,
      discountAmount: rateQuote.costBreakdown.discountAmount,
      surgeAmount: rateQuote.costBreakdown.surgeAmount,
      codSurcharge: rateQuote.costBreakdown.codSurcharge,
      taxableAmount: rateQuote.costBreakdown.taxableAmount,
      taxAmount: rateQuote.costBreakdown.taxAmount,
      totalCharge: rateQuote.costBreakdown.totalCharge,
      status: 'CREATED'
    },
    include: {
      customer: true,
      pickupZone: true,
      dropZone: true
    }
  });

  // 3. Create GST Tax Invoice
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      orderId: order.id,
      taxableAmount: rateQuote.costBreakdown.taxableAmount,
      taxRate: rateQuote.costBreakdown.taxRate,
      cgstAmount: rateQuote.costBreakdown.cgstAmount,
      sgstAmount: rateQuote.costBreakdown.sgstAmount,
      igstAmount: rateQuote.costBreakdown.igstAmount,
      totalAmount: rateQuote.costBreakdown.totalCharge,
      isInterState: rateQuote.zoneType === 'INTER'
    }
  });

  // 4. Create initial tracking event
  await prisma.trackingEvent.create({
    data: {
      orderId: order.id,
      status: 'CREATED',
      actorId: creatorId || customerId,
      actorRole: creatorRole,
      note: `Shipment confirmed. SLA: ${rateQuote.deliveryTier.name}, Billed: ${order.billedWeightKg}kg, Total: INR ${order.totalCharge.toFixed(2)} (Tax Incl.)`
    }
  });

  // 5. Dispatch confirmation notification
  await sendNotification({
    order,
    eventType: 'CREATED'
  });

  // 6. Auto-assign if requested
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
    invoice,
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
      invoice: true,
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
      invoice: true,
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
async function getAdminOrders({ status, zoneId, agentId, orderType, paymentType, deliveryTierCode, search }) {
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

  if (deliveryTierCode && deliveryTierCode.trim() !== '') {
    where.deliveryTierCode = deliveryTierCode.trim().toUpperCase();
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
      invoice: true,
      trackingEvents: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });
}

module.exports = {
  generateTrackingNumber,
  generateInvoiceNumber,
  createOrder,
  getCustomerOrders,
  getOrderDetails,
  getAdminOrders
};
