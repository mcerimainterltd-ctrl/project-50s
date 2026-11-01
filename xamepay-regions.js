// XAMEPAY_REGIONS_V1: single source of truth for supported countries and wallet currencies.
// Key = ISO country code. Several countries can share one currency (the CFA francs).
// enabled:false means listed but not open yet; flip it once funding works for that currency.
const REGIONS = {
  // Open at launch
  NG: { name: 'Nigeria', currency: 'NGN', enabled: true },
  GH: { name: 'Ghana', currency: 'GHS', enabled: true },
  KE: { name: 'Kenya', currency: 'KES', enabled: true },
  // West African CFA franc (XOF)
  BJ: { name: 'Benin', currency: 'XOF', enabled: false },
  BF: { name: 'Burkina Faso', currency: 'XOF', enabled: false },
  CI: { name: "Côte d'Ivoire", currency: 'XOF', enabled: false },
  GW: { name: 'Guinea-Bissau', currency: 'XOF', enabled: false },
  ML: { name: 'Mali', currency: 'XOF', enabled: false },
  NE: { name: 'Niger', currency: 'XOF', enabled: false },
  SN: { name: 'Senegal', currency: 'XOF', enabled: false },
  TG: { name: 'Togo', currency: 'XOF', enabled: false },
  // Central African CFA franc (XAF)
  CM: { name: 'Cameroon', currency: 'XAF', enabled: false },
  CF: { name: 'Central African Republic', currency: 'XAF', enabled: false },
  TD: { name: 'Chad', currency: 'XAF', enabled: false },
  CG: { name: 'Republic of the Congo', currency: 'XAF', enabled: false },
  GQ: { name: 'Equatorial Guinea', currency: 'XAF', enabled: false },
  GA: { name: 'Gabon', currency: 'XAF', enabled: false },
  // Other Francophone Africa
  GN: { name: 'Guinea', currency: 'GNF', enabled: false },
  CD: { name: 'DR Congo', currency: 'CDF', enabled: false },
  BI: { name: 'Burundi', currency: 'BIF', enabled: false },
  KM: { name: 'Comoros', currency: 'KMF', enabled: false },
  DJ: { name: 'Djibouti', currency: 'DJF', enabled: false },
  MG: { name: 'Madagascar', currency: 'MGA', enabled: false },
  SC: { name: 'Seychelles', currency: 'SCR', enabled: false },
  RW: { name: 'Rwanda', currency: 'RWF', enabled: false },
  MA: { name: 'Morocco', currency: 'MAD', enabled: false },
  DZ: { name: 'Algeria', currency: 'DZD', enabled: false },
  TN: { name: 'Tunisia', currency: 'TND', enabled: false },
  MR: { name: 'Mauritania', currency: 'MRU', enabled: false },
  // Rest of Africa
  ZA: { name: 'South Africa', currency: 'ZAR', enabled: false },
  ZM: { name: 'Zambia', currency: 'ZMW', enabled: false },
  UG: { name: 'Uganda', currency: 'UGX', enabled: false },
  TZ: { name: 'Tanzania', currency: 'TZS', enabled: false },
  ET: { name: 'Ethiopia', currency: 'ETB', enabled: false },
  EG: { name: 'Egypt', currency: 'EGP', enabled: false },
  // Rest of world
  US: { name: 'United States', currency: 'USD', enabled: false },
  GB: { name: 'United Kingdom', currency: 'GBP', enabled: false },
  DE: { name: 'Europe (Germany)', currency: 'EUR', enabled: false },
  FR: { name: 'France', currency: 'EUR', enabled: false },
  IN: { name: 'India', currency: 'INR', enabled: false },
  AE: { name: 'UAE', currency: 'AED', enabled: false },
  CA: { name: 'Canada', currency: 'CAD', enabled: false },
  AU: { name: 'Australia', currency: 'AUD', enabled: false }
};

function regionFor(code) {
  const cc = String(code || '').trim().toUpperCase();
  const r = REGIONS[cc];
  return r ? { code: cc, ...r } : null;
}

function enabledRegions() {
  return Object.keys(REGIONS)
    .filter(cc => REGIONS[cc].enabled)
    .map(cc => ({ code: cc, ...REGIONS[cc] }));
}

module.exports = { REGIONS, regionFor, enabledRegions };
