/** The bmpl mark (canvas "bmpl · Logo", variant C): the name over three dots, the invite / maybe / pass verdicts. */
export function Logo({ className }: { className: string }) {
  return (
    <a className={"logo " + className} href="/">
      <span className="logo-word">bmpl</span>
      <span className="logo-dots" aria-hidden="true"><i /><i /><i /></span>
    </a>
  );
}
