const { Resend } = require('resend');
const { RESEND_API_KEY, EMAIL_FROM } = require('../config/env');
const prisma = require('../config/prisma');

let resendClient = null;
if (RESEND_API_KEY && RESEND_API_KEY.trim().length > 0) {
  resendClient = new Resend(RESEND_API_KEY);
}

const NOTIFICATION_TEMPLATES = {
  CREATED: (order) => ({
    subject: `Order Confirmed: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nYour order with tracking number ${order.trackingNumber} has been received and confirmed.\n\nPickup: ${order.pickupAddress} (Pincode: ${order.pickupPincode})\nDrop: ${order.dropAddress} (Pincode: ${order.dropPincode})\nTotal Charge: INR ${order.totalCharge.toFixed(2)} (${order.paymentType})\n\nTrack your shipment live: /track.html?tracking=${order.trackingNumber}\n\nThank you for choosing our delivery service.`
  }),
  ASSIGNED: (order, agentName) => ({
    subject: `Delivery Agent Assigned: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nDelivery agent ${agentName || 'a dedicated agent'} has been assigned to your order ${order.trackingNumber}. Your package is scheduled for pickup soon.\n\nTrack live: /track.html?tracking=${order.trackingNumber}`
  }),
  PICKED_UP: (order) => ({
    subject: `Package Picked Up: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nYour package for order ${order.trackingNumber} has been picked up by our delivery agent and is moving to our hub.\n\nTrack live: /track.html?tracking=${order.trackingNumber}`
  }),
  IN_TRANSIT: (order) => ({
    subject: `Shipment In Transit: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nYour shipment ${order.trackingNumber} is currently in transit between hubs towards your destination zone.\n\nTrack live: /track.html?tracking=${order.trackingNumber}`
  }),
  OUT_FOR_DELIVERY: (order) => ({
    subject: `Out for Delivery: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nYour order ${order.trackingNumber} is out for delivery today. Please ensure someone is available at the destination address.\n\nPayment Mode: ${order.paymentType} (Amount: INR ${order.totalCharge.toFixed(2)})\n\nTrack live: /track.html?tracking=${order.trackingNumber}`
  }),
  DELIVERED: (order) => ({
    subject: `Package Delivered: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nYour shipment ${order.trackingNumber} has been successfully delivered. Thank you for using our last-mile delivery service.\n\nView details: /track.html?tracking=${order.trackingNumber}`
  }),
  FAILED: (order, reason) => ({
    subject: `Delivery Attempt Failed: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nWe attempted delivery for order ${order.trackingNumber}, but were unable to complete it.\nReason: ${reason || 'Customer unavailable / Address unreachable'}\n\nPlease reschedule your delivery date conveniently via our tracking page:\n/track.html?tracking=${order.trackingNumber}`
  }),
  RESCHEDULED: (order, newDate) => ({
    subject: `Delivery Rescheduled: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nYour delivery for order ${order.trackingNumber} has been rescheduled to ${newDate}.\nA delivery agent will be assigned for the new attempt.\n\nTrack live: /track.html?tracking=${order.trackingNumber}`
  }),
  CANCELLED: (order, reason) => ({
    subject: `Order Cancelled: ${order.trackingNumber}`,
    content: `Dear Customer,\n\nYour order ${order.trackingNumber} has been cancelled.\nReason: ${reason || 'Administrative cancellation'}\n\nContact support if you have any questions.`
  })
};

async function sendNotification({ order, eventType, recipientEmail, recipientRole = 'CUSTOMER', extra = {} }) {
  try {
    const templateGen = NOTIFICATION_TEMPLATES[eventType];
    if (!templateGen) {
      console.warn(`[Notification] No template for event type: ${eventType}`);
      return null;
    }

    const { subject, content } = templateGen(order, extra.reason || extra.agentName || extra.newDate);
    const targetEmail = recipientEmail || (order.customer ? order.customer.email : null);

    if (!targetEmail) {
      console.warn(`[Notification] No recipient email found for order ${order.id}`);
      return null;
    }

    let status = 'SIMULATED';

    if (resendClient) {
      try {
        await resendClient.emails.send({
          from: EMAIL_FROM,
          to: targetEmail,
          subject,
          text: content
        });
        status = 'SENT';
      } catch (err) {
        console.error('[Resend Error]', err.message);
        status = 'FAILED';
      }
    } else {
      console.log(`[Notification Simulated] To: ${targetEmail} | Subject: ${subject}`);
    }

    // Persist notification log in DB
    const record = await prisma.notification.create({
      data: {
        orderId: order.id,
        recipientEmail: targetEmail,
        recipientRole,
        subject,
        content,
        status
      }
    });

    return record;
  } catch (error) {
    console.error('[Notification Service Error]', error);
    return null;
  }
}

module.exports = {
  sendNotification,
  NOTIFICATION_TEMPLATES
};
