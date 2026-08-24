const PDFDocument = require('pdfkit');

/**
 * Generates a standard 4x6 inch thermal shipping label as a PDF stream.
 */
function generateShippingLabel(order) {
  // 4x6 inches in points: 288 x 432 pt
  const doc = new PDFDocument({
    size: [288, 432],
    margin: 15
  });

  // Header & Carrier Title
  doc.fontSize(12).font('Helvetica-Bold').text('LAST-MILE LOGISTICS', { align: 'center' });
  doc.fontSize(8).font('Helvetica').text('Express Hub & Fleet Delivery', { align: 'center' });
  doc.moveDown(0.5);

  // Divider
  doc.strokeColor('#000000').lineWidth(1).moveTo(15, doc.y).lineTo(273, doc.y).stroke();
  doc.moveDown(0.5);

  // Tracking Number & Routing
  doc.fontSize(13).font('Helvetica-Bold').text(order.trackingNumber, { align: 'center' });
  doc.moveDown(0.2);

  // Mock Barcode Visual Block
  const barcodeY = doc.y;
  doc.rect(25, barcodeY, 238, 30).strokeColor('#000000').lineWidth(1).stroke();
  
  // Draw simulated barcode vertical bars
  doc.fillColor('#000000');
  for (let x = 35; x < 250; x += 4) {
    const barWidth = (x % 3 === 0) ? 2.5 : 1.2;
    doc.rect(x, barcodeY + 3, barWidth, 24).fill();
  }
  doc.y = barcodeY + 35;
  doc.moveDown(0.3);

  // Route & Service Tier
  doc.fontSize(9).font('Helvetica-Bold').text(`ROUTE: ${order.pickupZone?.name || 'ORIGIN'} -> ${order.dropZone?.name || 'DESTINATION'} (${order.zoneType})`);
  doc.fontSize(8).font('Helvetica').text(`SLA Tier: ${order.deliveryTierCode} (${order.speedMultiplier}x)`);
  doc.moveDown(0.3);

  doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(15, doc.y).lineTo(273, doc.y).stroke();
  doc.moveDown(0.4);

  // Ship To Address
  doc.fontSize(9).font('Helvetica-Bold').text('DELIVER TO:');
  doc.fontSize(8).font('Helvetica')
    .text(`${order.customer?.name || 'Customer'}`)
    .text(`${order.dropAddress}`)
    .text(`Pincode: ${order.dropPincode}`)
    .text(`Contact: ${order.customer?.phone || 'N/A'}`);
  doc.moveDown(0.4);

  doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(15, doc.y).lineTo(273, doc.y).stroke();
  doc.moveDown(0.4);

  // Return / Pickup Origin
  doc.fontSize(8).font('Helvetica-Bold').text('SHIPPER:');
  doc.fontSize(7).font('Helvetica')
    .text(`${order.pickupAddress} (${order.pickupPincode})`);
  doc.moveDown(0.4);

  doc.strokeColor('#000000').lineWidth(1).moveTo(15, doc.y).lineTo(273, doc.y).stroke();
  doc.moveDown(0.4);

  // Parcel Metrics & Payment Box
  doc.fontSize(8).font('Helvetica')
    .text(`Billed Weight: ${order.billedWeightKg} kg (Act: ${order.actualWeightKg}kg, Vol: ${order.volumetricWeightKg}kg)`)
    .text(`Dimensions: ${order.lengthCm} x ${order.breadthCm} x ${order.heightCm} cm`)
    .text(`Type: ${order.orderType}`);
  doc.moveDown(0.3);

  // Payment Status Box
  if (order.paymentType === 'COD') {
    doc.rect(15, doc.y, 258, 24).fillAndStroke('#fff3cd', '#d39e00');
    doc.fillColor('#856404').fontSize(10).font('Helvetica-Bold').text(`COLLECT CASH ON DELIVERY: INR ${order.totalCharge.toFixed(2)}`, 20, doc.y + 6, { align: 'center' });
  } else {
    doc.rect(15, doc.y, 258, 24).fillAndStroke('#d4edda', '#28a745');
    doc.fillColor('#155724').fontSize(10).font('Helvetica-Bold').text('PREPAID SHIPMENT - DO NOT COLLECT CASH', 20, doc.y + 6, { align: 'center' });
  }

  doc.end();
  return doc;
}

/**
 * Generates an A4 GST-Compliant Tax Invoice PDF stream.
 */
