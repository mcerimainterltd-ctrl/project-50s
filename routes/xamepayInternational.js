'use strict';

const express = require('express');

const ALLOWED_FUNDING = new Set(['wallet', 'bank']);
const ALLOWED_CUSTOMERS = new Set(['individual', 'business']);
const ISO2 = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function readCorridors() {
  const raw = process.env.XAMEPAY_INTL_CORRIDORS_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid = parsed.filter((c) =>
      c &&
      typeof c === 'object' &&
      !Array.isArray(c) &&
      c.enabled === true &&
      ISO2.test(c.originCountry) &&
      ISO2.test(c.destinationCountry) &&
      c.originCountry !== 'ZW' &&
      c.destinationCountry !== 'ZW' &&
      c.originCountry !== c.destinationCountry &&
      CURRENCY.test(c.sourceCurrency) &&
      CURRENCY.test(c.destinationCurrency) &&
      typeof c.provider === 'string' &&
      c.provider.trim().length > 0 &&
      Array.isArray(c.fundingMethods) &&
      c.fundingMethods.length > 0 &&
      c.fundingMethods.every((v) => ALLOWED_FUNDING.has(v)) &&
      new Set(c.fundingMethods).size === c.fundingMethods.length &&
      Array.isArray(c.customerTypes) &&
      c.customerTypes.length > 0 &&
      c.customerTypes.every((v) => ALLOWED_CUSTOMERS.has(v)) &&
      new Set(c.customerTypes).size === c.customerTypes.length &&
      Number.isFinite(c.fxRate) &&
      c.fxRate > 0 &&
      Number.isFinite(c.fixedFee) &&
      c.fixedFee >= 0 &&
      Number.isFinite(c.percentFee) &&
      c.percentFee >= 0 &&
      c.percentFee <= 100
    );

    // Reject every entry involved in an overlapping corridor definition.
    const keyCounts = new Map();

    for (const c of valid) {
      for (const fundingMethod of c.fundingMethods) {
        for (const customerType of c.customerTypes) {
          const key = JSON.stringify([
            c.originCountry,
            c.destinationCountry,
            c.sourceCurrency,
            c.destinationCurrency,
            fundingMethod,
            customerType,
          ]);
          keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
        }
      }
    }

    return valid.filter((c) =>
      c.fundingMethods.every((fundingMethod) =>
        c.customerTypes.every((customerType) => {
          const key = JSON.stringify([
            c.originCountry,
            c.destinationCountry,
            c.sourceCurrency,
            c.destinationCurrency,
            fundingMethod,
            customerType,
          ]);
          return keyCounts.get(key) === 1;
        })
      )
    );
  } catch (_) {
    // Invalid configuration fails closed.
    return [];
  }
}

module.exports = function createXamePayInternationalRouter({
  mongoose,
  getAuthenticatedUserFromSession,
}) {
  const router = express.Router();


  function validateRequest(body) {
    const originCountry = String(body.originCountry || '').toUpperCase();
    const destinationCountry =
      String(body.destinationCountry || '').toUpperCase();
    const sourceCurrency = String(body.sourceCurrency || '').toUpperCase();
    const destinationCurrency =
      String(body.destinationCurrency || '').toUpperCase();
    const fundingMethod = String(body.fundingMethod || '');
    const customerType = String(body.customerType || '');

    if (
      !ISO2.test(originCountry) ||
      !ISO2.test(destinationCountry) ||
      !CURRENCY.test(sourceCurrency) ||
      !CURRENCY.test(destinationCurrency) ||
      !ALLOWED_FUNDING.has(fundingMethod) ||
      !ALLOWED_CUSTOMERS.has(customerType)
    ) {
      return { error: 'Invalid country, currency, funding method, or customer type.' };
    }

    if (originCountry === destinationCountry) {
      return { error: 'This endpoint is for cross-border transfers.' };
    }

    return {
      originCountry,
      destinationCountry,
      sourceCurrency,
      destinationCurrency,
      fundingMethod,
      customerType,
    };
  }

  async function requireUser(req, res) {
    try {
      const user = await getAuthenticatedUserFromSession(req);
      if (!user || user.suspended) {
        res.status(401).json({
          success: false,
          message: 'An active authenticated session is required.',
        });
        return null;
      }
      return user;
    } catch (_) {
      res.status(503).json({
        success: false,
        message: 'Authentication is temporarily unavailable.',
      });
      return null;
    }
  }

  function findCorridor(input) {
    return readCorridors().find((c) =>
      c.originCountry === input.originCountry &&
      c.destinationCountry === input.destinationCountry &&
      c.sourceCurrency === input.sourceCurrency &&
      c.destinationCurrency === input.destinationCurrency &&
      c.fundingMethods.includes(input.fundingMethod) &&
      c.customerTypes.includes(input.customerType)
    ) || null;
  }

  router.post('/eligibility', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const input = validateRequest(req.body || {});
    if (input.error) {
      return res.status(400).json({
        success: false,
        message: input.error,
      });
    }

    const corridor = findCorridor(input);

    return res.json({
      success: true,
      corridorAvailable: !!corridor,
      corridorStatus: corridor ? 'CONFIGURED' : 'UNAVAILABLE',
      customerVerification: 'NOT_CONFIGURED',
      canExecute: false,
      executionEnabled: false,
      reasons: [
        ...(!corridor ? ['CORRIDOR_NOT_ENABLED'] : []),
        'CUSTOMER_VERIFICATION_NOT_CONFIGURED',
        'TRANSFER_EXECUTION_NOT_ENABLED',
      ],
    });
  });

  router.post('/quote', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const input = validateRequest(req.body || {});
    if (input.error) {
      return res.status(400).json({
        success: false,
        message: input.error,
      });
    }

    const amount = req.body.amount;
    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 1000000000
    ) {
      return res.status(400).json({
        success: false,
        message: 'amount must be a positive number within the supported limit.',
      });
    }

    const corridor = findCorridor(input);
    if (!corridor) {
      return res.status(409).json({
        success: false,
        code: 'CORRIDOR_NOT_ENABLED',
        message: 'This transfer corridor is not currently available.',
      });
    }

    const fee = Math.round(
      (corridor.fixedFee + amount * corridor.percentFee / 100) * 100
    ) / 100;
    const destinationAmount =
      Math.round(amount * corridor.fxRate * 100) / 100;

    if (
      !Number.isFinite(fee) ||
      !Number.isFinite(destinationAmount) ||
      destinationAmount <= 0
    ) {
      return res.status(503).json({
        success: false,
        message: 'A valid quote is currently unavailable.',
      });
    }

    return res.json({
      success: true,
      indicative: true,
      executable: false,
      originCountry: input.originCountry,
      destinationCountry: input.destinationCountry,
      sourceCurrency: input.sourceCurrency,
      destinationCurrency: input.destinationCurrency,
      fundingMethod: input.fundingMethod,
      customerType: input.customerType,
      amount,
      fee,
      totalSourceAmount: Math.round((amount + fee) * 100) / 100,
      exchangeRate: corridor.fxRate,
      destinationAmount,
      provider: corridor.provider,
      reasons: [
        'CUSTOMER_VERIFICATION_NOT_CONFIGURED',
        'TRANSFER_EXECUTION_NOT_ENABLED',
      ],
    });
  });

  // Read-only operational status; deliberately does not expose provider secrets.
  router.get('/status', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    return res.json({
      success: true,
      service: 'xamepay-international',
      mode: 'FOUNDATION_ONLY',
      configuredCorridorCount: readCorridors().length,
      transferExecutionEnabled: false,
    });
  });

  return router;
};
