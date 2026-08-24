const prisma = require('../config/prisma');

/**
 * Calculates delivery rates based on zones, volumetric weight, rate cards, and COD surcharges.
 *
 * Formula:
 * Volumetric Weight = (Length * Breadth * Height) / 5000
 * Billed Weight = Max(Actual Weight, Volumetric Weight)
 * Total Charge = Base Charge + (Billed Weight * Rate Per Kg) + COD Surcharge (if COD)
 */
async function calculateRate({
  pickupPincode,
  dropPincode,
  lengthCm,
  breadthCm,
  heightCm,
  actualWeightKg,
  orderType,
  paymentType
}) {
  // 1. Sanitize & Validate inputs
  const l = parseFloat(lengthCm);
  const b = parseFloat(breadthCm);
  const h = parseFloat(heightCm);
  const actualWeight = parseFloat(actualWeightKg);
  const cleanOrderType = (orderType || '').toUpperCase().trim();
  const cleanPaymentType = (paymentType || '').toUpperCase().trim();

  if (isNaN(l) || l <= 0 || isNaN(b) || b <= 0 || isNaN(h) || h <= 0) {
    const err = new Error('Package dimensions (length, breadth, height in cm) must be positive numbers.');
    err.statusCode = 400;
    throw err;
  }

  if (isNaN(actualWeight) || actualWeight <= 0) {
    const err = new Error('Actual weight (in kg) must be a positive number.');
    err.statusCode = 400;
    throw err;
  }

  if (!['B2B', 'B2C'].includes(cleanOrderType)) {
    const err = new Error('Order type must be either B2B or B2C.');
    err.statusCode = 400;
    throw err;
  }

  if (!['PREPAID', 'COD'].includes(cleanPaymentType)) {
    const err = new Error('Payment type must be either PREPAID or COD.');
    err.statusCode = 400;
    throw err;
  }

  // 2. Zone resolution via Pincodes
  const pickupArea = await prisma.area.findUnique({
    where: { pincode: String(pickupPincode).trim() },
    include: { zone: true }
  });

  if (!pickupArea) {
    const err = new Error(`Pickup pincode '${pickupPincode}' is not mapped to any serviceable zone.`);
    err.statusCode = 404;
    throw err;
  }

  const dropArea = await prisma.area.findUnique({
    where: { pincode: String(dropPincode).trim() },
    include: { zone: true }
  });

  if (!dropArea) {
    const err = new Error(`Drop pincode '${dropPincode}' is not mapped to any serviceable zone.`);
    err.statusCode = 404;
    throw err;
  }

  // 3. Zone Type Determination
  const isIntraZone = pickupArea.zoneId === dropArea.zoneId;
  const zoneType = isIntraZone ? 'INTRA' : 'INTER';

  // 4. Volumetric Weight Calculation (L * B * H / 5000)
  const rawVolumetricWeight = (l * b * h) / 5000.0;
  const volumetricWeightKg = parseFloat(rawVolumetricWeight.toFixed(3));

  // 5. Billed Weight (Higher of Actual vs Volumetric)
  const billedWeightKg = Math.max(actualWeight, volumetricWeightKg);

  // 6. Rate Card Lookup (No hardcoding - database driven)
  const rateCard = await prisma.rateCard.findUnique({
    where: {
      orderType_zoneType: {
        orderType: cleanOrderType,
        zoneType
      }
    }
  });

  if (!rateCard) {
    const err = new Error(`Rate card not configured for Order Type: ${cleanOrderType} and Zone Type: ${zoneType}.`);
    err.statusCode = 404;
    throw err;
  }

  const baseCharge = rateCard.baseCharge;
  const ratePerKg = rateCard.ratePerKg;
  const weightCharge = parseFloat((billedWeightKg * ratePerKg).toFixed(2));

  // 7. COD Surcharge Lookup
  let codSurcharge = 0.0;
  if (cleanPaymentType === 'COD') {
    const codConfig = await prisma.cODSurcharge.findUnique({
      where: { orderType: cleanOrderType }
    });
    if (codConfig) {
      codSurcharge = codConfig.surchargeAmount;
    }
  }

  // 8. Total Calculation
  const totalCharge = parseFloat((baseCharge + weightCharge + codSurcharge).toFixed(2));

  return {
    pickupArea: {
      pincode: pickupArea.pincode,
      areaName: pickupArea.areaName,
      zoneId: pickupArea.zone.id,
      zoneName: pickupArea.zone.name
    },
    dropArea: {
      pincode: dropArea.pincode,
      areaName: dropArea.areaName,
      zoneId: dropArea.zone.id,
      zoneName: dropArea.zone.name
    },
    zoneType,
    dimensions: {
      lengthCm: l,
      breadthCm: b,
      heightCm: h
    },
    weightDetails: {
      actualWeightKg: actualWeight,
      volumetricWeightKg,
      billedWeightKg,
      appliedWeightType: volumetricWeightKg > actualWeight ? 'VOLUMETRIC' : 'ACTUAL'
    },
    orderType: cleanOrderType,
    paymentType: cleanPaymentType,
    costBreakdown: {
      baseCharge,
      ratePerKg,
      weightCharge,
      codSurcharge,
      totalCharge
    }
  };
}

module.exports = { calculateRate };
