"use client";

export default function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-1 cursor-pointer group"
    >
      <span className="text-sm text-zinc-300 group-hover:text-white transition-colors">{label}</span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
          checked ? "bg-amber-400/90 border-amber-300/60" : "bg-white/[0.06] border-white/10"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-[22px]" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}
