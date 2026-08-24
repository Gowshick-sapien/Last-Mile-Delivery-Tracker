const { calculateRate } = require('../src/services/rateCalculator.service');

describe('Rate Calculation Engine Tests', () => {
  test('Intra-Zone B2C Prepaid when Actual Weight > Volumetric Weight', async () => {
    // 110001 (North Zone) to 110005 (North Zone) -> INTRA
    // Dimensions: 20x15x10 cm -> Volumetric = 3000 / 5000 = 0.6 kg
    // Actual Weight: 2.5 kg -> Billed Weight = 2.5 kg
    // RateCard B2C INTRA: Base = 50, Rate/kg = 20
    // Base Subtotal = Base(50) + (2.5 * 20 = 50) = 100.00
    // Fuel Index surge = +15.00 -> Taxable = 115.00
    // GST 18% = 20.70 -> Total = 135.70
    const quote = await calculateRate({
      pickupPincode: '110001',
      dropPincode: '110005',
      lengthCm: 20,
      breadthCm: 15,
      heightCm: 10,
      actualWeightKg: 2.5,
      orderType: 'B2C',
      paymentType: 'PREPAID'
    });

    expect(quote.zoneType).toBe('INTRA');
    expect(quote.weightDetails.billedWeightKg).toBe(2.5);
    expect(quote.weightDetails.appliedWeightType).toBe('ACTUAL');
    expect(quote.costBreakdown.baseCharge).toBe(50.0);
    expect(quote.costBreakdown.weightCharge).toBe(50.0);
    expect(quote.costBreakdown.baseSubtotal).toBe(100.0);
    expect(quote.costBreakdown.codSurcharge).toBe(0.0);
    expect(quote.costBreakdown.taxableAmount).toBe(115.0);
    expect(quote.costBreakdown.totalCharge).toBe(135.70);
  });

  test('Inter-Zone B2B COD when Volumetric Weight > Actual Weight', async () => {
    // 110001 (North Zone) to 110016 (South Zone) -> INTER
    // Dimensions: 50x40x30 cm -> Volumetric = 60000 / 5000 = 12.0 kg
    // Actual Weight: 5.0 kg -> Billed Weight = 12.0 kg
    // RateCard B2B INTER: Base = 200, Rate/kg = 25
    // COD Surcharge B2B: 60
    // Base Subtotal = Base(200) + (12.0 * 25 = 300) = 500.00
    // Fuel Index surge = +15.00 -> Taxable = 500 + 60 + 15 = 575.00
    // GST 18% = 103.50 -> Total = 678.50
    const quote = await calculateRate({
      pickupPincode: '110001',
      dropPincode: '110016',
      lengthCm: 50,
      breadthCm: 40,
      heightCm: 30,
      actualWeightKg: 5.0,
      orderType: 'B2B',
      paymentType: 'COD'
    });

    expect(quote.zoneType).toBe('INTER');
    expect(quote.weightDetails.volumetricWeightKg).toBe(12.0);
    expect(quote.weightDetails.billedWeightKg).toBe(12.0);
    expect(quote.weightDetails.appliedWeightType).toBe('VOLUMETRIC');
    expect(quote.costBreakdown.baseCharge).toBe(200.0);
    expect(quote.costBreakdown.weightCharge).toBe(300.0);
    expect(quote.costBreakdown.codSurcharge).toBe(60.0);
    expect(quote.costBreakdown.taxableAmount).toBe(575.0);
    expect(quote.costBreakdown.totalCharge).toBe(678.50);
  });

  test('Rejects unmapped pickup pincode', async () => {
    await expect(
      calculateRate({
        pickupPincode: '999999',
        dropPincode: '110001',
        lengthCm: 10,
        breadthCm: 10,
        heightCm: 10,
        actualWeightKg: 1,
        orderType: 'B2C',
        paymentType: 'PREPAID'
      })
    ).rejects.toThrow(/not mapped to any serviceable zone/i);
  });

  test('Rejects invalid negative dimensions', async () => {
    await expect(
      calculateRate({
        pickupPincode: '110001',
        dropPincode: '110002',
        lengthCm: -10,
        breadthCm: 10,
        heightCm: 10,
        actualWeightKg: 1,
        orderType: 'B2C',
        paymentType: 'PREPAID'
      })
    ).rejects.toThrow(/positive numbers/i);
  });
});
