// Local contrast removes broad reflections while retaining narrow LCD segments.
// Coordinates are found from the image; no pump-specific crop or expected value.
export function totalizerRegions(gray,width,height){
  const mask=totalizerMask(gray,width,height);
  return totalizerRegionsFromMask(mask,width,height);
}

export function totalizerMask(gray,width,height,threshold=10){
  const stride=width+1,integral=new Float64Array(stride*(height+1));
  for(let y=0;y<height;y++){let sum=0;for(let x=0;x<width;x++){sum+=gray[y*width+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum;}}
  const radius=Math.max(8,Math.round(Math.min(width,height)*.026)),mask=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
    const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
    mask[y*width+x]=mean-gray[y*width+x]>threshold?1:0;
  }
  return mask;
}

function totalizerRegionsFromMask(mask,width,height){
  const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length),components=[],projection=new Uint32Array(height);
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;
    let size=1,head=0,x0=i%width,x1=x0,y0=Math.floor(i/width),y1=y0;queue[0]=i;seen[i]=1;
    while(head<size){const k=queue[head++],x=k%width,y=Math.floor(k/width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const n of [x>0?k-1:-1,x<width-1?k+1:-1,y>0?k-width:-1,y<height-1?k+width:-1])if(n>=0&&mask[n]&&!seen[n]){seen[n]=1;queue[size++]=n;}
    }
    const c={x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,area:size};components.push(c);
    if(size>=20&&c.width<width*.5&&c.height<height*.85)for(let j=0;j<size;j++)projection[Math.floor(queue[j]/width)]++;
  }
  const bands=[],minimum=Math.max(12,width*.025),gap=Math.max(3,Math.round(height*.01));let start=-1,last=-1;
  for(let y=0;y<=height;y++){
    if(y<height&&projection[y]>=minimum){if(start<0)start=y;last=y;}
    else if(start>=0&&(y===height||y-last>gap)){if(last-start>=18)bands.push({top:start,bottom:last+1});start=-1;}
  }
  const regions=[];
  for(const band of bands){
    const h=band.bottom-band.top,parts=components.filter(c=>c.area>=20&&c.width<width*.5&&c.height<height*.85&&c.y<band.bottom&&c.y+c.height>band.top);
    if(parts.length<3)continue;
    const groups=[];
    for(const c of parts.sort((a,b)=>a.x-b.x)){
      const last=groups.at(-1);
      if(!last||c.x-last.right>h*.8)groups.push({left:c.x,right:c.x+c.width,count:1});
      else{last.right=Math.max(last.right,c.x+c.width);last.count++;}
    }
    const group=groups.filter(g=>g.count>=3).sort((a,b)=>(b.right-b.left)-(a.right-a.left))[0];if(!group)continue;
    const {left,right}=group;if(right-left<h*2.5)continue;
    const x=Math.max(0,Math.floor(left-h*.15)),y=Math.max(0,Math.floor(band.top-h*.1));
    const end=Math.min(width,Math.ceil(right+h*.75)),bottom=Math.min(height,Math.ceil(band.bottom+h*.1));
    regions.push({x,y,width:end-x,height:bottom-y,bandHeight:h});
  }
  const segmentRows=segmentRegions(components,mask,width,height);
  return {mask,components,regions:segmentRows.length?segmentRows:regions.sort((a,b)=>b.bandHeight-a.bandHeight).slice(0,8)};
}

