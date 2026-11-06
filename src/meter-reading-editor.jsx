import {useEffect,useRef,useState} from 'react';
import {useMeterPhotoPreview} from './meter-photo-preview.js';

export function MeterReadingEditor({photo,label,value,onChange}){
  const {src:crop,fitted}=useMeterPhotoPreview(photo);
  const [zoom,setZoom]=useState(1),[full,setFull]=useState(false);
  const editor=useRef(null),input=useRef(null),viewport=useRef(null);
  useEffect(()=>{
    const align=()=>{
      editor.current?.style.setProperty('--reading-view-height',`${window.visualViewport?.height||window.innerHeight}px`);
      editor.current?.scrollIntoView({block:'start',behavior:'instant'});
    };
    const frame=requestAnimationFrame(()=>{input.current?.focus({preventScroll:true});align();});
    window.visualViewport?.addEventListener('resize',align);
    return()=>{cancelAnimationFrame(frame);window.visualViewport?.removeEventListener('resize',align);};
  },[]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    element.scrollLeft=(element.scrollWidth-element.clientWidth)/2;element.scrollTop=(element.scrollHeight-element.clientHeight)/2;
  },[zoom,full,crop]);
  return <div className="meter-reading-editor" ref={editor}>
    <p className="meter-editor-title">Check the photo while you type.</p>
    <div className="meter-photo-window" ref={viewport} tabIndex="0" role="region" aria-label="Enlarged meter digits">
      <div className="meter-photo-content" style={{width:`${zoom*100}%`,height:`${zoom*100}%`}}>
        <img src={!full&&crop?crop:photo} alt="Original meter photo enlarged for checking every digit and the decimal point"/>
      </div>
    </div>
    <div className="meter-zoom-controls" aria-label="Meter photo zoom controls">
      <button type="button" aria-label="Zoom out meter photo" disabled={zoom<=1} onClick={()=>setZoom(current=>Math.max(1,current-.5))}>−</button>
      <button type="button" aria-label="Zoom in meter photo" disabled={zoom>=4} onClick={()=>setZoom(current=>Math.min(4,current+.5))}>+</button>
      <button type="button" onClick={()=>{setFull(false);setZoom(1);}}>Fit digits</button>
      <button type="button" onClick={()=>{setFull(true);setZoom(1);}}>Full photo</button>
    </div>
    <small>{fitted&&!full?'All detected digits and the decimal point are shown.':'Full photo shown. Zoom and slide to inspect the digits.'}</small>
    <label>Corrected reading<input ref={input} aria-label={label} inputMode="decimal" autoComplete="off" autoCorrect="off" spellCheck={false} value={value} onChange={event=>onChange(event.target.value)}/></label>
  </div>;
}
