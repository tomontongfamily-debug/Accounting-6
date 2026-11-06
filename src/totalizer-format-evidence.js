import {totalizerRegions,withoutDisplayFrame,segmentDisplaySymbols,readingWithVisibleDecimal,verifyLcdDigits} from './totalizer-image.js';

const isDigit=symbol=>/^\d$/.test(symbol?.text);
const digits=symbols=>Array.isArray(symbols)?symbols.filter(isDigit):[];
const validId=value=>typeof value==='string'?value.length>0:Number.isInteger(value);
const sameScope=(a,b)=>validId(a?.regionId)&&validId(a?.layoutId)&&a.regionId===b?.regionId&&a.layoutId===b?.layoutId;
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const meterSymbols=symbols=>Array.isArray(symbols)&&symbols.every(symbol=>isDigit(symbol)||symbol?.text==='.');
function validBox(box,width,height){
  return box&&['x0','x1','y0','y1'].every(key=>Number.isFinite(box[key]))&&
    box.x0>=0&&box.y0>=0&&box.x1<=width&&box.y1<=height&&box.x1>box.x0&&box.y1>box.y0;
}
function sameBox(a,b){return ['x0','x1','y0','y1'].every(key=>a?.[key]===b?.[key]);}
function qualifiedPass(pass,physical,text,width,height){
  if(!sameScope(physical,pass)||!Number.isFinite(pass.confidence)||!meterSymbols(pass.symbols))return false;
  const symbols=digits(pass.symbols);
  // These are the primary reader's existing confidence requirements. A caller
  // cannot substitute an "accepted" flag or physical confidence for OCR votes.
  return symbols.length===8&&symbols.map(symbol=>symbol.text).join('')===text&&
    pass.confidence>=(symbols[0].lcdVerified?40:70)&&
    symbols.every(symbol=>symbol.confidence>=90&&!symbol.lcdAmbiguous&&validBox(symbol.bbox,width,height));
}

