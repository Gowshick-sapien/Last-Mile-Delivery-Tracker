const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { autoAssignAgent, manualAssignAgent } = require('../services/assignment.service');
const { updateOrderStatus } = require('../services/status.service');
const { createOrder, getAdminOrders } = require('../services/order.service');

const router = express.Router();

router.use(authenticateToken, requireRole('ADMIN'));

// --- Overview Metrics ---
router.get('/stats', async (req, res, next) => {
  try {
    const totalOrders = await prisma.order.count();
    const activeOrders = await prisma.order.count({
      where: { status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] } }
    });
    const deliveredOrders = await prisma.order.count({
      where: { status: 'DELIVERED' }
    });
    const failedOrders = await prisma.order.count({
      where: { status: 'FAILED' }
    });
    const totalRevenueResult = await prisma.order.aggregate({
      _sum: { totalCharge: true }
    });
    const totalAgents = await prisma.user.count({
      where: { role: 'AGENT' }
    });
    const totalZones = await prisma.zone.count();
    const totalContracts = await prisma.clientContract.count({ where: { isActive: true } });

    res.json({
      success: true,
      stats: {
        totalOrders,
        activeOrders,
        deliveredOrders,
        failedOrders,
        totalRevenue: totalRevenueResult._sum.totalCharge || 0,
        totalAgents,
        totalZones,
        totalContracts
      }
    });
  } catch (error) {
    next(error);
  }
});

// --- Delivery Tiers (SLAs) ---
router.get('/delivery-tiers', async (req, res, next) => {
  try {
    const tiers = await prisma.deliveryTier.findMany({ orderBy: { multiplier: 'asc' } });
    res.json({ success: true, tiers });
  } catch (error) {
    next(error);
  }
});

router.post('/delivery-tiers', async (req, res, next) => {
  try {
    const { code, name, multiplier, slaHours, cutoffHour, allowedZoneType } = req.body;
    const tier = await prisma.deliveryTier.create({
      data: {
        code: code.toUpperCase().trim(),
        name: name.trim(),
        multiplier: parseFloat(multiplier),
        slaHours: parseInt(slaHours) || 24,
        cutoffHour: cutoffHour ? parseInt(cutoffHour) : null,
        allowedZoneType: allowedZoneType || 'ALL',
        isActive: true
      }
    });
    res.status(201).json({ success: true, message: 'Delivery tier created.', tier });
  } catch (error) {
    next(error);
  }
});

router.put('/delivery-tiers/:id', async (req, res, next) => {
  try {
    const { name, multiplier, slaHours, cutoffHour, allowedZoneType, isActive } = req.body;
    const tier = await prisma.deliveryTier.update({
      where: { id: req.params.id },
      data: {
        name: name ? name.trim() : undefined,
        multiplier: multiplier !== undefined ? parseFloat(multiplier) : undefined,
        slaHours: slaHours !== undefined ? parseInt(slaHours) : undefined,
        cutoffHour: cutoffHour !== undefined ? (cutoffHour ? parseInt(cutoffHour) : null) : undefined,
        allowedZoneType: allowedZoneType || undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined
      }
    });
    res.json({ success: true, message: 'Delivery tier updated.', tier });
  } catch (error) {
    next(error);
  }
});

// --- Dynamic Surge Rules ---
router.get('/surge-rules', async (req, res, next) => {
  try {
    const rules = await prisma.surgeRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: { zone: true }
    });
    res.json({ success: true, rules });
  } catch (error) {
    next(error);
  }
});

router.post('/surge-rules', async (req, res, next) => {
  try {
    const { name, surgeType, multiplier, flatAmount, startHour, endHour, zoneId, pincode } = req.body;
    const rule = await prisma.surgeRule.create({
      data: {
        name: name.trim(),
        surgeType: surgeType.toUpperCase().trim(),
        multiplier: multiplier !== undefined ? parseFloat(multiplier) : 1.0,
        flatAmount: flatAmount !== undefined ? parseFloat(flatAmount) : 0.0,
        startHour: startHour !== undefined && startHour !== '' ? parseInt(startHour) : null,
        endHour: endHour !== undefined && endHour !== '' ? parseInt(endHour) : null,
        zoneId: zoneId || null,
        pincode: pincode ? String(pincode).trim() : null,
        isActive: true
      }
    });
    res.status(201).json({ success: true, message: 'Surge rule created.', rule });
  } catch (error) {
    next(error);
  }
});

