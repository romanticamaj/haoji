export function Wordmark({ sub }: { sub?: string }) {
  return (
    <div className="wordmark" role="heading" aria-level={2} aria-label={`好記 HAOJI${sub ? `，${sub}` : ''}`}>
      <div className="wordmark-line" aria-hidden>
        <span className="wordmark-zh">好記</span>
        <span className="wordmark-en">HAOJI</span>
      </div>
      {sub && (
        <span className="wordmark-sub" aria-hidden>
          {sub}
        </span>
      )}
    </div>
  );
}
