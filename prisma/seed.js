const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with advanced pricing, SLAs, surge rules, and contracts...');

  // 1. Clean existing records
  await prisma.notification.deleteMany({});
  await prisma.trackingEvent.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.agentProfile.deleteMany({});
  await prisma.clientContract.deleteMany({});
  await prisma.surgeRule.deleteMany({});
  await prisma.deliveryTier.deleteMany({});
  await prisma.area.deleteMany({});
  await prisma.zone.deleteMany({});
  await prisma.rateCard.deleteMany({});
  await prisma.cODSurcharge.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Cleared existing records.');

  // 2. Create Zones
  const northZone = await prisma.zone.create({
    data: { name: 'North Zone', description: 'Northern sector covering Connaught Place, Daryaganj, and Karol Bagh' }
  });
  const southZone = await prisma.zone.create({
    data: { name: 'South Zone', description: 'Southern sector covering Hauz Khas, Malviya Nagar, and Kalkaji' }
  });
  const centralZone = await prisma.zone.create({
    data: { name: 'Central Zone', description: 'Central commercial hub including Chandni Chowk and Patel Nagar' }
  });
  const eastZone = await prisma.zone.create({
    data: { name: 'East Zone', description: 'Eastern region covering Mayur Vihar and Laxmi Nagar' }
  });
  const westZone = await prisma.zone.create({
    data: { name: 'West Zone', description: 'Western suburban hub including Rajouri Garden and Janakpuri' }
  });

  // 3. Create Areas with Pincodes
  const areasData = [
    { pincode: '110001', areaName: 'Connaught Place', zoneId: northZone.id },
    { pincode: '110002', areaName: 'Daryaganj', zoneId: northZone.id },
    { pincode: '110003', areaName: 'Aliganj', zoneId: northZone.id },
    { pincode: '110005', areaName: 'Karol Bagh', zoneId: northZone.id },
    { pincode: '110016', areaName: 'Hauz Khas', zoneId: southZone.id },
    { pincode: '110017', areaName: 'Malviya Nagar', zoneId: southZone.id },
    { pincode: '110019', areaName: 'Kalkaji', zoneId: southZone.id },
    { pincode: '110024', areaName: 'Lajpat Nagar', zoneId: southZone.id },
    { pincode: '110006', areaName: 'Chandni Chowk', zoneId: centralZone.id },
    { pincode: '110008', areaName: 'Patel Nagar', zoneId: centralZone.id },
    { pincode: '110091', areaName: 'Mayur Vihar', zoneId: eastZone.id },
    { pincode: '110092', areaName: 'Laxmi Nagar', zoneId: eastZone.id },
    { pincode: '110027', areaName: 'Rajouri Garden', zoneId: westZone.id },
    { pincode: '110058', areaName: 'Janakpuri Outer', zoneId: westZone.id }
  ];

  for (const area of areasData) {
    await prisma.area.create({ data: area });
  }
  console.log(`Created ${areasData.length} areas across 5 zones.`);

  // 4. Create Standard Rate Cards
  await prisma.rateCard.createMany({
    data: [
      { orderType: 'B2C', zoneType: 'INTRA', baseCharge: 50.0, ratePerKg: 20.0 },
      { orderType: 'B2C', zoneType: 'INTER', baseCharge: 80.0, ratePerKg: 35.0 },
      { orderType: 'B2B', zoneType: 'INTRA', baseCharge: 120.0, ratePerKg: 15.0 },
      { orderType: 'B2B', zoneType: 'INTER', baseCharge: 200.0, ratePerKg: 25.0 }
    ]
  });

  // 5. Create COD Surcharges
  await prisma.cODSurcharge.createMany({
    data: [
      { orderType: 'B2C', surchargeAmount: 30.0 },
      { orderType: 'B2B', surchargeAmount: 60.0 }
    ]
  });

  // 6. Create Delivery Tiers (SLAs)
  await prisma.deliveryTier.createMany({
    data: [
      {
        code: 'HYPERLOCAL_2H',
        name: 'Hyperlocal 2-Hour Delivery',
        multiplier: 2.0,
        slaHours: 2,
        allowedZoneType: 'INTRA_ONLY',
        isActive: true
      },
      {
        code: 'SAME_DAY_EXPRESS',
        name: 'Same-Day Express Delivery',
        multiplier: 1.5,
        slaHours: 8,
        cutoffHour: 18,
        allowedZoneType: 'ALL',
        isActive: true
      },
      {
        code: 'NEXT_DAY_STANDARD',
        name: 'Next-Day Standard Delivery',
        multiplier: 1.0,
        slaHours: 24,
        allowedZoneType: 'ALL',
        isActive: true
      }
    ]
  });
  console.log('Created multi-tier delivery SLAs (Hyperlocal 2H, Express Same-Day, Standard Next-Day).');

  // 7. Create Dynamic Surge Rules
  await prisma.surgeRule.createMany({
    data: [
      {
        name: 'Evening Peak Hour Surge',
        surgeType: 'TIME_OF_DAY',
        multiplier: 1.15,
        flatAmount: 0.0,
        startHour: 18,
        endHour: 21,
        isActive: true
      },
      {
        name: 'Remote Pincode Access Surcharge',
        surgeType: 'REMOTE_AREA',
        multiplier: 1.0,
        flatAmount: 40.0,
        pincode: '110058',
        isActive: true
      },
      {
        name: 'Fuel Index Adjustment',
        surgeType: 'FUEL_INDEX',
        multiplier: 1.0,
        flatAmount: 15.0,
        isActive: true
      }
    ]
  });
  console.log('Configured dynamic surge rules (Peak Hour, Remote Area, Fuel Index).');

  // 8. Create Seed Users
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const agentPassword = await bcrypt.hash('Agent@123', 10);
  const customerPassword = await bcrypt.hash('Customer@123', 10);

  // Admin User
  await prisma.user.create({
    data: {
      name: 'System Administrator',
      email: 'admin@tracker.com',
      passwordHash: adminPassword,
      phone: '+919876543210',
      role: 'ADMIN'
    }
  });

  // Delivery Agents
  const agentNorth = await prisma.user.create({
    data: {
      name: 'Vikram Singh (North Agent)',
      email: 'agent.north@tracker.com',
      passwordHash: agentPassword,
      phone: '+919811100001',
      role: 'AGENT'
    }
  });
  await prisma.agentProfile.create({
    data: { userId: agentNorth.id, currentZoneId: northZone.id, isAvailable: true }
  });

  const agentSouth = await prisma.user.create({
    data: {
      name: 'Rahul Sharma (South Agent)',
      email: 'agent.south@tracker.com',
      passwordHash: agentPassword,
      phone: '+919811100002',
      role: 'AGENT'
    }
  });
  await prisma.agentProfile.create({
    data: { userId: agentSouth.id, currentZoneId: southZone.id, isAvailable: true }
  });

  const agentCentral = await prisma.user.create({
    data: {
      name: 'Amit Patel (Central Agent)',
      email: 'agent.central@tracker.com',
      passwordHash: agentPassword,
      phone: '+919811100003',
      role: 'AGENT'
    }
  });
  await prisma.agentProfile.create({
    data: { userId: agentCentral.id, currentZoneId: centralZone.id, isAvailable: true }
  });

  // Regular Customer
  await prisma.user.create({
    data: {
      name: 'Priya Verma',
      email: 'customer@tracker.com',
      passwordHash: customerPassword,
      phone: '+919822200001',
      role: 'CUSTOMER'
    }
  });

  // Corporate Enterprise Customer with Negotiated Contract
  const enterpriseCustomer = await prisma.user.create({
    data: {
      name: 'Apex Retailers (Enterprise VIP)',
      email: 'enterprise@corp.com',
      passwordHash: customerPassword,
      phone: '+919822200002',
      role: 'CUSTOMER'
    }
  });

  // Assign Enterprise Contract (Custom rates + 10% volume discount)
  await prisma.clientContract.create({
    data: {
      customerId: enterpriseCustomer.id,
      customBaseCharge: 100.0,
      customRatePerKg: 12.0,
      discountPercentage: 10.0,
      minMonthlyVolume: 100,
      isActive: true
    }
  });
  console.log('Configured Enterprise Contract for enterprise@corp.com (Base: 100, Rate/kg: 12, Discount: 10%).');

  console.log('Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
