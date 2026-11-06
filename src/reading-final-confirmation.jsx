import {useEffect,useId,useRef} from 'react';

export function ReadingFinalConfirmation({reading,pump,shift,warning,onCancel,onConfirm}){
  const dialog=useRef(null),cancel=useRef(null),title=useId(),description=useId();
  useEffect(()=>{
    document.activeElement?.blur?.();
    const element=dialog.current;
    element.showModal();cancel.current?.focus({preventScroll:true});
    return()=>{if(element.open)element.close();};
  },[]);
  return <dialog ref={dialog} className="reading-final-confirmation" aria-labelledby={title} aria-describedby={description}
    onCancel={event=>{event.preventDefault();onCancel();}}>
    <h2 id={title}>Are you really sure?</h2>
    <p id={description}>Double-check every digit and the decimal point. Press Cancel if you would like to look again.</p>
    <div className="reading-final-number"><small>Reading to confirm</small><strong>{reading}</strong></div>
    <p className="reading-final-context"><strong>{pump}</strong><br/>{shift}</p>
    {warning&&<p className="warning-box">{warning}<br/>Admin will see this warning.</p>}
    <div className="reading-final-actions">
      <button ref={cancel} type="button" className="reading-final-cancel" onClick={onCancel}>Cancel and double-check</button>
      <button type="button" className="reading-final-sure" onClick={onConfirm}>I'm really sure</button>
    </div>
  </dialog>;
}
