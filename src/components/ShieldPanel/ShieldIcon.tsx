/** The shield's mark: with a tick while it is working, with a cross while it is off. */
export function ShieldIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.6 2.8 8.3 7 10 4.2-1.7 7-5.4 7-10V6l-7-3Z" />
      {off ? <path d="m9 9 6 6m0-6-6 6" /> : <path d="m9 12 2.2 2.2L15.5 10" />}
    </svg>
  )
}
