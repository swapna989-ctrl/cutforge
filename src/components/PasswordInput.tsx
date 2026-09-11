"use client";

import { useState } from "react";

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#0b0b0e] border border-white/10 rounded-xl pl-4 pr-11 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-amber-300/40 outline-none transition-colors"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined text-[18px]">{visible ? "visibility_off" : "visibility"}</span>
      </button>
    </div>
  );
}
