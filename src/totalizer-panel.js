import {totalizerRegions,segmentDisplaySymbols,withoutDisplayFrame} from './totalizer-image.js';

export function isPrintedTotalizerArrow(gray,width,height,box){
 const w=box.x1-box.x0,h=box.y1-box.y0;
 if(w<h*.45||w>h*1.4||h<20||box.x0<0||box.x1>width||box.y0<0||box.y1>=height)return false;
 const samples=[];
 for(let t=.1;t<.951;t+=.1){
  const y=Math.round(box.y0+t*h),radius=Math.max(3,Math.round(w*.08));
  const background=Math.max(gray[y*width+Math.max(0,box.x0-radius)],gray[y*width+Math.min(width-1,box.x1+radius)]);
  let left=Infinity,right=-Infinity,dark=0;
  for(let x=box.x0;x<box.x1;x++)if(background-gray[y*width+x]>=20){left=Math.min(left,x);right=Math.max(right,x);dark++;}
  const span=right-left+1;
  if(!Number.isFinite(span)||span<1||dark/span<.88)return false;
  samples.push({t,left,right,span});
 }
 const error=samples.reduce((sum,s)=>sum+Math.abs(s.span/w-(1-Math.abs(2*s.t-1))),0)/samples.length;
 const stable=edge=>Math.max(...samples.map(s=>s[edge]))-Math.min(...samples.map(s=>s[edge]))<w*.12;
 return error<.12&&(stable('left')||stable('right'))&&samples[4].span>w*.75&&samples[0].span<w*.4&&samples.at(-1).span<w*.4;
}

// A printed triangle is not a counter cell. Retain every other physical
// cell, including a genuine ninth digit. A long reflection or apparent bezel
// alone is deliberately insufficient to discard any part of a number row.
export function totalizerPanelRegion(gray,width,height,mask,region){
 const cells=segmentDisplaySymbols(withoutDisplayFrame(mask,width,region),width,region);
 if(cells.length<7||cells.length>11)return null;
 let first=0,last=cells.length;
 if(isPrintedTotalizerArrow(gray,width,height,cells[0].bbox))first++;
 if(isPrintedTotalizerArrow(gray,width,height,cells.at(-1).bbox))last--;
 if(first===0&&last===cells.length||last-first<6||last-first>9)return null;
 const left=first?Math.floor((cells[first-1].bbox.x1+cells[first].bbox.x0)/2):region.x;
 const right=last<cells.length?Math.ceil((cells[last-1].bbox.x1+cells[last].bbox.x0)/2):region.x+region.width;
 return {x:left,y:region.y,width:right-left,height:region.height,bandHeight:region.bandHeight,
   panelProof:{originalCount:cells.length,retainedCount:last-first,printedArrow:true}};
}

export function enhanceTotalizerAnalysis(gray,width,height,analysis){
 const regions=analysis.regions.map(r=>totalizerPanelRegion(gray,width,height,analysis.mask,r)||r);
 const sensitive=totalizerRegions(gray,width,height,5);
 let improved=false,extraCellHint=false;
 const compatible=regions.every(region=>{
   const before=segmentDisplaySymbols(withoutDisplayFrame(analysis.mask,width,region),width,region,{shear:true,learned:true});
   const after=segmentDisplaySymbols(withoutDisplayFrame(sensitive.mask,width,region),width,region,{shear:true,learned:true});
   if(after.length>before.length&&after.length>=9)extraCellHint=true;
   if(before.length<6||before.length>9||after.length!==before.length)return false;
   const h=region.bandHeight;
   if(before.some((cell,i)=>{
     const other=after[i],a=cell.bbox,b=other.bbox;
     return Math.abs((a.x0+a.x1-b.x0-b.x1)/2)>h*.12||Math.abs(a.y1-b.y1)>h*.12||
       Math.abs((a.x1-a.x0)-(b.x1-b.x0))>h*.18||cell.text!=='?'&&other.text!=='?'&&cell.text!==other.text;
   }))return false;
   if(after.filter(c=>c.text!=='?').length>before.filter(c=>c.text!=='?').length)improved=true;
   return true;
 });
 return compatible&&improved?{...sensitive,regions,maskThreshold:5,extraCellHint}:{...analysis,regions,maskThreshold:10,extraCellHint};
}
