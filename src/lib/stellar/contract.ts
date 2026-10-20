/**
 * lib/stellar/contract.ts
 *
 * Builds Soroban transactions for each ChainSettle contract function,
 * gets them signed by Freighter, and submits them to the network.
 *
 * Flow for every write operation:
 *   1. Build the transaction (TransactionBuilder + Contract.call)
 *   2. Simulate it (get the resource footprint from the RPC)
 *   3. Assemble the final transaction with the simulation result
 *   4. Sign via Freighter
 *   5. Submit to Soroban RPC (retrying TRY_AGAIN_LATER with backoff)
 *   6. Poll for confirmation (backoff; throws TxPendingError on timeout)
 *
 * Failures are thrown as `ContractError { code, message, raw }`.
 */

import {
  Networks,
  rpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
  Address,
  Transaction,
} from '@stellar/stellar-sdk';
import { signTx } from './freighter';
import { ContractError, TxPendingError, parseContractError } from './errors';

export { ContractError, TxPendingError } from './errors';

const RPC_URL = env.stellarRpcUrl;
const CONTRACT_ID = env.contractId;
const NETWORK = env.stellarNetwork;

const NETWORK_PASSPHRASE =
  NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

// Singleton RPC client
let rpcClient: rpc.Server;
function getRpc(): rpc.Server {
  if (!rpcClient) {
    rpcClient = new rpc.Server(RPC_URL, { allowHttp: true });
  }
  return rpcClient;
}

// ----------------------------------------------------------------
// Core helpers
// ----------------------------------------------------------------

export interface TxOptions {
  /** How long to wait for confirmation before throwing `TxPendingError` */
  timeoutMs?: number;
}

/** Default confirmation timeout — override with NEXT_PUBLIC_TX_TIMEOUT_MS */
const DEFAULT_CONFIRM_TIMEOUT_MS =
  Number(process.env.NEXT_PUBLIC_TX_TIMEOUT_MS) || 60_000;

const MAX_SUBMIT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with a little jitter */
function backoff(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * 250);
}

/** Network failures, timeouts, 429 and 5xx responses are worth retrying */
function isTransientError(err: unknown): boolean {
  const e = err as any;
  const status = e?.response?.status ?? e?.status;
  if (typeof status === 'number') {
    return status >= 500 || status === 429 || status === 408;
  }
  if (['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ERR_NETWORK'].includes(e?.code)) {
    return true;
  }
  return /network|timeout|timed out|fetch failed|failed to fetch|socket hang up/i.test(
    String(e?.message ?? ''),
  );
}

/** Build, simulate, assemble, sign, and submit a contract call */
async function invokeContract(
  callerAddress: string,
  method: string,
  args: xdr.ScVal[],
  options: TxOptions = {},
): Promise<string> {
  const rpcClient = getRpc();
  const contract = new Contract(CONTRACT_ID);

  let signedTx: Transaction;
  try {
    // Fetch the caller's account sequence number
    const account = await rpcClient.getAccount(callerAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    // Simulate to get resource footprint
    const simulation = await rpcClient.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw parseContractError({
        message: `Simulation error: ${simulation.error}`,
        events: simulation.events,
      });
    }

    // Assemble the final transaction with the simulation resource data
    const assembled = rpc.assembleTransaction(tx, simulation).build();

    // Sign with Freighter
    const signedXdr = await signTx(assembled.toXDR(), NETWORK_PASSPHRASE);
    signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
  } catch (err) {
    throw parseContractError(err);
  }

  // Submit, then poll until confirmed
  const hash = await submitTransaction(signedTx);
  return await waitForConfirmation(hash, options.timeoutMs);
}

/**
 * Submit a signed transaction, retrying TRY_AGAIN_LATER and transient RPC
 * failures with backoff. DUPLICATE means the network already has it.
 */
async function submitTransaction(tx: Transaction): Promise<string> {
  const rpcClient = getRpc();

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt >= MAX_SUBMIT_ATTEMPTS - 1;

    let response: rpc.Api.SendTransactionResponse;
    try {
      response = await rpcClient.sendTransaction(tx);
    } catch (err) {
      if (!isLastAttempt && isTransientError(err)) {
        await sleep(backoff(attempt));
        continue;
      }
      throw parseContractError(err);
    }

    switch (response.status) {
      case 'PENDING':
      case 'DUPLICATE':
        return response.hash;

      case 'TRY_AGAIN_LATER':
        if (!isLastAttempt) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ContractError(
          'NetworkBusy',
          `Submission returned TRY_AGAIN_LATER after ${attempt + 1} attempts: ${response.hash}`,
          response.hash,
        );

      case 'ERROR':
      default:
        throw parseContractError({
          message: `Submission error: ${response.errorResult?.toXDR('base64') ?? response.status}`,
          errorResult: response.errorResult,
          events: response.diagnosticEvents,
          txHash: response.hash,
        });
    }
  }
}

/**
 * Poll the RPC with exponential backoff until the transaction is confirmed or
 * fails. Transient RPC errors are tolerated. If the timeout expires first, a
 * `TxPendingError` carrying the hash is thrown — the transaction may still land.
 */
