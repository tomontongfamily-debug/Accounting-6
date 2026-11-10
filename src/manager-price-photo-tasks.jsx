import {pendingPricePhotoTasks} from './mid-shift-price-change.js';

export function ManagerPricePhotoTasks({reports,report,onOpen,disabled=false}) {
  const tasks=pendingPricePhotoTasks(reports,report.branch,report.date);
  if(!tasks.length)return null;
  return <aside className="warning-box" aria-label="Unfinished price changes">
    <h3>Unfinished price changes · {report.date}</h3>
    <p>These changes need to be finished before their shift reports can be submitted. Open the saved change to continue its readings.</p>
    {tasks.map(task=><div className="form-space" key={task.reportKey+'__'+task.changeId}>
      <p><strong>{task.shiftId.replace('shift-','Shift ')} · {task.product}{task.effectiveTime?` · ${task.effectiveTime}`:''}</strong><br/>
        {task.needsSetup?'Finish the saved price-change details.':`${task.done} / ${task.total} readings confirmed. ${task.nextNozzle?`Next: ${task.nextNozzle}.`:'Ready for manager price confirmation.'}`}</p>
      <button type="button" className="primary" disabled={disabled} onClick={()=>onOpen(task)}>Open {task.shiftId.replace('shift-','Shift ')} {task.product} price change{task.effectiveTime?` at ${task.effectiveTime}`:''}</button>
    </div>)}
  </aside>;
}
