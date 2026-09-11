export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6 relative">
      <div className="fixed inset-0 pointer-events-none bg-radial-gradient z-0" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[700px] h-[340px] bg-amber-400/[0.04] blur-[120px] rounded-full pointer-events-none z-0" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="tracking-[0.32em] font-black text-xl font-display text-white select-none whitespace-nowrap">C U T F O R G E</span>
          <span className="block text-[11px] font-mono tracking-widest text-amber-200/70 mt-2 uppercase">Studio Access</span>
        </div>

        <div className="bg-[#121216]/90 border border-white/[0.08] rounded-[28px] p-7 sm:p-8 shadow-cf-card relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 left-12 right-12 h-[1px] bg-gradient-to-r from-transparent via-amber-200/25 to-transparent" />
          {children}
        </div>
      </div>
    </div>
  );
}
