import {useEffect,useId,useRef,useState} from 'react';
import {useMeterPhotoPreview} from './meter-photo-preview.js';

export function ReadingFinalConfirmation({reading,photo,pump,shift,warning,onCancel,onConfirm}){
  const dialog=useRef(null),cancel=useRef(null),title=useId(),description=useId();
  const preview=useMeterPhotoPreview(photo),[photoReady,setPhotoReady]=useState(false),[photoFailed,setPhotoFailed]=useState(false);
  useEffect(()=>{
    document.activeElement?.blur?.();
    const element=dialog.current;
    element.showModal();cancel.current?.focus({preventScroll:true});
    return()=>{if(element.open)element.close();};
  },[]);
  return <dialog ref={dialog} className="reading-final-confirmation" aria-labelledby={title} aria-describedby={description}
    onCancel={event=>{event.preventDefault();onCancel();}}>
    <h2 id={title}>Are you really sure?</h2>
    <p id={description}>Compare the photo with the number you entered. Check every digit and the decimal point.</p>
    <div className="reading-final-comparison">
      <figure className="reading-final-photo"><figcaption>Meter photo</figcaption><div>
        {preview.src?<img src={preview.src} alt="Meter digits in the saved pump photo" onLoad={()=>setPhotoReady(true)} onError={()=>setPhotoFailed(true)}/>:<small>Preparing photo…</small>}
      </div></figure>
      <div className="reading-final-number"><small>Reading to confirm</small><strong>{reading}</strong></div>
    </div>
    {photoFailed&&<p className="warning-box">The photo could not be displayed. Cancel and check the photo before confirming.</p>}
    <p className="reading-final-context"><strong>{pump}</strong><br/>{shift}</p>
    {warning&&<p className="warning-box">{warning}<br/>Admin will see this warning.</p>}
    <div className="reading-final-actions">
      <button ref={cancel} type="button" className="reading-final-cancel" onClick={onCancel}>Cancel and double-check</button>
      <button type="button" className="reading-final-sure" disabled={!photoReady||photoFailed} onClick={onConfirm}>I'm really sure</button>
    </div>
  </dialog>;
}