router.put('/surge-rules/:id', async (req, res, next) => {
  try {
    const { name, multiplier, flatAmount, startHour, endHour, isActive } = req.body;
    const rule = await prisma.surgeRule.update({
      where: { id: req.params.id },
      data: {
        name: name ? name.trim() : undefined,
        multiplier: multiplier !== undefined ? parseFloat(multiplier) : undefined,
        flatAmount: flatAmount !== undefined ? parseFloat(flatAmount) : undefined,
        startHour: startHour !== undefined ? parseInt(startHour) : undefined,
        endHour: endHour !== undefined ? parseInt(endHour) : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined
      }
    });
    res.json({ success: true, message: 'Surge rule updated.', rule });
  } catch (error) {
    next(error);
  }
});

router.delete('/surge-rules/:id', async (req, res, next) => {
  try {
    await prisma.surgeRule.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Surge rule deleted.' });
  } catch (error) {
    next(error);
  }
});

// --- Enterprise Client Contracts ---
router.get('/client-contracts', async (req, res, next) => {
  try {
    const contracts = await prisma.clientContract.findMany({
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, contracts });
  } catch (error) {
    next(error);
  }
});

router.post('/client-contracts', async (req, res, next) => {
  try {
    const { customerEmail, customBaseCharge, customRatePerKg, discountPercentage, minMonthlyVolume } = req.body;
    const customer = await prisma.user.findUnique({
      where: { email: customerEmail.toLowerCase().trim() }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: `No user found with email '${customerEmail}'.` });
    }

    const contract = await prisma.clientContract.upsert({
      where: { customerId: customer.id },
      update: {
        customBaseCharge: customBaseCharge !== undefined ? parseFloat(customBaseCharge) : null,
        customRatePerKg: customRatePerKg !== undefined ? parseFloat(customRatePerKg) : null,
        discountPercentage: discountPercentage !== undefined ? parseFloat(discountPercentage) : 0.0,
        minMonthlyVolume: minMonthlyVolume !== undefined ? parseInt(minMonthlyVolume) : 0,
        isActive: true
      },
      create: {
        customerId: customer.id,
        customBaseCharge: customBaseCharge !== undefined ? parseFloat(customBaseCharge) : null,
        customRatePerKg: customRatePerKg !== undefined ? parseFloat(customRatePerKg) : null,
        discountPercentage: discountPercentage !== undefined ? parseFloat(discountPercentage) : 0.0,
        minMonthlyVolume: minMonthlyVolume !== undefined ? parseInt(minMonthlyVolume) : 0,
        isActive: true
      },
      include: { customer: true }
    });

    res.json({ success: true, message: 'Client contract saved successfully.', contract });
  } catch (error) {
    next(error);
  }
});

// --- Zone Management ---
router.get('/zones', async (req, res, next) => {
  try {
    const zones = await prisma.zone.findMany({
      orderBy: { name: 'asc' },
      include: {
        areas: { orderBy: { pincode: 'asc' } },
        agents: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
        _count: { select: { areas: true, agents: true, pickupOrders: true } }
      }
    });
    res.json({ success: true, zones });
  } catch (error) {
    next(error);
  }
});

router.post('/zones', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const zone = await prisma.zone.create({
      data: { name: name.trim(), description: description ? description.trim() : null }
    });
    res.status(201).json({ success: true, message: 'Zone created.', zone });
  } catch (error) {
    next(error);
  }
});

router.delete('/zones/:id', async (req, res, next) => {
  try {
    await prisma.zone.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Zone deleted.' });
  } catch (error) {
    next(error);
  }
});

// --- Area / Pincode Mapping ---
router.get('/areas', async (req, res, next) => {
  try {
    const areas = await prisma.area.findMany({
      orderBy: { pincode: 'asc' },
      include: { zone: true }
    });
    res.json({ success: true, areas });
  } catch (error) {
    next(error);
  }
});

router.post('/areas', async (req, res, next) => {
  try {
    const { pincode, areaName, zoneId } = req.body;
    const area = await prisma.area.create({
      data: { pincode: String(pincode).trim(), areaName: areaName.trim(), zoneId },
      include: { zone: true }
    });
    res.status(201).json({ success: true, message: 'Area mapped.', area });
  } catch (error) {
    next(error);
  }
});

router.delete('/areas/:id', async (req, res, next) => {
  try {
    await prisma.area.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Area deleted.' });
  } catch (error) {
    next(error);
  }
});

// --- Rate Cards Management ---
router.get('/rate-cards', async (req, res, next) => {
  try {
    const rateCards = await prisma.rateCard.findMany({
      orderBy: [{ orderType: 'asc' }, { zoneType: 'asc' }]
    });
    res.json({ success: true, rateCards });
  } catch (error) {
    next(error);
  }
});

