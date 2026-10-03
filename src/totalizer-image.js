// Local contrast removes broad reflections while retaining narrow LCD segments.
// Coordinates are found from the image; no pump-specific crop or expected value.
export function totalizerRegions(gray,width,height){
  const stride=width+1,integral=new Float64Array(stride*(height+1));
  for(let y=0;y<height;y++){let sum=0;for(let x=0;x<width;x++){sum+=gray[y*width+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum;}}
  const radius=Math.max(8,Math.round(Math.min(width,height)*.026)),mask=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
    const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
    mask[y*width+x]=mean-gray[y*width+x]>10?1:0;
  }
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
  return {mask,components,regions:regions.sort((a,b)=>b.bandHeight-a.bandHeight).slice(0,8)};
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
  const points=components.filter(c=>c.width>=Math.max(2,h*.025)&&c.height>=Math.max(2,h*.025)&&c.width<h*.22&&c.height<h*.22&&c.width/c.height>.5&&c.width/c.height<1.8&&c.area/(c.width*c.height)>.6&&Math.abs(c.y+c.height-bottom)<h*.15&&c.y>bottom-h*.25&&c.x>centers[0]&&c.x<centers.at(-1));
  const positions=new Set(points.map(p=>centers.filter(x=>x<p.x+p.width/2).length));
  if(positions.size!==1)return null;
  const decimal=[...positions][0],places=digits.length-decimal;if(places<1||places>3)return null;
  const text=digits.map(s=>s.text).join('');return Number(text.slice(0,decimal)+'.'+text.slice(decimal));
}

// Grow dark segments by one pixel to reconnect tiny reflection/compression gaps.
export function totalizerCrop(mask,width,height,region,pad=20){
  const w=region.width+pad*2,h=region.height+pad*2,rgba=new Uint8ClampedArray(w*h*4);rgba.fill(255);
  for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){
    let dark=false;
    for(let dy=-1;dy<=1&&!dark;dy++)for(let dx=-1;dx<=1;dx++){
      const sx=region.x+x+dx,sy=region.y+y+dy;
      if(sx>=0&&sx<width&&sy>=0&&sy<height&&mask[sy*width+sx]){dark=true;break;}
    }
    if(dark){const i=((y+pad)*w+x+pad)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
  }
  return {rgba,width:w,height:h,pad};
}