// LCD digits contain two similarly sized vertical strokes. Find aligned pairs
// before considering broad text bands, which can include glare and frame edges.
function segmentRegions(components,mask,width,height){
  const strokes=components.filter(c=>c.height>=12&&c.height<height*.12&&c.width/c.height>.12&&c.width/c.height<1.3&&c.area/(c.width*c.height)>.25);
  const pairs=[];
  for(const a of strokes)for(const b of strokes){
    if(b.y<=a.y||Math.abs(a.height-b.height)>Math.max(a.height,b.height)*.4)continue;
    const dy=b.y-a.y,h=(a.height+b.height)/2;
    if(dy<h*.8||dy>h*1.45||Math.abs((a.x+a.width/2)-(b.x+b.width/2))>h*.8)continue;
    pairs.push({x:(a.x+a.width/2+b.x+b.width/2)/2,y:a.y,h:b.y+b.height-a.y});
  }
  const groups=[];
  for(const seed of pairs){
    const line=pairs.filter(p=>Math.abs(p.h-seed.h)<seed.h*.25&&Math.abs(p.y-seed.y)<seed.h*.3);
    if(line.length<2)continue;
    const x0=Math.min(...line.map(p=>p.x)),x1=Math.max(...line.map(p=>p.x));if(x1-x0<seed.h)continue;
    const top=Math.min(...line.map(p=>p.y)),bottom=Math.max(...line.map(p=>p.y+p.h)),h=bottom-top;
    if(groups.some(g=>Math.abs(g.y-top)<seed.h*.3))continue;
    const aligned=components.filter(c=>c.area>=h*.8&&c.y>=top-h*.15&&c.y+c.height<=bottom+h*.15&&c.width>=h*.07&&c.height>=h*.07).sort((a,b)=>a.x-b.x);
    const spans=[];
    for(const c of aligned){const last=spans.at(-1);if(!last||c.x-last.right>h*.85)spans.push({left:c.x,right:c.x+c.width,parts:[c]});else{last.right=Math.max(last.right,c.x+c.width);last.parts.push(c);}}
    const span=spans.find(g=>g.left<=x0&&g.right>=x1&&g.right-g.left>h*3);
    const parts=span?.parts||[];
    if(!parts.length)continue;
    const left=Math.min(...parts.map(c=>c.x)),right=Math.max(...parts.map(c=>c.x+c.width));
    const y=Math.max(0,Math.floor(top-h*.08)),endY=Math.min(height,Math.ceil(bottom+h*.08));
    // Relabel inside the number row: a weak digit may be connected to a frame
    // or reflection elsewhere in the full image, outside this row.
    const rowParts=rowComponents(mask,width,Math.max(0,Math.floor(left-h)),Math.min(width,Math.ceil(right+h)),y,endY).filter(c=>c.height>h*.3&&c.width>h*.07&&c.area>h*1.2);
    let l=left,r=right;
    for(const c of rowParts){
      if(c.x+c.width<left-h*.85||c.x>right+h*.85)continue;
      if(c.y===y&&c.y+c.height===endY){
        if(c.x+c.width>width-h*.1)r=Math.max(r,c.x+c.width);
        else if(c.x<left&&c.width>h*.6)l=Math.min(l,Math.max(c.x,left-h*.65));
      }else{l=Math.min(l,c.x);r=Math.max(r,c.x+c.width);}
    }
    const x=Math.max(0,Math.floor(l-h*.05));
    const region={x,y,width:Math.min(width,Math.ceil(r+h*.05))-x,height:endY-y,bandHeight:h};
    // A frame connected to a reflection can extend the left crop. Keep a
    // tighter alternative, but never drop evidence beyond the rightmost digit.
    const tightX=Math.max(0,Math.floor(left-h*.05));
    if(x<tightX&&r===right)region.fallback={x:tightX,y,width:Math.min(width,Math.ceil(right+h*.05))-tightX,height:endY-y,bandHeight:h};
    groups.push(region);
  }
  return groups.sort((a,b)=>b.bandHeight-a.bandHeight).slice(0,8);
}

function rowComponents(mask,width,left,right,top,bottom){
  const w=right-left,h=bottom-top,seen=new Uint8Array(w*h),queue=new Int32Array(w*h),parts=[];
  for(let i=0;i<seen.length;i++){
    const sx=i%w,sy=Math.floor(i/w);if(seen[i]||!mask[(top+sy)*width+left+sx])continue;
    let size=1,head=0,x0=sx,x1=sx,y0=sy,y1=sy;seen[i]=1;queue[0]=i;
    while(head<size){const k=queue[head++],x=k%w,y=Math.floor(k/w);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const n of[x>0?k-1:-1,x<w-1?k+1:-1,y>0?k-w:-1,y<h-1?k+w:-1])if(n>=0&&!seen[n]&&mask[(top+Math.floor(n/w))*width+left+n%w]){seen[n]=1;queue[size++]=n;}
    }
    parts.push({x:left+x0,y:top+y0,width:x1-x0+1,height:y1-y0+1,area:size});
  }return parts;
}

export function readingWithVisibleDecimal(symbols,components){
  const digits=symbols.filter(s=>/^\d$/.test(s.text));
  if(digits.length<4||digits.length>12||digits.some(s=>s.confidence<70))return null;
  const heights=digits.map(s=>s.bbox.y1-s.bbox.y0).sort((a,b)=>a-b),h=heights[Math.floor(heights.length/2)];
  if(digits.some(s=>s.bbox.y1-s.bbox.y0<h*.55||s.bbox.y1-s.bbox.y0>h*1.5))return null;
  const bottoms=digits.map(s=>s.bbox.y1).sort((a,b)=>a-b),bottom=bottoms[Math.floor(bottoms.length/2)];
  if(digits.some(s=>Math.abs(s.bbox.y1-bottom)>h*.2))return null;
  const centers=digits.map(s=>(s.bbox.x0+s.bbox.x1)/2);
  if(centers.some((x,i)=>i>0&&x<=centers[i-1]))return null;
  if(digits.some((s,i)=>i>0&&digits[i-1].bbox.x1-s.bbox.x0>h*.25))return null;
  const points=components.filter(c=>c.width>=Math.max(2,h*.05)&&c.height>=Math.max(2,h*.05)&&c.width<h*.22&&c.height<h*.22&&c.width/c.height>.5&&c.width/c.height<1.15&&c.area/(c.width*c.height)>.6&&Math.abs(c.y+c.height-bottom)<h*.15&&c.y>bottom-h*.25&&c.x>centers[0]&&c.x<centers.at(-1));
  // Broken strokes can resemble dots inside earlier digits. Only dots that can
  // represent the display's one-to-three decimal places are candidates.
  const positions=new Set(points.map(p=>({x:p.x+p.width/2,i:centers.filter(x=>x<p.x+p.width/2).length})).filter(({x,i})=>digits.length-i>=1&&digits.length-i<=3&&x>=digits[i-1].bbox.x1-h*.12&&x<=digits[i].bbox.x0+h*.12).map(p=>p.i));
  if(positions.size!==1)return null;
  const decimal=[...positions][0],places=digits.length-decimal;if(places<1||places>3)return null;
  const text=digits.map(s=>s.text).join('');return Number(text.slice(0,decimal)+'.'+text.slice(decimal));
}

