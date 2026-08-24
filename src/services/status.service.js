const prisma = require('../config/prisma');
const { isRoleAllowedTransition, isValidTransition } = require('../utils/statusTransitions');
const { sendNotification } = require('./notification.service');
const { autoAssignAgent } = require('./assignment.service');

/**
 * Updates an order's status enforcing strict state machine transitions
 * and logging immutable tracking events.
 */
async function updateOrderStatus({ orderId, newStatus, actorId, actorRole, note = '', failureReason = null, isOverride = false }) {
  const cleanStatus = (newStatus || '').toUpperCase().trim();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      agent: true,
      pickupZone: true,
      dropZone: true
    }
  });

  if (!order) {
    const err = new Error('Order not found.');
    err.statusCode = 404;
    throw err;
  }

  // If agent is performing update, verify agent assignment
  if (actorRole === 'AGENT') {
    if (order.agentId !== actorId) {
      const err = new Error('Unauthorized. You are not the assigned delivery agent for this order.');
      err.statusCode = 403;
      throw err;
    }
  }

  // Validate state transition
  if (!isOverride) {
    const allowed = isRoleAllowedTransition(actorRole, order.status, cleanStatus);
    if (!allowed) {
      const err = new Error(`Invalid status transition from '${order.status}' to '${cleanStatus}' for role '${actorRole}'.`);
      err.statusCode = 400;
      throw err;
    }
  } else {
    // Admin override must still be a valid recognized status
    if (!isValidTransition(order.status, cleanStatus) && !['CANCELLED', 'DELIVERED', 'FAILED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'PICKED_UP'].includes(cleanStatus)) {
      const err = new Error(`Unrecognized status '${cleanStatus}'.`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Prepare update payload
  const updateData = {
    status: cleanStatus
  };

  if (cleanStatus === 'FAILED') {
    updateData.failureReason = failureReason || note || 'Delivery attempt failed.';
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: updateData,
    include: {
      customer: true,
      agent: true,
      pickupZone: true,
      dropZone: true
    }
  });

  // Construct audit note for tracking event
  let auditNote = note;
  if (isOverride) {
    auditNote = `[Admin Override] ${note || `Status overridden to ${cleanStatus}`}`;
  } else if (cleanStatus === 'FAILED') {
    auditNote = `Delivery failed: ${updateData.failureReason}`;
  } else if (!auditNote) {
    auditNote = `Order status advanced to ${cleanStatus}`;
  }

  // Record immutable tracking event
  await prisma.trackingEvent.create({
    data: {
      orderId,
      status: cleanStatus,
      actorId,
      actorRole,
      note: auditNote
    }
  });

  // Dispatch notification
  await sendNotification({
    order: updatedOrder,
    eventType: cleanStatus,
    extra: {
      reason: updateData.failureReason,
      agentName: order.agent?.name
    }
  });

  return updatedOrder;
}

/**
 * Customer rescheduling workflow for a failed order.
 */
async function rescheduleOrder({ orderId, newScheduledDate, actorId, actorRole = 'CUSTOMER', note = '' }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      agent: true
    }
  });

  if (!order) {
    const err = new Error('Order not found.');
    err.statusCode = 404;
    throw err;
  }

  // Authorization: Customer must own the order (or Admin)
  if (actorRole === 'CUSTOMER' && order.customerId !== actorId) {
    const err = new Error('Unauthorized. You can only reschedule your own orders.');
    err.statusCode = 403;
    throw err;
  }

  if (order.status !== 'FAILED') {
    const err = new Error(`Only failed orders can be rescheduled. Current status: '${order.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  const parsedDate = new Date(newScheduledDate);
  if (isNaN(parsedDate.getTime()) || parsedDate < new Date(new Date().setHours(0, 0, 0, 0))) {
    const err = new Error('Please provide a valid future date for rescheduling.');
    err.statusCode = 400;
    throw err;
  }

  // Update order to RESCHEDULED and reset failure reason
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'RESCHEDULED',
      scheduledDate: parsedDate,
      failureReason: null
    },
    include: {
      customer: true,
      agent: true,
      pickupZone: true,
      dropZone: true
    }
  });

  const formattedDateStr = parsedDate.toISOString().split('T')[0];

  // Append tracking event
  await prisma.trackingEvent.create({
    data: {
      orderId,
      status: 'RESCHEDULED',
      actorId,
      actorRole,
      note: `Delivery rescheduled to ${formattedDateStr}. ${note}`.trim()
    }
  });

  // Notify customer of reschedule confirmation
  await sendNotification({
    order: updatedOrder,
    eventType: 'RESCHEDULED',
    extra: { newDate: formattedDateStr }
  });

  // Re-trigger auto-assignment for the rescheduled attempt
  try {
    const assignResult = await autoAssignAgent(orderId, actorId, 'SYSTEM');
    return {
      order: assignResult.order,
      assignedAgent: assignResult.assignedAgent,
      message: `Order successfully rescheduled for ${formattedDateStr} and auto-assigned to agent.`
    };
  } catch (assignError) {
    // If no agent available at this moment, order remains in RESCHEDULED status for admin assignment
    return {
      order: updatedOrder,
      assignedAgent: null,
      message: `Order successfully rescheduled for ${formattedDateStr}. Awaiting agent assignment.`
    };
  }
}

module.exports = {
  updateOrderStatus,
  rescheduleOrder
};
