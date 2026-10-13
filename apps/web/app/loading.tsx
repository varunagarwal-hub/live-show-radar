/**
 * Shown the moment a tab is tapped, while the server renders the page (pages are personal and
 * dynamic). Next.js prefetches this shell, so switching feels instant instead of frozen.
 */
export default function Loading() {
  return (
    <div className="soundcheck" role="status" aria-live="polite">
      <p className="soundcheck-label">
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Soundcheck…
      </p>
      <div className="sk sk-title" />
      <div className="sk-row">
        <div className="sk sk-card" />
        <div className="sk sk-card" />
        <div className="sk sk-card" />
      </div>
      <div className="sk sk-line" />
      <div className="sk sk-line short" />
    </div>
  );
}
