import { useState } from "react";

/** Discord avatar with an initials fallback once the image fails (header menu, admin rows). */
export function Avatar({ src, initials, size }: { src: string; initials: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="avatar" style={{ width: size, height: size, fontSize: size > 24 ? 13 : 11 }}>{initials}</span>;
  return <img className="avatar" src={src} width={size} height={size} style={{ width: size, height: size }} alt="" onError={() => setBroken(true)} />;
}