function generateTaxInvoice(order, invoice) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40
  });

  // Header Title
  doc.fontSize(18).font('Helvetica-Bold').text('TAX INVOICE', { align: 'right' });
  doc.fontSize(9).font('Helvetica-Bold').text('LAST-MILE LOGISTICS SOLUTIONS PVT LTD', 40, 40);
  doc.fontSize(8).font('Helvetica')
    .text('Logistics Hub 4, Commercial Complex, New Delhi - 110001')
    .text('GSTIN: 07AAAAA0000A1Z5 | Support: support@tracker.com');

  doc.moveDown(1.5);
  doc.strokeColor('#0f172a').lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(1);

  // Invoice & Customer Info Grid
  const gridY = doc.y;
  
  // Left: Invoice Details
  doc.fontSize(8).font('Helvetica-Bold').text('INVOICE DETAILS:', 40, gridY);
  doc.font('Helvetica')
    .text(`Invoice Number: ${invoice.invoiceNumber}`, 40, gridY + 12)
    .text(`Invoice Date: ${new Date(invoice.createdAt).toLocaleDateString('en-IN')}`, 40, gridY + 24)
    .text(`Tracking Number: ${order.trackingNumber}`, 40, gridY + 36)
    .text(`Order Date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`, 40, gridY + 48)
    .text(`Payment Mode: ${order.paymentType}`, 40, gridY + 60);

  // Right: Billed To Customer
  doc.fontSize(8).font('Helvetica-Bold').text('BILLED TO:', 320, gridY);
  doc.font('Helvetica')
    .text(`Customer Name: ${order.customer?.name || 'Valued Customer'}`, 320, gridY + 12)
    .text(`Email: ${order.customer?.email || 'N/A'}`, 320, gridY + 24)
    .text(`Phone: ${order.customer?.phone || 'N/A'}`, 320, gridY + 36)
    .text(`Delivery Address: ${order.dropAddress}`, 320, gridY + 48, { width: 230 })
    .text(`Destination Pincode: ${order.dropPincode}`, 320, gridY + 68);

  doc.y = gridY + 85;
  doc.moveDown(1);

  // Table Header
  const tableY = doc.y;
  doc.rect(40, tableY, 515, 20).fill('#0f172a');
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
    .text('Description', 45, tableY + 6)
    .text('Rate/Unit', 260, tableY + 6)
    .text('Quantity / Weight', 340, tableY + 6)
    .text('Amount (INR)', 465, tableY + 6, { align: 'right', width: 85 });

  doc.fillColor('#000000');
  let currentY = tableY + 20;

  function addRow(desc, rate, qty, amt, isBold = false) {
    doc.rect(40, currentY, 515, 20).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.fontSize(8).font(isBold ? 'Helvetica-Bold' : 'Helvetica')
      .text(desc, 45, currentY + 6)
      .text(rate, 260, currentY + 6)
      .text(qty, 340, currentY + 6)
      .text(amt, 465, currentY + 6, { align: 'right', width: 85 });
    currentY += 20;
  }

  // Row 1: Freight & Handling
  addRow(
    `Freight Service (${order.orderType} - ${order.zoneType} Zone)`,
    `Base: ${order.baseCharge.toFixed(2)}`,
    `${order.billedWeightKg} kg`,
    (order.baseCharge + order.weightCharge).toFixed(2)
  );

  // Row 2: SLA Speed Multiplier
  if (order.speedMultiplier > 1.0) {
    const speedExtra = (order.baseCharge + order.weightCharge) * (order.speedMultiplier - 1.0);
    addRow(`SLA Speed Surcharge (${order.deliveryTierCode} - ${order.speedMultiplier}x)`, `${order.speedMultiplier}x`, '1 Service', speedExtra.toFixed(2));
  }

  // Row 3: Volume Discount
  if (order.discountAmount > 0) {
    addRow('Enterprise Volume Discount', 'Contract', '1 Tier', `-${order.discountAmount.toFixed(2)}`);
  }

  // Row 4: Dynamic Surges
  if (order.surgeAmount > 0) {
    addRow('Dynamic Surcharges (Peak / Fuel / Remote Access)', 'Surcharge', '1 Lot', order.surgeAmount.toFixed(2));
  }

  // Row 5: COD Surcharge
  if (order.codSurcharge > 0) {
    addRow('Cash on Delivery (COD) Handling Surcharge', 'Flat', '1 Fee', order.codSurcharge.toFixed(2));
  }

  doc.y = currentY + 10;

  // Summary Totals Box
  const summaryX = 320;
  const summaryY = doc.y;

  doc.fontSize(8).font('Helvetica')
    .text('Taxable Subtotal:', summaryX, summaryY)
    .text(`INR ${invoice.taxableAmount.toFixed(2)}`, 465, summaryY, { align: 'right', width: 85 });

  if (invoice.isInterState) {
    doc.text(`IGST (18.0%):`, summaryX, summaryY + 14)
      .text(`INR ${invoice.igstAmount.toFixed(2)}`, 465, summaryY + 14, { align: 'right', width: 85 });
  } else {
    doc.text(`CGST (9.0%):`, summaryX, summaryY + 14)
      .text(`INR ${invoice.cgstAmount.toFixed(2)}`, 465, summaryY + 14, { align: 'right', width: 85 });
    doc.text(`SGST (9.0%):`, summaryX, summaryY + 28)
      .text(`INR ${invoice.sgstAmount.toFixed(2)}`, 465, summaryY + 28, { align: 'right', width: 85 });
  }

  const finalTotalY = invoice.isInterState ? summaryY + 30 : summaryY + 44;
  doc.rect(summaryX - 10, finalTotalY - 4, 245, 22).fill('#0f172a');
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
    .text('Grand Total (Incl. Taxes):', summaryX, finalTotalY + 3)
    .text(`INR ${invoice.totalAmount.toFixed(2)}`, 465, finalTotalY + 3, { align: 'right', width: 85 });

  doc.fillColor('#000000');
  doc.y = finalTotalY + 40;

  // Terms and Declaration
  doc.fontSize(7).font('Helvetica')
    .text('Declaration: This is a computer-generated tax invoice and requires no physical signature.', 40, doc.y)
    .text('All logistics operations are governed by our standard terms and conditions of carriage.', 40, doc.y + 10);

  doc.end();
  return doc;
}

module.exports = {
  generateShippingLabel,
  generateTaxInvoice
};
