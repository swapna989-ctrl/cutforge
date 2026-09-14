import Image from "next/image";

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6 bg-[#FAF8F7]">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] mb-3">
            <Image src="/brand/logo.png" alt="CutForge" width={56} height={56} className="w-full h-full object-cover" priority />
          </div>
          <span className="text-lg font-bold text-[#9a4153] tracking-tight">CutForge</span>
        </div>

        <div className="bg-white border border-[#ECE5E6] rounded-3xl p-7 sm:p-8 shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)]">
          {children}
        </div>
      </div>
    </div>
  );
}