// Decide only whether ONE OCR-derived nine-cell hint has a proven interior
// split. This never supplies a number or accepts an OCR reading. Callers must
// retain every physical nine-cell guard, and every unexplained OCR hint, before
// using their unchanged grid/neural consensus rules.
export function canDismissNineCellHint(proof={},options={}){
  const observer=typeof options?.onDecision==='function'?options.onDecision:null;
  const decide=(accepted,code,reason,details)=>{
    if(observer){try{observer({code,reason,...details?.()});}catch{ /* Diagnostics cannot change format evidence. */ }}
    return accepted;
  };
  const reject=(code,reason,details)=>decide(false,code,reason,details);
  const {physical,hint,agreeingPasses}=proof||{};
  if(!sameScope(physical,hint))return reject(1,'scope');
  if(!Array.isArray(physical.symbols)||physical.symbols.length!==8)return reject(2,'physical-count');
  if(physical.symbols.some(symbol=>!isDigit(symbol)||symbol.lcdAmbiguous))return reject(3,'physical-symbols');
  const {image,region}=physical;
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<=0||image.height<=0||
    !ArrayBuffer.isView(image.gray)||image.gray.BYTES_PER_ELEMENT!==1||image.gray.length!==image.width*image.height)return reject(4,'raw-image');
  const {gray,width,height}=image;
  if(!region||!['x','y','width','height','bandHeight'].every(key=>Number.isInteger(region[key]))||
    region.x<0||region.y<0||region.width<=0||region.height<=0||region.bandHeight<=0||
    region.x+region.width>width||region.y+region.height>height)return reject(5,'region');
  if(!physical.symbols.every(symbol=>validBox(symbol.bbox,width,height)))return reject(3,'physical-symbols');
  if(!meterSymbols(hint.symbols))return reject(6,'hint-symbols');
  const nine=digits(hint.symbols);
  if(nine.length!==9||!nine.every(symbol=>validBox(symbol.bbox,width,height)))return reject(6,'hint-symbols');

  // Rebuild the independent mask/cells from this exact grayscale image. The
  // existing verifier permits a uniquely read binary pattern to rescue a weak
  // grayscale sample; a stale array of claimed digits must not rescue a blank
  // or different image. This is combined mask + grayscale evidence, not a
  // claim that every digit passed the grayscale-only verifier.
  const analysis=totalizerRegions(gray,width,height);
  const cells=segmentDisplaySymbols(withoutDisplayFrame(analysis.mask,width,region),width,region);
  if(cells.length!==8||cells.some((symbol,index)=>!isDigit(symbol)||symbol.text!==physical.symbols[index].text||
    !sameBox(symbol.bbox,physical.symbols[index].bbox)))return reject(7,'raw-proof');
  const bodies=cells.filter(symbol=>symbol.text!=='1');
  const bodyWidths=bodies.map(symbol=>symbol.bbox.x1-symbol.bbox.x0);
  if(bodyWidths.length<3)return reject(10,'cell-width');
  const cellWidth=median(bodyWidths),cellHeight=median(bodies.map(symbol=>symbol.bbox.y1-symbol.bbox.y0));
  // A merged pair cannot become a single wide physical "1" merely because
  // the ordinary grayscale verifier reconstructs a one's width from peers.
  if(cells.some(symbol=>symbol.bbox.x1-symbol.bbox.x0>cellWidth*1.35))return reject(10,'cell-width');
  if(readingWithVisibleDecimal(cells,analysis.components,{integerDigits:6,decimalPlaces:2})===null||
    !verifyLcdDigits(cells,gray,width,height,cells))return reject(8,'decimal-or-gray-proof');
  const text=cells.map(symbol=>symbol.text).join('');
  if(!Array.isArray(agreeingPasses)||!agreeingPasses.some(pass=>qualifiedPass(pass,physical,text,width,height)))return reject(9,'qualified-pass');

  const envelope={left:cells[0].bbox.x0,right:cells.at(-1).bbox.x1,
    top:Math.min(...cells.map(symbol=>symbol.bbox.y0)),bottom:Math.max(...cells.map(symbol=>symbol.bbox.y1))};
  // Crop growth and OCR line fitting can include a small blank border. Bound
  // that box spill by peer size; physical row/cell CENTER bounds stay exact.
  const padding={x:Math.min(3,Math.max(1,Math.ceil(cellWidth*.06))),y:Math.min(8,Math.max(1,Math.ceil(cellHeight*.08)))};
  const ranges=cells.map((symbol,index)=>({
    // An interior one occupies only the right strokes of its physical cell.
    // Peer digit width can define that cell, but must never expand the outer
    // center envelope and absorb a real faint leading ninth digit.
    left:index>0&&symbol.text==='1'?symbol.bbox.x1-cellWidth:symbol.bbox.x0,
    right:symbol.bbox.x1,
  }));
  if(ranges.some((range,index)=>range.right<=range.left||index>0&&range.left<ranges[index-1].right))return reject(11,'cell-ranges');
  const assignments=[];
  for(const [index,symbol]of nine.entries()){
    const box=symbol.bbox;
    if(box.x0<envelope.left-padding.x||box.x1>envelope.right+padding.x||box.y0<envelope.top-padding.y||box.y1>envelope.bottom+padding.y)return reject(12,'envelope',()=>({index,bbox:{...box},envelope:{...envelope},padding:{...padding}}));
    const center={x:(box.x0+box.x1)/2,y:(box.y0+box.y1)/2};
    if(center.x<envelope.left||center.x>envelope.right||center.y<envelope.top||center.y>envelope.bottom)return reject(16,'center-envelope',()=>({index,bbox:{...box},envelope:{...envelope},center}));
    if(box.x1-box.x0>cellWidth+2*padding.x||box.y1-box.y0>cellHeight+2*padding.y)return reject(17,'oversized-glyph',()=>({index,bbox:{...box},envelope:{...envelope},padding:{...padding}}));
    const matching=ranges.flatMap((range,index)=>center.x>=range.left&&center.x<=range.right?[index]:[]);
    if(matching.length!==1||assignments.length&&matching[0]<assignments.at(-1))return reject(13,'cell-mapping',()=>({index,bbox:{...box},matchingCells:[...matching]}));
    assignments.push(matching[0]);
  }
  const mapped=cells.map((_,index)=>nine.filter((_,position)=>assignments[position]===index));
  const split=mapped.flatMap((symbols,index)=>symbols.length===2?[index]:[]);
  if(split.length!==1||split[0]===0||split[0]===7||mapped.some(symbols=>symbols.length<1||symbols.length>2))return reject(14,'split');
  const conflict=mapped.findIndex((symbols,index)=>!symbols.some(symbol=>symbol.text===cells[index].text));
  if(conflict!==-1)return reject(15,'digit-conflict',()=>({index:conflict}));
  return decide(true,0,'proven-split');
}
