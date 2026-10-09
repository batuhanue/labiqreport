import type { WxKind } from "@/lib/weather";

/** Küçük hava ikonları (tek renk + vurgu). */
export function WxIcon({ kind, night, size = 22 }: { kind: WxKind; night?: boolean; size?: number }) {
  const sun = night ? (
    <path d="M14.5 4.5a6 6 0 1 0 5 8.6 5 5 0 0 1-5-8.6z" fill="#f4e7a1" stroke="#c9a64a" strokeWidth="1" />
  ) : (
    <g>
      <circle cx="12" cy="10" r="4" fill="#ffc54d" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1={12 + Math.cos((a * Math.PI) / 180) * 6} y1={10 + Math.sin((a * Math.PI) / 180) * 6} x2={12 + Math.cos((a * Math.PI) / 180) * 7.6} y2={10 + Math.sin((a * Math.PI) / 180) * 7.6} stroke="#ffc54d" strokeWidth="1.6" strokeLinecap="round" />
      ))}
    </g>
  );
  const cloud = (dx = 0, dy = 0, c = "#e8eef5") => <path transform={`translate(${dx} ${dy})`} d="M7 19h10a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 7.6 11 4 4 0 0 0 7 19z" fill={c} />;
  const drops = (n: number) =>
    Array.from({ length: n }, (_, i) => <line key={i} x1={8 + i * 3.2} y1="20.5" x2={7 + i * 3.2} y2="23" stroke="#7cc1ff" strokeWidth="1.6" strokeLinecap="round" />);
  let body: React.ReactNode;
  switch (kind) {
    case "clear":
      body = sun;
      break;
    case "partly":
      body = (
        <>
          <g transform="translate(-3 -3)">{sun}</g>
          {cloud(2, 2)}
        </>
      );
      break;
    case "cloudy":
      body = (
        <>
          {cloud(-3, -3, "#c9d3de")}
          {cloud(1, 0)}
        </>
      );
      break;
    case "fog":
      body = (
        <>
          {cloud(0, -3, "#d7dee6")}
          {[17, 20].map((y) => (
            <line key={y} x1="5" y1={y} x2="19" y2={y} stroke="#cfd8e2" strokeWidth="1.6" strokeLinecap="round" />
          ))}
        </>
      );
      break;
    case "drizzle":
    case "rain":
    case "heavy":
      body = (
        <>
          {cloud(0, -2)}
          {drops(kind === "drizzle" ? 2 : kind === "rain" ? 3 : 4)}
        </>
      );
      break;
    case "storm":
      body = (
        <>
          {cloud(0, -2, "#b8c2cf")}
          <path d="M12.5 17l-2 3.5h2.2l-1.4 3" stroke="#ffd34d" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case "snow":
      body = (
        <>
          {cloud(0, -2)}
          {[8, 12, 16].map((x) => (
            <circle key={x} cx={x} cy="21.5" r="1.1" fill="#ffffff" />
          ))}
        </>
      );
      break;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {body}
    </svg>
  );
}
