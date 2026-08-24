const prisma = require('../config/prisma');

/**
 * Advanced Rate Calculation Engine supporting:
 * - Zone Resolution (INTRA / INTER)
 * - Volumetric Weight (L*B*H / 5000) vs Actual Weight
 * - SLA Delivery Tiers & Multipliers (Hyperlocal 2H, Same-Day Express, Next-Day Standard)
 * - Dynamic Surge Rules (Time-of-day peak, remote area fees, fuel index)
 * - Enterprise Client Contract Overrides & Volume Discounts
 * - GST Tax Calculation (18% itemized into CGST/SGST or IGST)
 */
async function calculateRate({
  pickupPincode,
  dropPincode,
  lengthCm,
  breadthCm,
  heightCm,
  actualWeightKg,
  orderType = 'B2C',
  paymentType = 'PREPAID',
  deliveryTierCode = 'NEXT_DAY_STANDARD',
  customerId = null,
  orderTimestamp = new Date()
}) {
  // 1. Sanitize & Validate inputs
  const l = parseFloat(lengthCm);
  const b = parseFloat(breadthCm);
  const h = parseFloat(heightCm);
  const actualWeight = parseFloat(actualWeightKg);
  const cleanOrderType = (orderType || 'B2C').toUpperCase().trim();
  const cleanPaymentType = (paymentType || 'PREPAID').toUpperCase().trim();
  const cleanTierCode = (deliveryTierCode || 'NEXT_DAY_STANDARD').toUpperCase().trim();

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

  // 4. Delivery Tier / SLA Resolution
  const tier = await prisma.deliveryTier.findUnique({
    where: { code: cleanTierCode }
  });

  if (!tier || !tier.isActive) {
    const err = new Error(`Invalid or inactive delivery tier: '${cleanTierCode}'.`);
    err.statusCode = 400;
    throw err;
  }

  if (tier.allowedZoneType === 'INTRA_ONLY' && !isIntraZone) {
    const err = new Error(`Delivery tier '${tier.name}' is only available for Intra-Zone (same zone) deliveries.`);
    err.statusCode = 400;
    throw err;
  }

  const speedMultiplier = tier.multiplier;

  // 5. Volumetric Weight Calculation (L * B * H / 5000)
  const rawVolumetricWeight = (l * b * h) / 5000.0;
  const volumetricWeightKg = parseFloat(rawVolumetricWeight.toFixed(3));

  // 6. Billed Weight (Higher of Actual vs Volumetric)
  const billedWeightKg = Math.max(actualWeight, volumetricWeightKg);

  // 7. Base Pricing: Check for Client Enterprise Contract Override
  let baseCharge = 0.0;
  let ratePerKg = 0.0;
  let discountPercentage = 0.0;
  let isContractApplied = false;

  if (customerId) {
    const contract = await prisma.clientContract.findUnique({
      where: { customerId }
    });

    if (contract && contract.isActive) {
      isContractApplied = true;
      discountPercentage = contract.discountPercentage || 0.0;
      if (contract.customBaseCharge !== null && contract.customBaseCharge !== undefined) {
        baseCharge = contract.customBaseCharge;
      }
      if (contract.customRatePerKg !== null && contract.customRatePerKg !== undefined) {
        ratePerKg = contract.customRatePerKg;
      }
    }
  }

  // Fallback to Standard RateCard if not overridden by contract
  if (baseCharge === 0.0 && ratePerKg === 0.0) {
    const standardRateCard = await prisma.rateCard.findUnique({
      where: {
        orderType_zoneType: {
          orderType: cleanOrderType,
          zoneType
        }
      }
    });

    if (!standardRateCard) {
      const err = new Error(`Rate card not configured for Order Type: ${cleanOrderType} and Zone Type: ${zoneType}.`);
      err.statusCode = 404;
      throw err;
    }

    baseCharge = standardRateCard.baseCharge;
    ratePerKg = standardRateCard.ratePerKg;
  }

  const baseWeightCharge = parseFloat((billedWeightKg * ratePerKg).toFixed(2));
  const baseSubtotal = baseCharge + baseWeightCharge;

  // 8. Apply Speed Multiplier (SLA Tier)
  const speedAdjustedSubtotal = parseFloat((baseSubtotal * speedMultiplier).toFixed(2));

  // 9. Apply Contract Volume Discount
  const discountAmount = parseFloat(((speedAdjustedSubtotal * discountPercentage) / 100.0).toFixed(2));
  const discountedSubtotal = parseFloat((speedAdjustedSubtotal - discountAmount).toFixed(2));

  // 10. Dynamic Surge Rules Evaluation
  const currentHour = new Date(orderTimestamp).getHours();
  const activeSurgeRules = await prisma.surgeRule.findMany({
    where: { isActive: true }
  });

  let totalSurgeAmount = 0.0;
  const appliedSurges = [];

  for (const rule of activeSurgeRules) {
    let matches = false;
    let surgeCost = 0.0;

    if (rule.surgeType === 'TIME_OF_DAY') {
      if (rule.startHour !== null && rule.endHour !== null) {
        if (currentHour >= rule.startHour && currentHour <= rule.endHour) {
          matches = true;
          if (rule.multiplier > 1.0) {
            surgeCost += (discountedSubtotal * (rule.multiplier - 1.0));
          }
          surgeCost += rule.flatAmount;
        }
      }
    } else if (rule.surgeType === 'REMOTE_AREA') {
      if (rule.pincode && (rule.pincode === String(pickupPincode).trim() || rule.pincode === String(dropPincode).trim())) {
        matches = true;
        surgeCost += rule.flatAmount;
      }
    } else if (rule.surgeType === 'FUEL_INDEX') {
      matches = true;
      surgeCost += rule.flatAmount;
    } else if (rule.surgeType === 'FESTIVAL') {
      const now = new Date(orderTimestamp);
      if (rule.startDate && rule.endDate && now >= rule.startDate && now <= rule.endDate) {
        matches = true;
        if (rule.multiplier > 1.0) {
          surgeCost += (discountedSubtotal * (rule.multiplier - 1.0));
        }
        surgeCost += rule.flatAmount;
      }
    }

    if (matches && surgeCost > 0) {
      surgeCost = parseFloat(surgeCost.toFixed(2));
      totalSurgeAmount += surgeCost;
      appliedSurges.push({
        ruleId: rule.id,
        name: rule.name,
        type: rule.surgeType,
        amount: surgeCost
      });
    }
  }

  totalSurgeAmount = parseFloat(totalSurgeAmount.toFixed(2));

  // 11. COD Surcharge
  let codSurcharge = 0.0;
  if (cleanPaymentType === 'COD') {
    const codConfig = await prisma.cODSurcharge.findUnique({
      where: { orderType: cleanOrderType }
    });
    if (codConfig) {
      codSurcharge = codConfig.surchargeAmount;
    }
  }

  // 12. Net Taxable Amount
  const taxableAmount = parseFloat((discountedSubtotal + totalSurgeAmount + codSurcharge).toFixed(2));

  // 13. GST 18% Tax Calculation
  const isInterState = !isIntraZone; // Intra-zone as intra-state for tax classification
  const taxRate = 18.0;
  const taxAmount = parseFloat(((taxableAmount * taxRate) / 100.0).toFixed(2));
  const cgstAmount = isInterState ? 0.0 : parseFloat((taxAmount / 2.0).toFixed(2));
  const sgstAmount = isInterState ? 0.0 : parseFloat((taxAmount / 2.0).toFixed(2));
  const igstAmount = isInterState ? taxAmount : 0.0;

  // 14. Final Gross Total
  const totalCharge = parseFloat((taxableAmount + taxAmount).toFixed(2));

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
    deliveryTier: {
      code: tier.code,
      name: tier.name,
      slaHours: tier.slaHours,
      multiplier: speedMultiplier
    },
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
    isContractApplied,
    costBreakdown: {
      baseCharge,
      ratePerKg,
      weightCharge: baseWeightCharge,
      baseWeightCharge,
      baseSubtotal,
      speedMultiplier,
      speedAdjustedSubtotal,
      discountPercentage,
      discountAmount,
      discountedSubtotal,
      surgeAmount: totalSurgeAmount,
      appliedSurges,
      codSurcharge,
      taxableAmount,
      taxRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxAmount,
      totalCharge
    }
  };
}

module.exports = { calculateRate };