export async function waitForConfirmation(
  txHash: string,
  timeoutMs: number = DEFAULT_CONFIRM_TIMEOUT_MS,
): Promise<string> {
  const rpcClient = getRpc();
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    await sleep(Math.min(backoff(attempt), Math.max(deadline - Date.now(), 0)));
    attempt++;

    let result: rpc.Api.GetTransactionResponse;
    try {
      result = await rpcClient.getTransaction(txHash);
    } catch (err) {
      if (isTransientError(err)) continue;
      throw parseContractError({ message: errorText(err), txHash });
    }

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('chainsettle:transaction-complete'));
      }
      return txHash;
    }

    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw parseContractError({
        message: `Transaction failed: ${txHash}`,
        errorResult: result.resultXdr,
        events: result.diagnosticEventsXdr,
        txHash,
      });
    }

    // NOT_FOUND — not in a ledger yet, keep polling
  }

  throw new TxPendingError(txHash);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read-only simulation — no signing, no submission */
async function simulateCall(method: string, args: xdr.ScVal[]): Promise<any> {
  const rpcClient = getRpc();
  const contract = new Contract(CONTRACT_ID);

  // Use a dummy account for simulation
  const dummyKeypair = (await import('@stellar/stellar-sdk')).Keypair.random();
  const dummyAccount = {
    accountId: () => dummyKeypair.publicKey(),
    sequenceNumber: () => '0',
    incrementSequenceNumber: () => {},
  } as any;

  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await rpcClient.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Read error: ${simulation.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simulation) && simulation.result) {
    return scValToNative(simulation.result.retval);
  }

  return null;
}

// ----------------------------------------------------------------
// Contract write functions
// ----------------------------------------------------------------

/**
 * create_shipment — locks USDC in escrow and initialises the shipment.
 * The buyer must have approved the USDC spend first (SAC approve tx).
 */
export async function createShipment(params: {
  callerAddress: string;
  shipmentId: string;
  supplier: string;
  logistics: string;
  arbiter: string;
  tokenAddress: string;
  totalAmount: bigint;
  milestones: Array<{ name: string; paymentPercent: number }>;
}, options?: TxOptions): Promise<string> {
  const milestonesScVal = xdr.ScVal.scvVec(
    params.milestones.map((m) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal('name', { type: 'symbol' }),
          val: nativeToScVal(m.name, { type: 'string' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('payment_percent', { type: 'symbol' }),
          val: nativeToScVal(m.paymentPercent, { type: 'u32' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('proof_hash', { type: 'symbol' }),
          val: nativeToScVal('', { type: 'string' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('status', { type: 'symbol' }),
          val: xdr.ScVal.scvVec([nativeToScVal('Pending', { type: 'symbol' })]),
        }),
      ]),
    ),
  );

  return invokeContract(params.callerAddress, 'create_shipment', [
    nativeToScVal(params.shipmentId, { type: 'string' }),
    new Address(params.callerAddress).toScVal(),
    new Address(params.supplier).toScVal(),
    new Address(params.logistics).toScVal(),
    new Address(params.arbiter).toScVal(),
    new Address(params.tokenAddress).toScVal(),
    nativeToScVal(params.totalAmount, { type: 'i128' }),
    milestonesScVal,
  ], options);
}

/** submit_proof — supplier or logistics submits an IPFS proof hash */
export async function submitProof(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
  proofHash: string;
}, options?: TxOptions): Promise<string> {
  return invokeContract(params.callerAddress, 'submit_proof', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
    nativeToScVal(params.proofHash, { type: 'string' }),
  ], options);
}

/** confirm_milestone — buyer confirms a submitted proof, releases payment */
export async function confirmMilestone(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
}, options?: TxOptions): Promise<string> {
  return invokeContract(params.callerAddress, 'confirm_milestone', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
  ], options);
}

/** raise_dispute — buyer disputes a submitted proof */
export async function raiseDispute(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
}, options?: TxOptions): Promise<string> {
  return invokeContract(params.callerAddress, 'raise_dispute', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
  ], options);
}

/** resolve_dispute — arbiter approves or rejects a disputed milestone */
export async function resolveDispute(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
  approve: boolean;
}, options?: TxOptions): Promise<string> {
  return invokeContract(params.callerAddress, 'resolve_dispute', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
    nativeToScVal(params.approve, { type: 'bool' }),
  ], options);
}

/** cancel_shipment — buyer cancels before any milestones confirmed */
export async function cancelShipment(params: {
  callerAddress: string;
  shipmentId: string;
}, options?: TxOptions): Promise<string> {
  return invokeContract(params.callerAddress, 'cancel_shipment', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
  ], options);
}

// ----------------------------------------------------------------
// Contract read functions
// ----------------------------------------------------------------

/** get_shipment — fetch full shipment state from chain */
export async function getShipmentOnChain(shipmentId: string) {
  return simulateCall('get_shipment', [
    nativeToScVal(shipmentId, { type: 'string' }),
  ]);
}

/** get_escrow_balance — amount still locked in escrow */
export async function getEscrowBalance(shipmentId: string): Promise<bigint> {
  const result = await simulateCall('get_escrow_balance', [
    nativeToScVal(shipmentId, { type: 'string' }),
  ]);
  return BigInt(result ?? 0);
}
