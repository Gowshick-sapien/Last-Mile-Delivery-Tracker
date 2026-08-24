const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { autoAssignAgent, manualAssignAgent } = require('../services/assignment.service');
const { updateOrderStatus } = require('../services/status.service');
const { createOrder, getAdminOrders } = require('../services/order.service');

const router = express.Router();

// Guard all admin routes with authentication and ADMIN role
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

    res.json({
      success: true,
      stats: {
        totalOrders,
        activeOrders,
        deliveredOrders,
        failedOrders,
        totalRevenue: totalRevenueResult._sum.totalCharge || 0,
        totalAgents,
        totalZones
      }
    });
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
        agents: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } }
          }
        },
        _count: {
          select: { areas: true, agents: true, pickupOrders: true }
        }
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
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Zone name is required.' });
    }

    const existing = await prisma.zone.findUnique({
      where: { name: name.trim() }
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A zone with this name already exists.' });
    }

    const zone = await prisma.zone.create({
      data: {
        name: name.trim(),
        description: description ? description.trim() : null
      }
    });
    res.status(201).json({ success: true, message: 'Zone created successfully.', zone });
  } catch (error) {
    next(error);
  }
});

router.put('/zones/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const updated = await prisma.zone.update({
      where: { id },
      data: {
        name: name ? name.trim() : undefined,
        description: description !== undefined ? description : undefined
      }
    });
    res.json({ success: true, message: 'Zone updated.', zone: updated });
  } catch (error) {
    next(error);
  }
});

router.delete('/zones/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.zone.delete({ where: { id } });
    res.json({ success: true, message: 'Zone deleted successfully.' });
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
    if (!pincode || !areaName || !zoneId) {
      return res.status(400).json({ success: false, message: 'Pincode, area name, and zone ID are required.' });
    }

    const existing = await prisma.area.findUnique({
      where: { pincode: String(pincode).trim() }
    });
    if (existing) {
      return res.status(409).json({ success: false, message: `Pincode ${pincode} is already mapped to an existing zone.` });
    }

    const area = await prisma.area.create({
      data: {
        pincode: String(pincode).trim(),
        areaName: areaName.trim(),
        zoneId
      },
      include: { zone: true }
    });
    res.status(201).json({ success: true, message: 'Area mapped to zone successfully.', area });
  } catch (error) {
    next(error);
  }
});

router.put('/areas/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pincode, areaName, zoneId } = req.body;

    const updated = await prisma.area.update({
      where: { id },
      data: {
        pincode: pincode ? String(pincode).trim() : undefined,
        areaName: areaName ? areaName.trim() : undefined,
        zoneId: zoneId || undefined
      },
      include: { zone: true }
    });
    res.json({ success: true, message: 'Area updated.', area: updated });
  } catch (error) {
    next(error);
  }
});

router.delete('/areas/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.area.delete({ where: { id } });
    res.json({ success: true, message: 'Area removed successfully.' });
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

    if (!orderType || !zoneType || baseCharge === undefined || ratePerKg === undefined) {
      return res.status(400).json({ success: false, message: 'orderType, zoneType, baseCharge, and ratePerKg are required.' });
    }

    const cleanOrderType = orderType.toUpperCase().trim();
    const cleanZoneType = zoneType.toUpperCase().trim();

    const rateCard = await prisma.rateCard.upsert({
      where: {
        orderType_zoneType: {
          orderType: cleanOrderType,
          zoneType: cleanZoneType
        }
      },
      update: {
        baseCharge: parseFloat(baseCharge),
        ratePerKg: parseFloat(ratePerKg)
      },
      create: {
        orderType: cleanOrderType,
        zoneType: cleanZoneType,
        baseCharge: parseFloat(baseCharge),
        ratePerKg: parseFloat(ratePerKg)
      }
    });

    res.json({ success: true, message: 'Rate card updated successfully.', rateCard });
  } catch (error) {
    next(error);
  }
});

