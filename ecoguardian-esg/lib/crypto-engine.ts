import crypto from 'crypto';

// Static EPA eGRID & IEA Global Emission Factors (Metric Tons CO2e per unit)
export const EMISSION_FACTORS = {
  ELECTRICITY_KWH_TO_MT_CO2E: 0.000415, // IEA 415g CO2/kWh grid intensity
  DIESEL_LITER_TO_MT_CO2E: 0.00268,     // EPA Stationary/Fleet Diesel factor
  NAT_GAS_THERM_TO_MT_CO2E: 0.0053,     // EPA Natural Gas factor
};

export interface ActivityMetrics {
  electricityKwh: number;
  dieselLiters: number;
  naturalGasTherms: number;
  historicalBaselineMtCo2e: number;
}

export function calculateDeterministicEmissions(metrics: ActivityMetrics) {
  // Scope 1: Direct Fuel & Natural Gas combustion
  const scope1 =
    metrics.dieselLiters * EMISSION_FACTORS.DIESEL_LITER_TO_MT_CO2E +
    metrics.naturalGasTherms * EMISSION_FACTORS.NAT_GAS_THERM_TO_MT_CO2E;

  // Scope 2: Purchased Grid Electricity
  const scope2 =
    metrics.electricityKwh * EMISSION_FACTORS.ELECTRICITY_KWH_TO_MT_CO2E;

  const totalMtCo2e = Number((scope1 + scope2).toFixed(4));
  const scope1Rounded = Number(scope1.toFixed(4));
  const scope2Rounded = Number(scope2.toFixed(4));

  // Pre-Audit Anomaly Detection: Flag >30% variation vs historical baseline
  const baseline = metrics.historicalBaselineMtCo2e || totalMtCo2e;
  const variancePct =
    baseline > 0 ? Number((((totalMtCo2e - baseline) / baseline) * 100).toFixed(2)) : 0;
  const anomalyFlagged = Math.abs(variancePct) > 30;

  return {
    scope1: scope1Rounded,
    scope2: scope2Rounded,
    totalMtCo2e,
    variancePct,
    anomalyFlagged,
  };
}

// Module D: Native SHA-256 Cryptographic Chaining -> Hash_n = SHA256(Data_n + Hash_n-1)
export function generateChainedHash(dataPayload: object, previousHash: string): string {
  const canonicalData = JSON.stringify(dataPayload);
  return crypto
    .createHash('sha256')
    .update(canonicalData + previousHash)
    .digest('hex');
}