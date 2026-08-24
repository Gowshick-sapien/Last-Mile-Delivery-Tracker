const express = require('express');
const prisma = require('../config/prisma');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { updateOrderStatus } = require('../services/status.service');

const router = express.Router();

// Guard with AGENT role
router.use(authenticateToken, requireRole('AGENT', 'ADMIN'));

// 1. Get assigned orders for agent
router.get('/orders', async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { agentId: req.user.id };

    if (status && status.trim() !== '') {
      where.status = status.trim().toUpperCase();
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        pickupZone: true,
        dropZone: true,
        trackingEvents: { orderBy: { createdAt: 'asc' } }
      }
    });

    res.json({ success: true, orders });
  } catch (error) {
    next(error);
  }
});

// 2. Toggle agent availability
router.patch('/availability', async (req, res, next) => {
  try {
    const { isAvailable } = req.body;

    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isAvailable must be a boolean.' });
    }

    const updatedProfile = await prisma.agentProfile.update({
      where: { userId: req.user.id },
      data: { isAvailable },
      include: { currentZone: true }
    });

    res.json({
      success: true,
      message: `Availability updated to ${isAvailable ? 'Available' : 'Busy'}.`,
      profile: updatedProfile
    });
  } catch (error) {
    next(error);
  }
});

// 3. Update agent current zone
router.patch('/zone', async (req, res, next) => {
  try {
    const { zoneId } = req.body;

    if (!zoneId) {
      return res.status(400).json({ success: false, message: 'zoneId is required.' });
    }

    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) {
      return res.status(404).json({ success: false, message: 'Zone not found.' });
    }

    const updatedProfile = await prisma.agentProfile.update({
      where: { userId: req.user.id },
      data: { currentZoneId: zoneId },
      include: { currentZone: true }
    });

    res.json({
      success: true,
      message: `Assigned zone updated to ${zone.name}.`,
      profile: updatedProfile
    });
  } catch (error) {
    next(error);
  }
});

// 4. Update order delivery status
router.patch('/orders/:id/status', async (req, res, next) => {
  try {
    const { status, note, failureReason } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required.' });
    }

    const updatedOrder = await updateOrderStatus({
      orderId: req.params.id,
      newStatus: status,
      actorId: req.user.id,
      actorRole: 'AGENT',
      note,
      failureReason
    });

    res.json({
      success: true,
      message: `Order status updated to '${status}'.`,
      order: updatedOrder
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