// --- COD Surcharges Management ---
router.get('/cod-surcharges', async (req, res, next) => {
  try {
    const surcharges = await prisma.cODSurcharge.findMany({
      orderBy: { orderType: 'asc' }
    });
    res.json({ success: true, surcharges });
  } catch (error) {
    next(error);
  }
});

router.put('/cod-surcharges', async (req, res, next) => {
  try {
    const { orderType, surchargeAmount } = req.body;

    if (!orderType || surchargeAmount === undefined) {
      return res.status(400).json({ success: false, message: 'orderType and surchargeAmount are required.' });
    }

    const cleanOrderType = orderType.toUpperCase().trim();

    const surcharge = await prisma.cODSurcharge.upsert({
      where: { orderType: cleanOrderType },
      update: { surchargeAmount: parseFloat(surchargeAmount) },
      create: {
        orderType: cleanOrderType,
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
      include: {
        agentProfile: {
          include: { currentZone: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    // Compute active order workload for each agent
    const agentsWithStats = await Promise.all(
      agents.map(async (agent) => {
        const activeCount = await prisma.order.count({
          where: {
            agentId: agent.id,
            status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] }
          }
        });
        const completedCount = await prisma.order.count({
          where: {
            agentId: agent.id,
            status: 'DELIVERED'
          }
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

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'User with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        passwordHash,
        phone: phone ? phone.trim() : null,
        role: 'AGENT'
      }
    });

    const profile = await prisma.agentProfile.create({
      data: {
        userId: user.id,
        currentZoneId: zoneId || null,
        isAvailable: true
      },
      include: { currentZone: true }
    });

    res.status(201).json({
      success: true,
      message: 'Delivery agent created successfully.',
      agent: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isAvailable: profile.isAvailable,
        zoneName: profile.currentZone?.name || 'Unassigned'
      }
    });
  } catch (error) {
    next(error);
  }
});

// --- Admin Order Operations ---
router.get('/orders', async (req, res, next) => {
  try {
    const { status, zoneId, agentId, orderType, paymentType, search } = req.query;
    const orders = await getAdminOrders({ status, zoneId, agentId, orderType, paymentType, search });
    res.json({ success: true, orders });
  } catch (error) {
    next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const {
      customerId,
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
      autoAssign = true
    } = req.body;

    let targetCustomerId = customerId;

    if (!targetCustomerId && customerEmail) {
      const customer = await prisma.user.findUnique({
        where: { email: customerEmail.toLowerCase().trim() }
      });
      if (customer) {
        targetCustomerId = customer.id;
      }
    }

    if (!targetCustomerId) {
      return res.status(400).json({ success: false, message: 'Valid customerId or customerEmail is required.' });
    }

    const result = await createOrder({
      customerId: targetCustomerId,
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
      autoAssign,
      creatorRole: 'ADMIN',
      creatorId: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Order created on behalf of customer.',
      order: result.order,
      rateQuote: result.rateQuote,
      assignedAgent: result.assignedAgent
    });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/assign', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { agentId } = req.body;

    if (!agentId) {
      return res.status(400).json({ success: false, message: 'agentId is required for manual assignment.' });
    }

    const result = await manualAssignAgent(id, agentId, req.user.id, 'ADMIN');
    res.json({ success: true, message: 'Agent assigned successfully.', ...result });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/auto-assign', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await autoAssignAgent(id, req.user.id, 'ADMIN');
    res.json({ success: true, message: 'Auto-assignment completed successfully.', ...result });
  } catch (error) {
    next(error);
  }
});

router.patch('/orders/:id/override-status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note, failureReason } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'New status is required.' });
    }

    const updatedOrder = await updateOrderStatus({
      orderId: id,
      newStatus: status,
      actorId: req.user.id,
      actorRole: 'ADMIN',
      note: note || 'Administrative status override',
      failureReason,
      isOverride: true
    });

    res.json({ success: true, message: `Order status overridden to '${status}'.`, order: updatedOrder });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
