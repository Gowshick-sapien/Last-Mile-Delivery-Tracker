const prisma = require('../config/prisma');
const { sendNotification } = require('./notification.service');

const ACTIVE_DELIVERY_STATUSES = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'];

/**
 * Intelligent auto-assignment logic:
 * 1. Finds available agents located in the order's pickup zone.
 * 2. Balances load by selecting the agent with the minimum active deliveries.
 * 3. Falls back to available agents in other zones if no zone agents exist.
 */
async function autoAssignAgent(orderId, actorId = null, actorRole = 'SYSTEM') {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      pickupZone: true,
      dropZone: true,
      customer: true
    }
  });

  if (!order) {
    const err = new Error('Order not found.');
    err.statusCode = 404;
    throw err;
  }

  if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
    const err = new Error(`Cannot assign agent to an order in '${order.status}' status.`);
    err.statusCode = 400;
    throw err;
  }

  // 1. Query candidate agents in the same pickup zone
  let candidateProfiles = [];
  if (order.pickupZoneId) {
    candidateProfiles = await prisma.agentProfile.findMany({
      where: {
        isAvailable: true,
        currentZoneId: order.pickupZoneId,
        user: { role: 'AGENT' }
      },
      include: {
        user: true,
        currentZone: true
      }
    });
  }

  let assignmentScope = 'SAME_ZONE';

  // 2. Fallback: Query all available agents across all zones if none found in pickup zone
  if (candidateProfiles.length === 0) {
    candidateProfiles = await prisma.agentProfile.findMany({
      where: {
        isAvailable: true,
        user: { role: 'AGENT' }
      },
      include: {
        user: true,
        currentZone: true
      }
    });
    assignmentScope = 'CROSS_ZONE_FALLBACK';
  }

  if (candidateProfiles.length === 0) {
    const err = new Error('No delivery agents are currently available for assignment. Manual admin assignment required.');
    err.statusCode = 409;
    throw err;
  }

  // 3. Compute active workloads for all candidate agents
  const agentsWithWorkload = await Promise.all(
    candidateProfiles.map(async (profile) => {
      const activeCount = await prisma.order.count({
        where: {
          agentId: profile.userId,
          status: { in: ACTIVE_DELIVERY_STATUSES }
        }
      });
      return {
        profile,
        user: profile.user,
        activeOrders: activeCount
      };
    })
  );

  // 4. Sort by fewest active orders (load balancing)
  agentsWithWorkload.sort((a, b) => a.activeOrders - b.activeOrders);
  const bestMatch = agentsWithWorkload[0];

  // 5. Update order with assignment
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      agentId: bestMatch.user.id,
      status: 'ASSIGNED'
    },
    include: {
      customer: true,
      agent: true,
      pickupZone: true,
      dropZone: true
    }
  });

  // 6. Append immutable tracking event
  const note = assignmentScope === 'SAME_ZONE'
    ? `Auto-assigned to agent ${bestMatch.user.name} (Zone: ${bestMatch.profile.currentZone?.name || 'Local'}, Active Workload: ${bestMatch.activeOrders} orders)`
    : `Auto-assigned via fallback to agent ${bestMatch.user.name} (Cross-zone load balance, Active Workload: ${bestMatch.activeOrders} orders)`;

  await prisma.trackingEvent.create({
    data: {
      orderId,
      status: 'ASSIGNED',
      actorId,
      actorRole,
      note
    }
  });

  // 7. Dispatch notification to customer
  await sendNotification({
    order: updatedOrder,
    eventType: 'ASSIGNED',
    extra: { agentName: bestMatch.user.name }
  });

  return {
    order: updatedOrder,
    assignedAgent: {
      id: bestMatch.user.id,
      name: bestMatch.user.name,
      email: bestMatch.user.email,
      phone: bestMatch.user.phone,
      zoneName: bestMatch.profile.currentZone?.name || 'Unassigned',
      activeOrders: bestMatch.activeOrders,
      assignmentScope
    }
  };
}

/**
 * Manual assignment by admin
 */
async function manualAssignAgent(orderId, agentUserId, actorId = null, actorRole = 'ADMIN') {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true }
  });

  if (!order) {
    const err = new Error('Order not found.');
    err.statusCode = 404;
    throw err;
  }

  if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
    const err = new Error(`Cannot assign agent to an order in '${order.status}' status.`);
    err.statusCode = 400;
    throw err;
  }

  const agentUser = await prisma.user.findUnique({
    where: { id: agentUserId },
    include: { agentProfile: { include: { currentZone: true } } }
  });

  if (!agentUser || agentUser.role !== 'AGENT') {
    const err = new Error('Selected user is not a valid delivery agent.');
    err.statusCode = 400;
    throw err;
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      agentId: agentUser.id,
      status: 'ASSIGNED'
    },
    include: {
      customer: true,
      agent: true,
      pickupZone: true,
      dropZone: true
    }
  });

  await prisma.trackingEvent.create({
    data: {
      orderId,
      status: 'ASSIGNED',
      actorId,
      actorRole,
      note: `Manually assigned to agent ${agentUser.name} by administrator.`
    }
  });

  await sendNotification({
    order: updatedOrder,
    eventType: 'ASSIGNED',
    extra: { agentName: agentUser.name }
  });

  return {
    order: updatedOrder,
    assignedAgent: {
      id: agentUser.id,
      name: agentUser.name,
      email: agentUser.email,
      phone: agentUser.phone,
      zoneName: agentUser.agentProfile?.currentZone?.name || 'Unassigned'
    }
  };
}

module.exports = {
  autoAssignAgent,
  manualAssignAgent
};
