const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Clean existing records if any
  await prisma.notification.deleteMany({});
  await prisma.trackingEvent.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.agentProfile.deleteMany({});
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
    // North Zone
    { pincode: '110001', areaName: 'Connaught Place', zoneId: northZone.id },
    { pincode: '110002', areaName: 'Daryaganj', zoneId: northZone.id },
    { pincode: '110003', areaName: 'Aliganj', zoneId: northZone.id },
    { pincode: '110005', areaName: 'Karol Bagh', zoneId: northZone.id },
    // South Zone
    { pincode: '110016', areaName: 'Hauz Khas', zoneId: southZone.id },
    { pincode: '110017', areaName: 'Malviya Nagar', zoneId: southZone.id },
    { pincode: '110019', areaName: 'Kalkaji', zoneId: southZone.id },
    { pincode: '110024', areaName: 'Lajpat Nagar', zoneId: southZone.id },
    // Central Zone
    { pincode: '110006', areaName: 'Chandni Chowk', zoneId: centralZone.id },
    { pincode: '110008', areaName: 'Patel Nagar', zoneId: centralZone.id },
    // East Zone
    { pincode: '110091', areaName: 'Mayur Vihar', zoneId: eastZone.id },
    { pincode: '110092', areaName: 'Laxmi Nagar', zoneId: eastZone.id },
    // West Zone
    { pincode: '110027', areaName: 'Rajouri Garden', zoneId: westZone.id },
    { pincode: '110058', areaName: 'Janakpuri', zoneId: westZone.id }
  ];

  for (const area of areasData) {
    await prisma.area.create({ data: area });
  }
  console.log(`Created ${areasData.length} areas across 5 zones.`);

  // 4. Create Rate Cards
  await prisma.rateCard.createMany({
    data: [
      { orderType: 'B2C', zoneType: 'INTRA', baseCharge: 50.0, ratePerKg: 20.0 },
      { orderType: 'B2C', zoneType: 'INTER', baseCharge: 80.0, ratePerKg: 35.0 },
      { orderType: 'B2B', zoneType: 'INTRA', baseCharge: 120.0, ratePerKg: 15.0 },
      { orderType: 'B2B', zoneType: 'INTER', baseCharge: 200.0, ratePerKg: 25.0 }
    ]
  });
  console.log('Configured B2C and B2B rate cards for INTRA and INTER zone deliveries.');

  // 5. Create COD Surcharges
  await prisma.cODSurcharge.createMany({
    data: [
      { orderType: 'B2C', surchargeAmount: 30.0 },
      { orderType: 'B2B', surchargeAmount: 60.0 }
    ]
  });
  console.log('Configured COD surcharges.');

  // 6. Create Seed Users
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const agentPassword = await bcrypt.hash('Agent@123', 10);
  const customerPassword = await bcrypt.hash('Customer@123', 10);

  // Admin User
  const adminUser = await prisma.user.create({
    data: {
      name: 'System Administrator',
      email: 'admin@tracker.com',
      passwordHash: adminPassword,
      phone: '+919876543210',
      role: 'ADMIN'
    }
  });

  // Delivery Agents
  const agentNorthUser = await prisma.user.create({
    data: {
      name: 'Vikram Singh (North Agent)',
      email: 'agent.north@tracker.com',
      passwordHash: agentPassword,
      phone: '+919811100001',
      role: 'AGENT'
    }
  });
  await prisma.agentProfile.create({
    data: {
      userId: agentNorthUser.id,
      currentZoneId: northZone.id,
      isAvailable: true
    }
  });

  const agentSouthUser = await prisma.user.create({
    data: {
      name: 'Rahul Sharma (South Agent)',
      email: 'agent.south@tracker.com',
      passwordHash: agentPassword,
      phone: '+919811100002',
      role: 'AGENT'
    }
  });
  await prisma.agentProfile.create({
    data: {
      userId: agentSouthUser.id,
      currentZoneId: southZone.id,
      isAvailable: true
    }
  });

  const agentCentralUser = await prisma.user.create({
    data: {
      name: 'Amit Patel (Central Agent)',
      email: 'agent.central@tracker.com',
      passwordHash: agentPassword,
      phone: '+919811100003',
      role: 'AGENT'
    }
  });
  await prisma.agentProfile.create({
    data: {
      userId: agentCentralUser.id,
      currentZoneId: centralZone.id,
      isAvailable: true
    }
  });

  // Customers
  const customer1 = await prisma.user.create({
    data: {
      name: 'Priya Verma',
      email: 'customer@tracker.com',
      passwordHash: customerPassword,
      phone: '+919822200001',
      role: 'CUSTOMER'
    }
  });

  const customer2 = await prisma.user.create({
    data: {
      name: 'Apex Retailers (B2B)',
      email: 'enterprise@corp.com',
      passwordHash: customerPassword,
      phone: '+919822200002',
      role: 'CUSTOMER'
    }
  });

  console.log('Created admin, 3 delivery agents with zone assignments, and 2 test customers.');
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
