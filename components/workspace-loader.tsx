"use client";

export default function WorkspaceLoader({ progress }: { progress: number }) {
  return <main className="ptg-workspace-loader">
    <svg viewBox="0 0 512 512" width="84" height="84" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#355ee8" />
      <g fill="#fff">
        <rect className="ptg-ldr-bar b1" x="124" y="267" width="56" height="133" rx="20" />
        <rect className="ptg-ldr-bar b2" x="228" y="164" width="56" height="236" rx="20" />
        <rect className="ptg-ldr-bar b3" x="332" y="306" width="56" height="94" rx="20" />
      </g>
    </svg>
    <div className="ptg-workspace-progress" role="progressbar" aria-label="Loading workspace" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <div className="ptg-workspace-progress-fill" style={{ width: progress + "%" }} />
    </div>
    <strong data-load-percent>{progress}%</strong>
    <span role="status">{progress === 100 ? "Workspace ready" : "Loading your workspace…"}</span>
    <style jsx global>{`
.ptg-workspace-loader { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 55vh; color: #536781; font-size: 12px; }
.ptg-workspace-loader svg { animation: ptg-ldr-float 1.6s ease-in-out infinite; filter: drop-shadow(0 8px 14px rgba(53,94,232,.28)); }
.ptg-workspace-progress { width: min(300px, 80%); height: 12px; overflow: hidden; border: 1px solid #d8e1fc; border-radius: 99px; background: #e8edfb; }
.ptg-workspace-progress-fill { width: 0; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #355ee8, #7396ff); }
.ptg-workspace-loader [data-load-percent] { color: #355ee8; font-size: 20px; font-variant-numeric: tabular-nums; }
.ptg-ldr-bar { transform-box: fill-box; transform-origin: 50% 100%; animation: ptg-ldr-bar 1.1s ease-in-out infinite; }
.ptg-ldr-bar.b2 { animation-delay: .15s; }
.ptg-ldr-bar.b3 { animation-delay: .3s; }
@keyframes ptg-ldr-bar { 0%,100% { transform: scaleY(.45); } 50% { transform: scaleY(1.1); } }
@keyframes ptg-ldr-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { .ptg-workspace-loader svg, .ptg-ldr-bar { animation: none; } }
    `}</style>
  </main>;
}
