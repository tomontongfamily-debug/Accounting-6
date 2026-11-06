import {useEffect,useState} from 'react';
import {analyzeTotalizerFrame} from './totalizer-frame-client.js';
import {meterPhotoRegion} from './meter-photo-region.js';

// Small, device-memory-only cache shared by editing and final confirmation.
// Reuse the loaded photo rather than downloading it again when a dialog opens.
const previews=new Map();
const keyOf=photo=>new URL(photo,location.href).href;
function recordFor(photo){
  const key=keyOf(photo);
  if(!previews.has(key)){
    previews.set(key,{});
    if(previews.size>6)previews.delete(previews.keys().next().value);
  }
  return previews.get(key);
}
export function rememberMeterPhoto(photo,image){
  if(photo&&image&&keyOf(image.currentSrc||image.src)===keyOf(photo))recordFor(photo).image=image;
}
async function preparePreview(photo,record){
  let source;
  try{
    let image=record.image;
    if(!image||keyOf(image.currentSrc||image.src)!==keyOf(photo)){image=new Image();image.src=photo;}
    await image.decode();
    if(keyOf(image.currentSrc||image.src)!==keyOf(photo)){image=new Image();image.src=photo;await image.decode();}
    source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;
    source.getContext('2d').drawImage(image,0,0);
    const scale=Math.min(1,1280/Math.max(source.width,source.height)),analysisImage=document.createElement('canvas');
    analysisImage.width=Math.max(1,Math.round(source.width*scale));analysisImage.height=Math.max(1,Math.round(source.height*scale));
    const context=analysisImage.getContext('2d',{willReadFrequently:true});context.drawImage(source,0,0,analysisImage.width,analysisImage.height);
    const {analysis}=await analyzeTotalizerFrame(context.getImageData(0,0,analysisImage.width,analysisImage.height).data,analysisImage.width,analysisImage.height);
    const region=meterPhotoRegion(analysis.regions,analysisImage.width,analysisImage.height);
    if(region){
      const crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(region.width*source.width));crop.height=Math.max(1,Math.round(region.height*source.height));
      crop.getContext('2d').drawImage(source,region.x*source.width,region.y*source.height,region.width*source.width,region.height*source.height,0,0,crop.width,crop.height);
      return {src:crop.toDataURL('image/png'),fitted:true};
    }
    return {src:source.toDataURL('image/png'),fitted:false};
  }catch{
    try{return {src:source?source.toDataURL('image/png'):photo,fitted:false};}
    catch{return {src:photo,fitted:false};}
  }
  finally{delete record.image;}
}
export function useMeterPhotoPreview(photo){
  const [preview,setPreview]=useState({src:'',fitted:false});
  useEffect(()=>{
    let active=true;if(!photo)return;
    const record=recordFor(photo);setPreview(record.value||{src:'',fitted:false});
    record.promise ||= preparePreview(photo,record).then(value=>{record.value=value;return value;});
    record.promise.then(value=>{if(active)setPreview(value);});
    return()=>{active=false;};
  },[photo]);
  return preview;
}
