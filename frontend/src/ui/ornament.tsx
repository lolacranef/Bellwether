// Engraved "guilloche" pattern, like the fine lines on a certificate or banknote. Drawn once from sine waves.
import { useMemo } from "react";

export function Guilloche({ className = "", lines = 26, w = 900, h = 360 }: { className?: string; lines?: number; w?: number; h?: number }) {
  const paths = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < lines; i++) {
      const phase = (i / lines) * Math.PI * 2;
      const amp = h * 0.18 + (i % 2) * 6;
      const pts: string[] = [];
      for (let x = 0; x <= w; x += 6) {
        const t = (x / w) * Math.PI * 4;
        const y = h / 2 + amp * Math.sin(t + phase) * Math.cos(t * 0.5 - phase * 0.5) + (i - lines / 2) * 2.2;
        pts.push(`${x},${y.toFixed(1)}`);
      }
      out.push(`M${pts.join("L")}`);
    }
    return out;
  }, [lines, w, h]);
  return (
    <svg className={`guilloche ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Section divider: a thin rule with a small diamond, as in a printed report. */
export function Rule() {
  return <div className="orn-rule" aria-hidden="true"><span /></div>;
}
