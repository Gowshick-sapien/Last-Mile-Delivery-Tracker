const express = require('express');
const { getOrderDetails } = require('../services/order.service');

const router = express.Router();

// Public tracking lookup endpoint
router.get('/:trackingNumber', async (req, res, next) => {
  try {
    const { trackingNumber } = req.params;
    const order = await getOrderDetails(trackingNumber);

    if (!order) {
      return res.status(404).json({ success: false, message: 'No shipment found with this tracking number.' });
    }

    // Public sanitized payload
    res.json({
      success: true,
      shipment: {
        id: order.id,
        trackingNumber: order.trackingNumber,
        status: order.status,
        scheduledDate: order.scheduledDate,
        failureReason: order.failureReason,
        orderType: order.orderType,
        paymentType: order.paymentType,
        totalCharge: order.totalCharge,
        pickupZone: order.pickupZone?.name || 'Local Zone',
        dropZone: order.dropZone?.name || 'Local Zone',
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        agent: order.agent ? { name: order.agent.name, phone: order.agent.phone } : null,
        canReschedule: order.status === 'FAILED',
        timeline: order.trackingEvents.map((evt) => ({
          status: evt.status,
          actorRole: evt.actorRole,
          note: evt.note,
          timestamp: evt.createdAt
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
