import { buildContractPdf } from '../server/crm/contract-pdf';
import fs from 'fs';

const terms = fs.readFileSync('/home/veto/ConstructHUB/analysis/hcp-export/hcp-terms.md', 'utf8')
  .replace(/^[\s\S]*?TERMS AND CONDITIONS:/m, 'TERMS AND CONDITIONS:')
  .split(/\n## /)[0]; // just the T&C body, like org.termsAndConditions

async function main() {
  const pdf = await buildContractPdf({
    branding: { name: 'Alpine Exteriors — Washington', email: 'a@b.co', phone: '(855) 743-4649', website: 'alpineexteriorswa.com', addressLine1: '2119 Lincoln St', city: 'Bellingham', state: 'WA', postalCode: '98225', licenseNumber: 'ALPIN**751OW', licenseState: 'WA' },
    accentHex: '#F97316', orgName: 'Alpine Tree',
    customer: { displayName: 'Daniel & Rosa Martinez', email: 'd@m.co', phone: '(360) 555-0142', addressLine1: '1420 Birchwood Dr', city: 'Bellingham', state: 'WA', postalCode: '98225' },
    estimate: { number: 'E-1460', title: 'Siding remodel — James Hardie primed + exterior paint', createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 864e5), approvedAt: new Date(), subtotalCents: 4296000, discountCents: 0, taxCents: 378048, totalCents: 4674048, approvedTotalCents: 4627008, signatureName: 'Daniel Martinez', signatureIp: '73.1.2.3', selectedDiscounts: [{ label: 'Military discount', percentBps: 200 }] },
    items: [
      { name: 'Siding Remodel - James Hardie Primed + Exterior Paint', description: 'Full tear-off, wrap, primed Hardie plank, two-coat exterior paint system.', quantityMilli: 1000, unit: 'job', unitPriceCents: 4125000, lineTotalCents: 4125000 },
      { name: 'Window Trim Package (6 windows)', quantityMilli: 6000, unit: 'ea', unitPriceCents: 28500, lineTotalCents: 171000 },
    ],
    options: [{ name: 'Builder Grade Package - Re Roof', description: 'Standard Package - Re Roof with builder grade shingles, synthetic underlayment, new drip edge, ridge vent.', recommended: true, totalCents: 4674048 }],
    terms,
  });
  fs.writeFileSync('/tmp/contract-test.pdf', pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log('PDF bytes:', pdf.length, 'pages:', pages);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
