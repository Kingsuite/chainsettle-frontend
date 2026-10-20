/**
 * lib/stellar/errors.ts
 *
 * Turns raw Soroban / Freighter failures into typed, human-readable errors.
 *
 * Contract failures reach us in several shapes:
 *   - simulation errors:  "HostError: Error(Contract, #5)" (+ diagnostic events)
 *   - contract panics:    "HostError: Error(WasmVm, InvalidAction)" with the
 *                         panic message in the diagnostic events
 *   - submission errors:  a base64 `TransactionResult` XDR (`errorResult`)
 *   - wallet errors:      "Freighter: The user rejected this request."
 */

import { scValToNative, xdr } from '@stellar/stellar-sdk';

export type ContractErrorCode =
  // Mirrors `ChainSettleError` in the contract
  | 'ShipmentAlreadyExists'
  | 'ShipmentNotFound'
  | 'NotAuthorized'
  | 'InvalidMilestoneIndex'
  | 'InvalidMilestoneStatus'
  | 'ShipmentNotActive'
  | 'InvalidPercentages'
  | 'InvalidAmount'
  | 'DisputeAlreadyOpen'
  // Token / network / wallet level failures
  | 'InsufficientBalance'
  | 'InsufficientFee'
  | 'BadSequence'
  | 'TransactionExpired'
  | 'NetworkBusy'
  | 'UserRejected'
  | 'Unknown';

/** `#N` code from `Error(Contract, #N)` → error code (contract's `ChainSettleError` enum) */
export const CONTRACT_ERROR_CODES: Record<number, ContractErrorCode> = {
  1: 'ShipmentAlreadyExists',
  2: 'ShipmentNotFound',
  3: 'NotAuthorized',
  4: 'InvalidMilestoneIndex',
  5: 'InvalidMilestoneStatus',
  6: 'ShipmentNotActive',
  7: 'InvalidPercentages',
  8: 'InvalidAmount',
  9: 'DisputeAlreadyOpen',
};

/**
 * English fallback messages. The UI renders the `contractErrors.codes.*`
 * entries from the i18n messages; keep both in sync.
 */
export const CONTRACT_ERROR_MESSAGES: Record<ContractErrorCode, string> = {
  ShipmentAlreadyExists: 'A shipment with this ID already exists. Reload the form to generate a new ID and try again.',
  ShipmentNotFound: 'This shipment does not exist on-chain. Sync the shipment or check the ID.',
  NotAuthorized: 'Your connected wallet is not allowed to perform this action on this shipment. Switch to the right account in Freighter.',
  InvalidMilestoneIndex: 'This milestone does not exist on the shipment. Refresh the page and try again.',
  InvalidMilestoneStatus: 'This milestone is not in the right state for this action. Refresh the page to see its latest status.',
  ShipmentNotActive: 'This shipment is no longer active, so it cannot be changed.',
  InvalidPercentages: 'Milestone payment percentages must add up to exactly 100%.',
  InvalidAmount: 'The amount must be greater than zero.',
  DisputeAlreadyOpen: 'A dispute is already open for this milestone. Wait for the arbiter to resolve it.',
  InsufficientBalance: 'Your wallet does not have enough balance to cover this transaction. Top up and try again.',
  InsufficientFee: 'The network fee was too low for this transaction. Please try again.',
  BadSequence: 'Your account sequence number is out of date, usually because another transaction was sent at the same time. Please try again.',
  TransactionExpired: 'The transaction expired before it reached the network. Please try again.',
  NetworkBusy: 'The Stellar network is busy right now. Please wait a moment and try again.',
  UserRejected: 'You rejected the transaction in Freighter',
  Unknown: 'The transaction could not be completed. Please try again, or share the technical details below with support.',
};

/** A contract / wallet / submission failure, mapped to a known code */
export class ContractError extends Error {
  readonly code: ContractErrorCode;
  readonly raw: string;
  readonly txHash?: string;

  constructor(code: ContractErrorCode, raw: string, txHash?: string) {
    super(CONTRACT_ERROR_MESSAGES[code]);
    this.name = 'ContractError';
    this.code = code;
    this.raw = raw;
    this.txHash = txHash;
  }
}

/** The transaction was submitted but not confirmed before the timeout — it may still land */
export class TxPendingError extends Error {
  readonly hash: string;

  constructor(hash: string) {
    super(`Transaction is still pending: ${hash}`);
    this.name = 'TxPendingError';
    this.hash = hash;
  }
}

