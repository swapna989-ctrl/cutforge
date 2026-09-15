"use client";

import Link from "next/link";
import type { PipelineStatus } from "@/lib/pipeline";
import { useBilling } from "@/lib/billing";

export type ExportSnapshot = { watermarkFree: boolean; label: string };

/**
 * A factual receipt of what actually happened to the footage, not a log of how — the worker
 * runs both steps unconditionally today, so stating them as done is accurate, not decorative.
 */
function ActionsReceipt({ watermarkFree }: { watermarkFree: boolean }) {
  const items = [
    "Dead air removed",
    "Captions added",
    watermarkFree ? "No watermark" : "Includes watermark",
  ];
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item}
          className="flex items-center space-x-1.5 text-[11px] text-[#5C5648] font-mono px-2.5 py-1 rounded-full border border-[#E8E2D6] bg-[#F5F1EA]"
        >
          <span className="material-symbols-outlined text-[13px] text-[#5B8C6E]">check</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ExportPanel({
  status,
  downloadState,
  exportSnapshot,
  onReEdit,
  onDownload,
}: {
  status: PipelineStatus;
  downloadState: "idle" | "preparing" | "done";
  exportSnapshot: ExportSnapshot | null;
  onReEdit: () => void;
  onDownload: () => void;
}) {
  const isReady = status === "ready";
  const isFailed = status === "failed";
  const billing = useBilling();

  // While an export is in flight or just finished, freeze the watermark/credit display to what
  // was actually delivered — live billing state can change mid-flight and shouldn't retroactively
  // relabel a master that's already been handed to the user.
  const frozen = downloadState !== "idle" ? exportSnapshot : null;
  const effectiveWatermarkFree = frozen ? frozen.watermarkFree : billing.isWatermarkFree;
  const canExportNow = billing.ready && billing.canExport;
  const showUpgradeLink = isReady && downloadState === "idle" && !canExportNow;

  if (!isReady && !isFailed) return null;

  return (
    <div className="rounded-2xl border border-[#E8E2D6] bg-white shadow-[0_1px_2px_rgba(43,41,38,0.04)] px-4 sm:px-5 py-4 space-y-4">
      {isReady && <ActionsReceipt watermarkFree={effectiveWatermarkFree} />}

      <div className="flex items-center space-x-3">
        <button
          onClick={onReEdit}
          className="px-4 py-2.5 rounded-full text-xs font-medium border transition-all text-[#5C5648] hover:text-[#2B2926] border-[#E8E2D6] hover:border-[#D8D0C0] bg-[#F5F1EA] hover:bg-[#EFE8DA] cursor-pointer"
        >
          {isFailed ? "Try again" : "Replace clip"}
        </button>

        {showUpgradeLink ? (
          <Link
            href="/pricing"
            className="flex-1 py-2.5 px-5 rounded-full text-xs font-bold transition-colors duration-300 flex items-center justify-center space-x-2 group/btn bg-[#A8724A] hover:bg-[#8F5D3A] text-white shadow-[0_1px_2px_rgba(43,41,38,0.15)] cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">bolt</span>
            <span>Upgrade to export</span>
          </Link>
        ) : (
          isReady && (
            <button
              disabled={downloadState !== "idle" || !canExportNow}
              onClick={onDownload}
              className="flex-1 py-2.5 px-5 rounded-full text-xs font-bold transition-colors duration-300 flex items-center justify-center space-x-2 group/btn disabled:cursor-not-allowed disabled:opacity-70 bg-[#A8724A] hover:bg-[#8F5D3A] text-white shadow-[0_1px_2px_rgba(43,41,38,0.15)] cursor-pointer"
            >
              <span>{downloadState === "preparing" ? "Preparing…" : downloadState === "done" ? "Downloaded ✓" : "Download Master"}</span>
              {downloadState === "idle" && (
                <span className="material-symbols-outlined text-[15px] group-hover/btn:translate-x-1 transition-transform">arrow_forward</span>
              )}
            </button>
          )
        )}
      </div>

      {isReady && (frozen || canExportNow) && (
        <p className="text-center text-[10px] font-mono text-[#8A8375]">
          {frozen ? (
            frozen.label
          ) : effectiveWatermarkFree ? (
            billing.hasActivePlan && billing.planCredits > 0 ? (
              `No watermark · ${billing.planCredits} credit${billing.planCredits === 1 ? "" : "s"} left this month`
            ) : (
              `No watermark · ${billing.paidCredits} paid credit${billing.paidCredits === 1 ? "" : "s"} left`
            )
          ) : (
            <>
              Includes Flovura watermark ({billing.freeCredits} free export{billing.freeCredits === 1 ? "" : "s"} left) ·{" "}
              <Link href="/pricing" className="text-[#A8724A] hover:text-[#8F5D3A] underline underline-offset-2">
                Remove it
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
