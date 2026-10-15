import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { parseAndVerifyWithGemini } from '@/lib/gemini';
import { calculateDeterministicEmissions, generateChainedHash } from '@/lib/crypto-engine';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fileName = 'utility_invoice.pdf',
      fileBase64 = null,
      mimeType = null,
      rawInvoiceText = '',
      draftClaimText = '',
      historicalBaselineMtCo2e = 42.0,
    } = body;

    // 1. Module A & C: Multimodal Extraction + Mismatch Check
    const parsed = await parseAndVerifyWithGemini(
      fileBase64,
      mimeType,
      rawInvoiceText,
      draftClaimText,
      fileName
    );

    // 2. Module B: Zero-Hallucination Deterministic Calculation Engine
    const calc = calculateDeterministicEmissions({
      electricityKwh: parsed.electricityKwh,
      dieselLiters: parsed.dieselLiters,
      naturalGasTherms: parsed.naturalGasTherms,
      historicalBaselineMtCo2e,
    });

    // Compute Dynamic Audit Readiness Score (0 - 100)
    let auditScore = 100;
    if (parsed.mismatchFlagged) auditScore -= 45;
    if (calc.anomalyFlagged) auditScore -= 25;

    let previousHash =
      '0000000000000000000000000000000000000000000000000000000000000000';
    let recordId = crypto.randomUUID();

    // Fetch previous hash from Supabase if available
    try {
      const { data: lastBlock } = await supabase
        .from('audit_ledger')
        .select('current_hash')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastBlock?.current_hash) {
        previousHash = lastBlock.current_hash;
      }
    } catch (dbFetchErr) {
      console.warn('Using genesis hash fallback:', dbFetchErr);
    }

    const payloadSnapshot = {
      facilityName: parsed.facilityName,
      billingPeriod: parsed.billingPeriod,
      scope1MtCo2e: calc.scope1,
      scope2MtCo2e: calc.scope2,
      totalMtCo2e: calc.totalMtCo2e,
      mismatchFlagged: parsed.mismatchFlagged,
      anomalyFlagged: calc.anomalyFlagged,
    };

    const currentHash = generateChainedHash(payloadSnapshot, previousHash);

    // Save to Supabase tables (with graceful fallback if RLS is still active)
    try {
      const { data: docData } = await supabase
        .from('documents')
        .insert({
          file_name: fileName,
          facility_name: parsed.facilityName,
          billing_period: parsed.billingPeriod,
          draft_claim_text: draftClaimText,
          extracted_json: parsed,
        })
        .select()
        .single();

      if (docData?.id) {
        const { data: logData } = await supabase
          .from('emissions_logs')
          .insert({
            document_id: docData.id,
            electricity_kwh: parsed.electricityKwh,
            diesel_liters: parsed.dieselLiters,
            natural_gas_therms: parsed.naturalGasTherms,
            scope_1_mt_co2e: calc.scope1,
            scope_2_mt_co2e: calc.scope2,
            total_mt_co2e: calc.totalMtCo2e,
            variance_pct: calc.variancePct,
            anomaly_flagged: calc.anomalyFlagged,
            mismatch_flagged: parsed.mismatchFlagged,
            ai_audit_explanation: parsed.auditExplanation,
            audit_readiness_score: auditScore,
          })
          .select()
          .single();

        if (logData?.id) {
          const { data: ledgerData } = await supabase
            .from('audit_ledger')
            .insert({
              emission_log_id: logData.id,
              payload_snapshot: payloadSnapshot,
              previous_hash: previousHash,
              current_hash: currentHash,
            })
            .select()
            .single();

          if (ledgerData?.record_id) {
            recordId = ledgerData.record_id;
          }
        }
      }
    } catch (dbInsertErr) {
      console.warn('Supabase insert skipped, returning live cryptographic proof:', dbInsertErr);
    }

    return NextResponse.json({
      success: true,
      parsed,
      calc,
      auditScore,
      ledger: {
        record_id: recordId,
        previous_hash: previousHash,
        current_hash: currentHash,
        payload_snapshot: payloadSnapshot,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to process ingestion request' },
      { status: 500 }
    );
  }
}