// Panic messages from the current contract build (it panics instead of
// returning `ChainSettleError`), and token contract balance errors.
const MESSAGE_PATTERNS: Array<[RegExp, ContractErrorCode]> = [
  [/shipment already exists/i, 'ShipmentAlreadyExists'],
  [/shipment not found/i, 'ShipmentNotFound'],
  [/unauthori[sz]ed|not authori[sz]ed/i, 'NotAuthorized'],
  [/invalid milestone index/i, 'InvalidMilestoneIndex'],
  [/not in pending status|not in disputed status|proof not yet submitted|can only dispute a submitted proof|cannot cancel: milestones already confirmed/i, 'InvalidMilestoneStatus'],
  [/shipment is not active/i, 'ShipmentNotActive'],
  [/percentages must sum to 100/i, 'InvalidPercentages'],
  [/amount must be greater than zero/i, 'InvalidAmount'],
  [/dispute already open/i, 'DisputeAlreadyOpen'],
  [/balance is not sufficient|insufficient balance|resulting balance is not within the allowed range/i, 'InsufficientBalance'],
];

const USER_REJECTED_PATTERN = /user (declined|rejected|denied)|declined by user|rejected this request|request (was )?(declined|rejected|denied)/i;

/** Transaction / operation result names (from `errorResult` XDR) → error code */
const RESULT_CODES: Record<string, ContractErrorCode> = {
  txInsufficientBalance: 'InsufficientBalance',
  txInsufficientFee: 'InsufficientFee',
  txBadSeq: 'BadSequence',
  txTooLate: 'TransactionExpired',
  invokeHostFunctionInsufficientRefundableFee: 'InsufficientFee',
};

/** Decode a `TransactionResult` (object or base64 XDR) into its result names */
function decodeTransactionResult(errorResult: unknown): string[] {
  try {
    const result =
      typeof errorResult === 'string'
        ? xdr.TransactionResult.fromXDR(errorResult, 'base64')
        : (errorResult as xdr.TransactionResult);
    const inner = result.result();
    const names = [inner.switch().name];

    if (inner.switch().name === 'txFailed') {
      for (const op of inner.results()) {
        try {
          names.push(op.tr().invokeHostFunctionResult().switch().name);
        } catch {
          names.push(op.switch().name);
        }
      }
    }

    return names;
  } catch {
    return [];
  }
}

/** Extract readable payloads (e.g. panic messages) from diagnostic events */
function describeDiagnosticEvents(events: unknown): string[] {
  if (!Array.isArray(events)) return [];

  const lines: string[] = [];
  for (const event of events) {
    try {
      const diagnostic =
        typeof event === 'string' ? xdr.DiagnosticEvent.fromXDR(event, 'base64') : (event as xdr.DiagnosticEvent);
      const data = scValToNative(diagnostic.event().body().v0().data());
      lines.push(typeof data === 'string' ? data : JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    } catch {
      // Not decodable — ignore
    }
  }
  return lines;
}

function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
    return (err as any).message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Map any error thrown while building, simulating, signing or submitting a
 * contract call to a `ContractError`.
 *
 * Accepts plain errors / strings as well as objects carrying the raw RPC data:
 * `{ message, errorResult, events, txHash }`.
 */
export function parseContractError(err: unknown): ContractError {
  if (err instanceof ContractError) return err;

  const details = (err && typeof err === 'object' ? err : {}) as {
    errorResult?: unknown;
    events?: unknown;
    txHash?: string;
  };

  const message = errorMessage(err);
  const resultNames = details.errorResult ? decodeTransactionResult(details.errorResult) : [];
  const eventLines = describeDiagnosticEvents(details.events);

  const raw = [
    message,
    resultNames.length ? `Result: ${resultNames.join(' → ')}` : '',
    ...eventLines.map((line) => `Event: ${line}`),
  ]
    .filter(Boolean)
    .join('\n');

  // Wallet rejection
  if (USER_REJECTED_PATTERN.test(message)) {
    return new ContractError('UserRejected', raw, details.txHash);
  }

  // `Error(Contract, #N)` from the simulation / host error
  const codeMatch = raw.match(/Error\(Contract, #(\d+)\)/);
  if (codeMatch) {
    const code = CONTRACT_ERROR_CODES[Number(codeMatch[1])];
    // The token contract also reports `Error(Contract, #N)`, so prefer a
    // message match (e.g. "balance is not sufficient") when there is one.
    const byMessage = MESSAGE_PATTERNS.find(([pattern]) => pattern.test(raw));
    if (byMessage) return new ContractError(byMessage[1], raw, details.txHash);
    if (code) return new ContractError(code, raw, details.txHash);
  }

  // Panic messages in diagnostic events / error text
  const byMessage = MESSAGE_PATTERNS.find(([pattern]) => pattern.test(raw));
  if (byMessage) return new ContractError(byMessage[1], raw, details.txHash);

  // Decoded submission result
  for (const name of resultNames) {
    if (RESULT_CODES[name]) return new ContractError(RESULT_CODES[name], raw, details.txHash);
  }

  return new ContractError('Unknown', raw, details.txHash);
}
