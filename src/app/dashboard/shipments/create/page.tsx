"use client";

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Loader2, AlertCircle, AlertTriangle, BookmarkPlus, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { createShipment } from '@/lib/stellar/contract';
import { shipmentsApi } from '@/lib/api/services';
import { useAuthStore } from '@/lib/hooks/use-auth-store';
import { useAccountExistence } from '@/lib/hooks/use-account-existence';
import { normalizeAddress, validateParties, PARTY_ROLE_LABELS, type PartyRole } from '@/lib/stellar/address';
import { generateShipmentId, usdcToStroops } from '@/lib/utils';
import { useShipmentTemplates, useTemplatesStore } from '@/lib/hooks/use-templates-store';
import { cloneMilestones, isSavableSplit, type ShipmentTemplate } from '@/lib/templates';
import { TemplatePicker } from '@/components/templates/TemplatePicker';
import { SaveTemplateDialog } from '@/components/templates/SaveTemplateDialog';
import { env } from '@/lib/env';
import type { CreateMilestoneInput } from '@/types';

const USDC_ADDRESS = env.usdcAddress;
const HIGH_VALUE_THRESHOLD_USDC = 10_000;
const DEFAULT_MILESTONES: CreateMilestoneInput[] = [
  { name: 'Goods Dispatched', paymentPercent: 25 },
  { name: 'In Transit', paymentPercent: 50 },
  { name: 'Delivered', paymentPercent: 25 },
];

type ShipmentDraft = {
  shipmentId: string;
  supplierAddress: string;
  logisticsAddress: string;
  arbiterAddress: string;
  totalUsdc: string;
  milestones: CreateMilestoneInput[];
};

const generateInputId = (suffix: string) => `create-${suffix}`;

type EditableParty = Exclude<PartyRole, 'buyer'>;

const NETWORK_LABEL =
  env.stellarNetwork === 'mainnet' ? 'Mainnet' : 'Testnet';

type AddressFieldProps = {
  role: EditableParty;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  touched: boolean;
  hint?: string;
};

