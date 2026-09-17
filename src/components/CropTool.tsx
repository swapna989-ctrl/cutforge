"use client";

import { useEffect, useRef, useState } from "react";
import type { Ratio } from "@/lib/pipeline";

const RATIO_ASPECT: Record<Ratio, number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1 };

/** The crop box's size in rendered pixels — a fixed 90% coverage of whichever image dimension is
 *  limiting for the chosen ratio. Only the box's *position* is user-adjustable (see the component
 *  doc below for why size isn't a free parameter here). */
function boxSizePx(ratio: Ratio, renderedWidth: number, renderedHeight: number): { width: number; height: number } {
  const aspect = RATIO_ASPECT[ratio];
  let height = renderedHeight * 0.9;
  let width = height * aspect;
  if (width > renderedWidth * 0.9) {
    width = renderedWidth * 0.9;
    height = width / aspect;
  }
  return { width, height };
}

function clampCenter(x: number, y: number, ratio: Ratio, renderedWidth: number, renderedHeight: number): { x: number; y: number } {
  const box = boxSizePx(ratio, renderedWidth, renderedHeight);
  const halfW = box.width / 2 / renderedWidth;
  const halfH = box.height / 2 / renderedHeight;
  return {
    x: Math.min(Math.max(x, halfW), 1 - halfW),
    y: Math.min(Math.max(y, halfH), 1 - halfH),
  };
}

/**
 * Lets the user reposition (not resize) a crop window over an uncropped source frame — the same
 * "center as a fraction of the source frame" convention worker/src/faceCrop.ts's
 * detectFaceCenterFraction already returns, so a manual crop here is a direct, literal override of
 * that same value rather than a new concept the worker has to learn. Size isn't user-adjustable
 * because normalizeToTargetResolution always scales the source to *cover* the target box before
 * cropping — the box's absolute size on screen doesn't map onto anything the render step actually
 * takes as an input, only its center does.
 */
export default function CropTool({
  imageUrl,
  ratio,
  initialX,
  initialY,
  onChange,
}: {
  imageUrl: string;
  ratio: Ratio;
  initialX: number | null;
  initialY: number | null;
  onChange: (x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const draggingRef = useRef(false);
  const [renderedSize, setRenderedSize] = useState<{ width: number; height: number } | null>(null);
  const [center, setCenter] = useState({ x: initialX ?? 0.5, y: initialY ?? 0.5 });

  // ResizeObserver rather than the <img>'s own onLoad: a cached image can already be `complete`
  // the instant this component mounts, in which case onLoad never fires at all — and even a
  // manual `complete` check in an effect race-loses against layout often enough in practice to be
  // unreliable (reproduced directly: clientWidth/clientHeight both read 0 in an effect that ran
  // before the browser's own layout pass had actually sized the element). ResizeObserver instead
  // reports the element's real box size directly from layout, fires once immediately upon
  // observing (covering the already-loaded case) and again on every genuine resize (a real
  // correctness bonus this component didn't have before — the crop box would otherwise drift out
  // of alignment if the window/container ever resized after the initial measurement).
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentBoxSize?.[0];
      if (box) setRenderedSize({ width: box.inlineSize, height: box.blockSize });
      else setRenderedSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Re-clamps whenever the ratio (or the measured size) changes — a center that was valid for a
  // narrow 9:16 box can put a much wider 16:9 box's edge outside the image entirely (reproduced
  // directly: switching ratios left the box rendered partly off-screen with a negative `left`).
  // Calls onChange too, so the parent's stored value stays in sync with what's actually shown
  // rather than silently drifting from the visible box.
  useEffect(() => {
    if (!renderedSize) return;
    setCenter((prev) => {
      const clamped = clampCenter(prev.x, prev.y, ratio, renderedSize.width, renderedSize.height);
      if (clamped.x !== prev.x || clamped.y !== prev.y) onChange(clamped.x, clamped.y);
      return clamped;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a fresh function every render; re-running this on ratio/renderedSize changes is the actual intent
  }, [ratio, renderedSize]);

  function updateFromPointer(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;
    const clamped = clampCenter(rawX, rawY, ratio, rect.width, rect.height);
    setCenter(clamped);
    onChange(clamped.x, clamped.y);
  }

  function handlePointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  }

  function handlePointerUp() {
    draggingRef.current = false;
  }

  const box = renderedSize ? boxSizePx(ratio, renderedSize.width, renderedSize.height) : null;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative w-full select-none touch-none rounded-xl overflow-hidden bg-black"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, not a static/optimizable local asset */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Crop preview"
          draggable={false}
          className="w-full h-auto block"
          onLoad={(e) => {
            const el = e.currentTarget;
            setRenderedSize({ width: el.clientWidth, height: el.clientHeight });
          }}
        />
        {box && (
          // The 9999px-spread, zero-blur box-shadow is what dims everything OUTSIDE this box —
          // a single technique, not layered with a separate full-container overlay, since that
          // would sit behind this box in paint order and dim the box's own "clear window" interior
          // too, defeating the point of showing an undimmed preview of what stays in frame.
          <div
            className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] cursor-grab active:cursor-grabbing"
            style={{
              width: box.width,
              height: box.height,
              left: center.x * renderedSize!.width - box.width / 2,
              top: center.y * renderedSize!.height - box.height / 2,
            }}
          />
        )}
      </div>
      <p className="text-[11px] text-[#B3ACA6]">Drag the frame to reposition the crop.</p>
    </div>
  );
}
