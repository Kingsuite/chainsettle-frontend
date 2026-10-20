'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, FileCheck2, FileUp, Loader2 } from 'lucide-react';
import {
  MAX_PROOF_FILE_BYTES,
  formatBytes,
  hashFile,
  type FileHashResult,
  type HashPhase,
} from '@/lib/proof-hash';
import { cn } from '@/lib/utils';

interface Props {
  /** Called with the SHA-256 digest once a file has been hashed */
  onHashed: (result: FileHashResult) => void;
  /** Accessible label for the drop zone button */
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Drop zone + file picker that hashes a document with SHA-256 in the browser.
 * The file is never uploaded. Keyboard users can focus the zone and press
 * Enter/Space to open the file picker.
 */
export function ProofDocumentDropzone({ onHashed, ariaLabel, disabled = false }: Props) {
  const t = useTranslations('proofDocument');
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const statusId = useId();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ phase: HashPhase; percent: number; name: string } | null>(null);
  const [result, setResult] = useState<FileHashResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const limit = formatBytes(MAX_PROOF_FILE_BYTES);
  const hashing = progress !== null;

  const handleFile = async (file: File | undefined) => {
    if (!file || hashing) return;
    setError(null);
    setResult(null);

    if (file.size > MAX_PROOF_FILE_BYTES) {
      setError(t('tooLarge', { name: file.name, size: formatBytes(file.size), limit }));
      return;
    }
    if (file.size === 0) {
      setError(t('emptyFile', { name: file.name }));
      return;
    }

    try {
      setProgress({ phase: 'reading', percent: 0, name: file.name });
      const hashed = await hashFile(file, (phase, percent) =>
        setProgress({ phase, percent, name: file.name }),
      );
      setResult(hashed);
      onHashed(hashed);
    } catch (err) {
      console.error(err);
      setError(t('hashFailed'));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || hashing}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        aria-label={ariaLabel ?? t('dropzoneLabel')}
        aria-describedby={`${hintId} ${statusId}`}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-60',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-gray-50 hover:border-brand-200',
        )}
      >
        {hashing ? (
          <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden="true" />
        ) : (
          <FileUp className="h-5 w-5 text-gray-400" aria-hidden="true" />
        )}
        <span className="text-xs font-medium text-gray-700">{t('dropzoneTitle')}</span>
        <span id={hintId} className="text-[11px] text-gray-400">
          {t('dropzoneHint', { limit })}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      <div id={statusId} aria-live="polite">
        {progress && (
          <div className="space-y-1">
            <p className="text-xs text-gray-500">
              {progress.phase === 'computing'
                ? t('computing')
                : t('reading', { name: progress.name, percent: progress.percent })}
            </p>
            <div
              className="h-1.5 w-full rounded-full bg-gray-100"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-1.5 rounded-full bg-brand-600 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-1 text-xs text-red-600" role="alert">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {result && !progress && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 rounded-lg bg-gray-50 p-2 text-xs">
            <dt className="flex items-center gap-1 text-gray-400">
              <FileCheck2 className="h-3 w-3 text-green-600" aria-hidden="true" />
              {t('fileLabel')}
            </dt>
            <dd className="truncate text-gray-700">{result.fileName}</dd>
            <dt className="text-gray-400">{t('sizeLabel')}</dt>
            <dd className="text-gray-700">{formatBytes(result.size)}</dd>
            <dt className="text-gray-400">{t('hashLabel')}</dt>
            <dd className="break-all font-mono text-gray-700">{result.hash}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