function AddressField({ role, label, value, onChange, onBlur, error, touched, hint }: AddressFieldProps) {
  const inputId = generateInputId(role);
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const warningId = `${inputId}-warning`;
  // Only hit Horizon once the user has left the field with a valid address
  const existence = useAccountExistence(touched && !error ? value : '');

  const describedBy = [
    hint && hintId,
    error && errorId,
    !error && existence === 'missing' && warningId,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={inputId} className="label">{label}</label>
      <input
        id={inputId}
        placeholder="G..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        required
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`input font-mono text-xs ${error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
      />
      {hint && (
        <p id={hintId} className="text-xs text-gray-400 mt-1">{hint}</p>
      )}
      {error ? (
        <p id={errorId} className="text-xs text-red-600 mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : existence === 'checking' ? (
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1" aria-live="polite">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          Checking account on {NETWORK_LABEL}…
        </p>
      ) : existence === 'missing' ? (
        <p id={warningId} className="text-xs text-amber-700 mt-1 flex items-center gap-1" aria-live="polite">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
          This account is not funded on {NETWORK_LABEL}. You can continue, but it must be activated before it can transact.
        </p>
      ) : null}
    </div>
  );
}

export default function CreateShipmentPage() {
  const router = useRouter();
  const { address } = useAuthStore();
  const errorId = useId();
  const txStepId = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const [shipmentId, setShipmentId] = useState(generateShipmentId);
  const [supplierAddress, setSupplierAddress] = useState('');
  const [logisticsAddress, setLogisticsAddress] = useState('');
  const [arbiterAddress, setArbiterAddress] = useState('');
  const [totalUsdc, setTotalUsdc] = useState('');
  const [milestones, setMilestones] = useState<CreateMilestoneInput[]>(DEFAULT_MILESTONES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStep, setTxStep] = useState('');
  const [touched, setTouched] = useState<Record<EditableParty, boolean>>({
    supplier: false,
    logistics: false,
    arbiter: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const draftLoaded = useRef(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const { templates } = useShipmentTemplates(address);
  const saveTemplate = useTemplatesStore((state) => state.saveTemplate);

  useEffect(() => {
    if (!address) return;

    draftLoaded.current = false;
    const key = `chainsetttle_shipment_draft_${address}`;
    const savedDraft = localStorage.getItem(key);
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft) as Partial<ShipmentDraft>;
        if (draft.shipmentId) setShipmentId(draft.shipmentId);
        if (typeof draft.supplierAddress === 'string') setSupplierAddress(normalizeAddress(draft.supplierAddress));
        if (typeof draft.logisticsAddress === 'string') setLogisticsAddress(normalizeAddress(draft.logisticsAddress));
        if (typeof draft.arbiterAddress === 'string') setArbiterAddress(normalizeAddress(draft.arbiterAddress));
        if (typeof draft.totalUsdc === 'string') setTotalUsdc(draft.totalUsdc);
        if (Array.isArray(draft.milestones) && draft.milestones.length) {
          setMilestones(draft.milestones);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
    draftLoaded.current = true;
  }, [address]);

  useEffect(() => {
    if (!address || !draftLoaded.current || loading) return;

    const timeout = window.setTimeout(() => {
      const draft: ShipmentDraft = {
        shipmentId,
        supplierAddress,
        logisticsAddress,
        arbiterAddress,
        totalUsdc,
        milestones,
      };
      localStorage.setItem(`chainsetttle_shipment_draft_${address}`, JSON.stringify(draft));
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [address, shipmentId, supplierAddress, logisticsAddress, arbiterAddress, totalUsdc, milestones, loading]);

  const totalPercent = milestones.reduce((s, m) => s + m.paymentPercent, 0);
  const percentValid = totalPercent === 100;
  const canSaveTemplate = !!address && isSavableSplit(milestones);
  const hasParties = [supplierAddress, logisticsAddress, arbiterAddress].some((a) => a.trim() !== '');

  // Anything beyond the untouched default form counts as user input worth protecting.
  const milestonesEdited =
    milestones.length !== DEFAULT_MILESTONES.length ||
    milestones.some(
      (m, i) => m.name !== DEFAULT_MILESTONES[i].name || m.paymentPercent !== DEFAULT_MILESTONES[i].paymentPercent,
    );
  const formHasInput = milestonesEdited || hasParties;

  const applyTemplate = (template: ShipmentTemplate) => {
    setMilestones(cloneMilestones(template.milestones));
    if (template.parties?.supplierAddress) setSupplierAddress(template.parties.supplierAddress);
    if (template.parties?.logisticsAddress) setLogisticsAddress(template.parties.logisticsAddress);
    if (template.parties?.arbiterAddress) setArbiterAddress(template.parties.arbiterAddress);
    setTemplateNotice(`Applied template "${template.name}".`);
  };

  const handleSaveTemplate = (name: string, includeParties: boolean) => {
    if (!address) return;
    const template = saveTemplate(address, {
      name,
      milestones,
      parties: includeParties ? { supplierAddress, logisticsAddress, arbiterAddress } : undefined,
    });
    setTemplateNotice(`Saved template "${template.name}".`);
  };

  const partyErrors = useMemo(
    () =>
      validateParties({
        buyer: address ?? '',
        supplier: supplierAddress,
        logistics: logisticsAddress,
        arbiter: arbiterAddress,
      }),
    [address, supplierAddress, logisticsAddress, arbiterAddress],
  );

  const visiblePartyError = (role: EditableParty) =>
    touched[role] || submitAttempted ? partyErrors[role] : undefined;

  const summaryErrors = submitAttempted
    ? (Object.entries(partyErrors) as [PartyRole, string][])
    : [];
  const showErrorBanner = Boolean(error) || summaryErrors.length > 0;

  const markTouched = (role: EditableParty) =>
    setTouched((prev) => (prev[role] ? prev : { ...prev, [role]: true }));

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const addMilestone = () => {
    setMilestones([...milestones, { name: "", paymentPercent: 0 }]);
  };

  const removeMilestone = (i: number) => {
    setMilestones(milestones.filter((_, idx) => idx !== i));
  };

  const updateMilestone = (
    i: number,
    field: keyof CreateMilestoneInput,
    value: any,
  ) => {
    setMilestones(
      milestones.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)),
    );
  };

  const submitShipment = async () => {
    setLoading(true);
    try {
      setTxStep('Building transaction…');
      const txHash = await createShipment({
        callerAddress: address!,
        shipmentId,
        supplier: supplierAddress,
        logistics: logisticsAddress,
        arbiter: arbiterAddress,
        tokenAddress: USDC_ADDRESS,
        totalAmount: usdcToStroops(totalUsdc),
        milestones,
      });

      setTxStep('Saving to backend…');
      await shipmentsApi.create({
        shipmentId,
        buyerAddress: address!,
        supplierAddress,
        logisticsAddress,
        arbiterAddress,
        tokenAddress: USDC_ADDRESS,
        totalAmount: usdcToStroops(totalUsdc).toString(),
        milestones,
        txHash,
      });

      localStorage.removeItem(`chainsetttle_shipment_draft_${address}`);
      router.push(`/dashboard/shipments/${shipmentId}`);
    } catch (err: any) {
      setError(err?.message ?? "Transaction failed. Please try again.");
    } finally {
      setLoading(false);
      setTxStep("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    setError(null);
    setSubmitAttempted(true);
    setTouched({ supplier: true, logistics: true, arbiter: true });

    if (Object.keys(partyErrors).length > 0) {
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }

    if (Number(totalUsdc) >= HIGH_VALUE_THRESHOLD_USDC) {
      setConfirmationOpen(true);
      return;
    }

    await submitShipment();
  };

  return (
    <div className="max-w-2xl">
      <Link
        href="/dashboard/shipments"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </Link>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">New shipment</h1>
      <p className="text-sm text-gray-500 mb-6">
        Lock USDC in a Soroban escrow contract. Payment releases automatically
        as milestones are confirmed.
      </p>
      <p className="text-xs text-gray-400 mb-5">Your unfinished form is saved locally in this browser.</p>

      {showErrorBanner && (
        <div id={errorId} ref={errorRef} tabIndex={-1} className="mb-5 p-4 rounded-xl bg-red-50 border border-red-100 flex gap-3" role="alert" aria-live="assertive">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            {error && <p className="text-sm text-red-700">{error}</p>}
            {summaryErrors.length > 0 && (
              <>
                <p className="text-sm font-medium text-red-700">
                  Please fix the following before signing:
                </p>
                <ul className="list-disc pl-4 text-sm text-red-700 space-y-0.5">
                  {summaryErrors.map(([role, message]) => (
                    <li key={role}>
                      <a href={`#${generateInputId(role)}`} className="underline hover:text-red-900">
                        {PARTY_ROLE_LABELS[role]}
                      </a>
                      : {message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <TemplatePicker templates={templates} needsConfirmation={formHasInput} onApply={applyTemplate} />

        {/* Shipment ID */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">
            Shipment details
          </h2>
          <div className="space-y-4">
            <div>
              <label htmlFor={generateInputId('shipmentId')} className="label">Shipment ID</label>
              <input id={generateInputId('shipmentId')} value={shipmentId} readOnly className="input bg-gray-50 text-gray-500 font-mono text-xs" />
              <p id={`${generateInputId('shipmentId')}-hint`} className="text-xs text-gray-400 mt-1">Auto-generated — unique identifier on-chain</p>
            </div>
            <div>
              <label htmlFor={generateInputId('totalUsdc')} className="label">Total amount (USDC)</label>
              <input
                id={generateInputId('totalUsdc')}
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 5000"
                value={totalUsdc}
                onChange={(e) => setTotalUsdc(e.target.value)}
                aria-describedby={`${generateInputId('totalUsdc')}-hint`}
                required
                className="input"
              />
            </div>
          </div>
        </div>

        {/* Parties */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Parties</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor={generateInputId('buyer')} className="label">Your address (buyer)</label>
              <input id={generateInputId('buyer')} value={address ?? ''} readOnly className="input bg-gray-50 text-gray-500 font-mono text-xs" />
            </div>
            <AddressField
              role="supplier"
              label="Supplier Stellar address"
              value={supplierAddress}
              onChange={(v) => setSupplierAddress(normalizeAddress(v))}
              onBlur={() => markTouched('supplier')}
              error={visiblePartyError('supplier')}
              touched={touched.supplier}
            />
            <AddressField
              role="logistics"
              label="Logistics Stellar address"
              value={logisticsAddress}
              onChange={(v) => setLogisticsAddress(normalizeAddress(v))}
              onBlur={() => markTouched('logistics')}
              error={visiblePartyError('logistics')}
              touched={touched.logistics}
            />
            <AddressField
              role="arbiter"
              label="Arbiter Stellar address"
              value={arbiterAddress}
              onChange={(v) => setArbiterAddress(normalizeAddress(v))}
              onBlur={() => markTouched('arbiter')}
              error={visiblePartyError('arbiter')}
              touched={touched.arbiter}
              hint="Resolves disputes. Can be a trusted third party or a DAO address."
            />
          </div>
        </div>

        {/* Milestones */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Milestones</h2>
              <p className={`text-xs mt-1 ${percentValid ? 'text-green-700' : 'text-red-600'}`} aria-live="polite">
                {percentValid
                  ? "Milestone percentages add up to 100%."
                  : "Milestone percentages must sum to 100%."}
              </p>
            </div>
            <span
              className={`text-xs font-medium px-2 py-1 rounded-lg ${
                percentValid
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
              aria-live="off"
            >
              {totalPercent}% / 100%
            </span>
          </div>

          <div className="space-y-3 mb-4">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center flex-shrink-0" aria-hidden="true">
                  {i + 1}
                </div>
                <input
                  id={`${generateInputId('milestone-name')}-${i}`}
                  placeholder="Milestone name"
                  value={m.name}
                  onChange={(e) => updateMilestone(i, "name", e.target.value)}
                  required
                  className="input flex-1"
                  aria-label={`Milestone ${i + 1} name`}
                />
                <div className="relative w-24">
                  <input
                    id={`${generateInputId('milestone-percent')}-${i}`}
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={m.paymentPercent}
                    onChange={(e) =>
                      updateMilestone(
                        i,
                        "paymentPercent",
                        Number(e.target.value),
                      )
                    }
                    required
                    className="input pr-7"
                    aria-label={`Milestone ${i + 1} payment percentage`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" aria-hidden="true">%</span>
                </div>
                {milestones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMilestone(i)}
                    aria-label={`Remove milestone ${i + 1}`}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addMilestone}
              className="btn-ghost text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add milestone
            </button>
            <button
              type="button"
              onClick={() => setSaveTemplateOpen(true)}
              disabled={!canSaveTemplate}
              title={canSaveTemplate ? undefined : 'Name every milestone and make the split total 100% to save it as a template.'}
              className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              Save as template
            </button>
          </div>
          {templateNotice && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-green-700" role="status">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {templateNotice}
            </p>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !percentValid}
            aria-describedby={txStep ? txStepId : undefined}
            className="btn-primary flex-1"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span id={txStepId}>{txStep || 'Processing…'}</span>
              </>
            ) : (
              "Sign & lock funds in escrow"
            )}
          </button>
          <Link href="/dashboard/shipments" className="btn-secondary">
            Cancel
          </Link>
        </div>

        <p className="text-xs text-gray-400 text-center">
          This will open Freighter to sign the transaction. USDC will be locked
          in the contract until milestones are confirmed.
        </p>
      </form>

      <SaveTemplateDialog
        open={saveTemplateOpen}
        hasParties={hasParties}
        onClose={() => setSaveTemplateOpen(false)}
        onSave={handleSaveTemplate}
      />

      {confirmationOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4"
          role="presentation"
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="high-value-title"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2
              id="high-value-title"
              className="mb-2 text-lg font-semibold text-gray-900"
            >
              Confirm high-value escrow
            </h2>
            <p className="mb-4 text-sm leading-6 text-gray-500">
              You are about to lock{" "}
              <strong className="text-gray-900">{totalUsdc} USDC</strong> in
              escrow on{" "}
              <strong className="text-gray-900">
                {env.stellarNetwork === "mainnet"
                  ? "Mainnet"
                  : "Testnet"}
              </strong>
              . Review the recipient details and amount carefully before signing
              in Freighter.
            </p>
            <div className="mb-5 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
              This transaction meets or exceeds the high-value threshold of{" "}
              {HIGH_VALUE_THRESHOLD_USDC.toLocaleString()} USDC.
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmationOpen(false)}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmationOpen(false);
                  void submitShipment();
                }}
                className="btn-primary text-sm"
              >
                Continue to Freighter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