// The first LCD digit often falls under the bright edge of a reflection. Check
// its seven physical strokes in the original grayscale image, before a binary
// threshold loses them. Neighbouring digit spacing defines the cell, never an
// opening reading, pump identity, filename or expected result.
export function refineLeadingLcdDigit(symbols,gray,width,height){
  const digits=symbols.filter(s=>/^\d$/.test(s.text));
  if(digits.length<5)return symbols;
  const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
  const body=digits.slice(1).filter(s=>s.text!=='1');
  if(body.length<3)return symbols;
  const w=median(body.map(s=>s.bbox.x1-s.bbox.x0)),h=median(body.map(s=>s.bbox.y1-s.bbox.y0));
  const pitch=median(digits.slice(2).map((s,i)=>s.bbox.x1-digits[i+1].bbox.x1).filter(d=>d>w*.8&&d<w*1.8));
  if(!Number.isFinite(pitch)||w<h*.35||w>h*.8)return symbols;
  const right=median(digits.slice(1).map((s,i)=>s.bbox.x1-(i+1)*pitch));
  const left=right-w,top=median(body.map(s=>s.bbox.y0)),bottom=top+h;
  if(left<0||right>=width||top-h*.15<0||bottom+h*.15>=height)return symbols;
  if(Math.abs((digits[0].bbox.x0+digits[0].bbox.x1)/2-(left+right)/2)>w*.4)return symbols;
  const positions=[[.5,.06,0],[.85,.25,1],[.85,.75,1],[.5,.94,0],[.15,.75,1],[.15,.25,1],[.5,.5,0]];
  const contrastAt=shift=>positions.map(([x,y,vertical])=>{
    const cx=left+x*w,cy=top+(y+shift)*h,span=Math.max(2,Math.round(vertical?h*.07:w*.12)),radius=Math.round(vertical?w*.24:h*.14),samples=[];
    for(let t=-span;t<=span;t++){
      let value=0;
      for(let normal=-2;normal<=2;normal++){
        const ix=Math.round(cx+(vertical?normal:t)),iy=Math.round(cy+(vertical?t:normal));
        if(vertical?(ix-radius<0||ix+radius>=width||iy<0||iy>=height):(iy-radius<0||iy+radius>=height||ix<0||ix>=width))return NaN;
        const offset=vertical?radius:radius*width;
        value+=(gray[iy*width+ix-offset]+gray[iy*width+ix+offset])/2-gray[iy*width+ix];
      }
      samples.push(value/5);
    }
    return median(samples);
  });
  const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
  // Active strokes need positive local contrast; inactive strokes must really
  // be absent. A damaged or ambiguous pattern leaves OCR unchanged.
  const votes=new Map();
  for(const shift of[-.04,-.02,0,.02,.03,.04]){
    const contrast=contrastAt(shift);
    const matches=patterns.map((pattern,digit)=>({pattern,digit})).filter(({pattern})=>[...pattern].every((on,i)=>on==='1'?contrast[i]>=7:contrast[i]<=3));
    if(matches.length===1)votes.set(matches[0].digit,(votes.get(matches[0].digit)||0)+1);
  }
  if(votes.size!==1||[...votes.values()][0]<2)return symbols;
  const text=String([...votes.keys()][0]);
  return symbols.map(s=>s===digits[0]?{...s,text,lcdVerified:true}:s);
}

// Grow dark segments slightly to reconnect tiny reflection/compression gaps.
export function totalizerCrop(mask,width,height,region,pad=20,grow=1){
  const w=region.width+pad*2,h=region.height+pad*2,rgba=new Uint8ClampedArray(w*h*4);rgba.fill(255);
  for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){
    let dark=false;
    for(let dy=-grow;dy<=grow&&!dark;dy++)for(let dx=-grow;dx<=grow;dx++){
      const sx=region.x+x+dx,sy=region.y+y+dy;
      if(sx>=region.x&&sx<region.x+region.width&&sy>=region.y&&sy<region.y+region.height&&mask[sy*width+sx]){dark=true;break;}
    }
    if(dark){const i=((y+pad)*w+x+pad)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
  }
  return {rgba,width:w,height:h,pad};
}