router.put('/rate-cards', async (req, res, next) => {
  try {
    const { orderType, zoneType, baseCharge, ratePerKg } = req.body;
    const rateCard = await prisma.rateCard.upsert({
      where: {
        orderType_zoneType: {
          orderType: orderType.toUpperCase().trim(),
          zoneType: zoneType.toUpperCase().trim()
        }
      },
      update: {
        baseCharge: parseFloat(baseCharge),
        ratePerKg: parseFloat(ratePerKg)
      },
      create: {
        orderType: orderType.toUpperCase().trim(),
        zoneType: zoneType.toUpperCase().trim(),
        baseCharge: parseFloat(baseCharge),
        ratePerKg: parseFloat(ratePerKg)
      }
    });
    res.json({ success: true, message: 'Rate card updated.', rateCard });
  } catch (error) {
    next(error);
  }
});

// --- COD Surcharges Management ---
router.get('/cod-surcharges', async (req, res, next) => {
  try {
    const surcharges = await prisma.cODSurcharge.findMany({ orderBy: { orderType: 'asc' } });
    res.json({ success: true, surcharges });
  } catch (error) {
    next(error);
  }
});

router.put('/cod-surcharges', async (req, res, next) => {
  try {
    const { orderType, surchargeAmount } = req.body;
    const surcharge = await prisma.cODSurcharge.upsert({
      where: { orderType: orderType.toUpperCase().trim() },
      update: { surchargeAmount: parseFloat(surchargeAmount) },
      create: {
        orderType: orderType.toUpperCase().trim(),
        surchargeAmount: parseFloat(surchargeAmount)
      }
    });
    res.json({ success: true, message: 'COD surcharge updated.', surcharge });
  } catch (error) {
    next(error);
  }
});

// --- Agent Management ---
router.get('/agents', async (req, res, next) => {
  try {
    const agents = await prisma.user.findMany({
      where: { role: 'AGENT' },
      include: { agentProfile: { include: { currentZone: true } } },
      orderBy: { name: 'asc' }
    });

    const agentsWithStats = await Promise.all(
      agents.map(async (agent) => {
        const activeCount = await prisma.order.count({
          where: {
            agentId: agent.id,
            status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] }
          }
        });
        const completedCount = await prisma.order.count({
          where: { agentId: agent.id, status: 'DELIVERED' }
        });
        return {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          isAvailable: agent.agentProfile?.isAvailable ?? true,
          zoneId: agent.agentProfile?.currentZoneId,
          zoneName: agent.agentProfile?.currentZone?.name || 'Unassigned',
          activeOrders: activeCount,
          completedOrders: completedCount
        };
      })
    );

    res.json({ success: true, agents: agentsWithStats });
  } catch (error) {
    next(error);
  }
});

router.post('/agents', async (req, res, next) => {
  try {
    const { name, email, password, phone, zoneId } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        phone: phone ? phone.trim() : null,
        role: 'AGENT'
      }
    });

    await prisma.agentProfile.create({
      data: {
        userId: user.id,
        currentZoneId: zoneId || null,
        isAvailable: true
      }
    });

    res.status(201).json({ success: true, message: 'Delivery agent registered.' });
  } catch (error) {
    next(error);
  }
});

// --- Admin Orders Management ---
router.get('/orders', async (req, res, next) => {
  try {
    const { status, zoneId, agentId, orderType, paymentType, deliveryTierCode, search } = req.query;
    const orders = await getAdminOrders({ status, zoneId, agentId, orderType, paymentType, deliveryTierCode, search });
    res.json({ success: true, orders });
  } catch (error) {
    next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const {
      customerEmail,
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
      deliveryTierCode,
      autoAssign = true
    } = req.body;

    const customer = await prisma.user.findUnique({
      where: { email: customerEmail.toLowerCase().trim() }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer account not found.' });
    }

    const result = await createOrder({
      customerId: customer.id,
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
      deliveryTierCode,
      autoAssign,
      creatorRole: 'ADMIN',
      creatorId: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Order created for customer.',
      order: result.order,
      invoice: result.invoice,
      rateQuote: result.rateQuote,
      assignedAgent: result.assignedAgent
    });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/assign', async (req, res, next) => {
  try {
    const result = await manualAssignAgent(req.params.id, req.body.agentId, req.user.id, 'ADMIN');
    res.json({ success: true, message: 'Agent assigned.', ...result });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/auto-assign', async (req, res, next) => {
  try {
    const result = await autoAssignAgent(req.params.id, req.user.id, 'ADMIN');
    res.json({ success: true, message: 'Auto-assignment completed.', ...result });
  } catch (error) {
    next(error);
  }
});

router.patch('/orders/:id/override-status', async (req, res, next) => {
  try {
    const { status, note, failureReason } = req.body;
    const updatedOrder = await updateOrderStatus({
      orderId: req.params.id,
      newStatus: status,
      actorId: req.user.id,
      actorRole: 'ADMIN',
      note,
      failureReason,
      isOverride: true
    });
    res.json({ success: true, message: `Status overridden to '${status}'.`, order: updatedOrder });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
