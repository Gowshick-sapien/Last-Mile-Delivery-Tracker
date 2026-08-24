const express = require('express');
const prisma = require('../config/prisma');
const { calculateRate } = require('../services/rateCalculator.service');
const { createOrder, getCustomerOrders, getOrderDetails } = require('../services/order.service');
const { rescheduleOrder } = require('../services/status.service');
const { generateShippingLabel, generateTaxInvoice } = require('../services/pdfGenerator.service');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 1. Get available Delivery Tiers (SLAs)
router.get('/tiers', async (req, res, next) => {
  try {
    const tiers = await prisma.deliveryTier.findMany({
      where: { isActive: true },
      orderBy: { multiplier: 'asc' }
    });
    res.json({ success: true, tiers });
  } catch (error) {
    next(error);
  }
});

// 2. Calculate rate quote (Stateless)
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
      paymentType,
      deliveryTierCode,
      customerId
    } = req.body;

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

    res.json({ success: true, rateQuote });
  } catch (error) {
    next(error);
  }
});

// All following routes require authentication
router.use(authenticateToken);

// 3. Place new order
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
      deliveryTierCode,
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
      deliveryTierCode,
      autoAssign,
      creatorRole: req.user.role,
      creatorId: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      order: result.order,
      invoice: result.invoice,
      rateQuote: result.rateQuote,
      assignedAgent: result.assignedAgent
    });
  } catch (error) {
    next(error);
  }
});

// 4. List authenticated customer's orders
router.get('/', async (req, res, next) => {
  try {
    const orders = await getCustomerOrders(req.user.id);
    res.json({ success: true, orders });
  } catch (error) {
    next(error);
  }
});

// 5. Order details
router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderDetails(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (req.user.role === 'CUSTOMER' && order.customerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to order.' });
    }

    if (req.user.role === 'AGENT' && order.agentId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access. You are not the assigned agent.' });
    }

    res.json({ success: true, order });
  } catch (error) {
    next(error);
  }
});

// 6. Download 4x6 Shipping Label PDF
router.get('/:id/label', async (req, res, next) => {
  try {
    const order = await getOrderDetails(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Label-${order.trackingNumber}.pdf"`);

    const pdfDoc = generateShippingLabel(order);
    pdfDoc.pipe(res);
  } catch (error) {
    next(error);
  }
});

// 7. Download GST Tax Invoice PDF
router.get('/:id/invoice', async (req, res, next) => {
  try {
    const order = await getOrderDetails(req.params.id);
    if (!order || !order.invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found for this order.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-${order.invoice.invoiceNumber}.pdf"`);

    const pdfDoc = generateTaxInvoice(order, order.invoice);
    pdfDoc.pipe(res);
  } catch (error) {
    next(error);
  }
});

// 8. Reschedule failed delivery
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
