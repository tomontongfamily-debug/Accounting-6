import { useId, useState } from "react";
import { midShiftTimeError } from "./shift-time.js";

export function MidShiftTimeInput({ value = "", shiftId, onCommit }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");

  function finish() {
    if (draft === value) return;
    const issue = midShiftTimeError(draft, shiftId);
    if (issue) {
      setDraft(value);
      setError(issue + (value ? ` The saved time is ${value}.` : " No time was saved."));
      return;
    }
    if (onCommit(draft) === false) setDraft(value);
  }

  return <div>
    <label className="field" htmlFor={id}>
      <span>Effective Time</span>
      <input id={id} type="time" value={draft}
        aria-describedby={error ? id + "-error" : undefined}
        onChange={event => { setDraft(event.target.value); setError(""); }}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onBlur={finish} />
    </label>
    {error && <p id={id + "-error"} className="warning-box" role="alert">{error}</p>}
  </div>;
}
