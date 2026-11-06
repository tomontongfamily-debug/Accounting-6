import {useEffect,useRef,useState} from 'react';
import {analyzeTotalizerFrame} from './totalizer-frame-client.js';
import {meterPhotoRegion} from './meter-photo-region.js';

export function MeterReadingEditor({photo,label,value,onChange}){
  const [crop,setCrop]=useState(''),[fitted,setFitted]=useState(false),[zoom,setZoom]=useState(1),[full,setFull]=useState(false);
  const editor=useRef(null),input=useRef(null),viewport=useRef(null);
  useEffect(()=>{
    let active=true;setCrop('');setFitted(false);setZoom(1);setFull(false);
    const image=new Image();image.src=photo;
    (async()=>{
      try{
        await image.decode();if(!active)return;
        const scale=Math.min(1,1280/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
        const {analysis}=await analyzeTotalizerFrame(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
        if(!active)return;
        const region=meterPhotoRegion(analysis.regions,canvas.width,canvas.height);
        if(region){
          const preview=document.createElement('canvas');preview.width=Math.max(1,Math.round(region.width*image.naturalWidth));preview.height=Math.max(1,Math.round(region.height*image.naturalHeight));
          preview.getContext('2d').drawImage(image,region.x*image.naturalWidth,region.y*image.naturalHeight,region.width*image.naturalWidth,region.height*image.naturalHeight,0,0,preview.width,preview.height);
          setCrop(preview.toDataURL('image/png'));setFitted(true);
        }
      }catch{ /* The full photo and manual zoom remain available. */ }
    })();
    return()=>{active=false;};
  },[photo]);
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
