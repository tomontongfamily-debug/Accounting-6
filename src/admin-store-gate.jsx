export default function AdminStoreGate({ finished, error, loadedReportCount, retry, logout, children }) {
  if (finished && !error) return children;
  return (
    <section className="section" aria-busy={!finished}>
      <div className="section-heading">
        <h2>{error ? "Unable to Load Admin Reports" : "Loading Admin Reports"}</h2>
      </div>
      {error
        ? <><p role="alert" className="error">{error}</p><p>Saved reports could not be loaded. Please retry to view their totals.</p><button type="button" className="secondary" onClick={retry}>Try Again</button></>
        : <p role="status">Loading saved reports from all stations… {loadedReportCount > 0 ? `${loadedReportCount.toLocaleString()} reports loaded.` : "Connecting to the accounting database…"}</p>}
      <button type="button" className="secondary" onClick={logout}>Log Out</button>
    </section>
  );
}
