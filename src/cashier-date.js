export function cashierReportDateDisplay({
  accessAllowed,
  currentDate,
  initialLoadFinished,
  initialLoadError,
  activeDate,
}) {
  if (!accessAllowed) return currentDate;
  if (!initialLoadFinished) return "Loading...";
  if (initialLoadError) return "Unavailable";
  return activeDate;
}
