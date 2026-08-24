const express = require('express');
const { calculateRate } = require('../services/rateCalculator.service');
const { createOrder, getCustomerOrders, getOrderDetails } = require('../services/order.service');
const { rescheduleOrder } = require('../services/status.service');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 1. Calculate rate quote (Stateless - available with or without token)
router.post('/calculate', async (req, res, next) => {
  try {
    const {
      pickupPincode,
      dropPincode,
      lengthCm,
      breadthCm,
      heightCm,
      actualWeightKg,
      orderType,
      paymentType
    } = req.body;

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

    res.json({ success: true, rateQuote });
  } catch (error) {
    next(error);
  }
});

// All following routes require authentication
router.use(authenticateToken);

// 2. Place new order
router.post('/', async (req, res, next) => {
  try {
    const {
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

    const result = await createOrder({
      customerId: req.user.id,
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
      creatorRole: req.user.role,
      creatorId: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      order: result.order,
      rateQuote: result.rateQuote,
      assignedAgent: result.assignedAgent
    });
  } catch (error) {
    next(error);
  }
});

// 3. List authenticated customer's orders
router.get('/', async (req, res, next) => {
  try {
    const orders = await getCustomerOrders(req.user.id);
    res.json({ success: true, orders });
  } catch (error) {
    next(error);
  }
});

// 4. Order details and tracking history
router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderDetails(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Access control: Customer can only view own orders unless Admin or assigned Agent
    if (req.user.role === 'CUSTOMER' && order.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to order details.' });
    }

    if (req.user.role === 'AGENT' && order.agentId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access. You are not the assigned agent.' });
    }

    res.json({ success: true, order });
  } catch (error) {
    next(error);
  }
});

// 5. Reschedule failed delivery
router.post('/:id/reschedule', async (req, res, next) => {
  try {
    const { newScheduledDate, note } = req.body;

    if (!newScheduledDate) {
      return res.status(400).json({ success: false, message: 'newScheduledDate is required.' });
    }

    const result = await rescheduleOrder({
      orderId: req.params.id,
      newScheduledDate,
      actorId: req.user.id,
      actorRole: req.user.role,
      note
    });

    res.json({
      success: true,
      message: result.message,
      order: result.order,
      assignedAgent: result.assignedAgent
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
