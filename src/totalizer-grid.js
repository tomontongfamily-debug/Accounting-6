// Read the eight physical LCD cells around the visible decimal point. The
// search estimates camera angle, cell spacing and italic stroke alignment from
// the photo. It never receives an opening reading or expected answer.
const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'].map(p=>[...p].map(Number));
const positions=[[.5,.06],[.85,.25],[.85,.75],[.5,.94],[.15,.75],[.15,.25],[.5,.5]];
const horizontal=[true,false,false,true,false,false,true];
const range=(a,b,n)=>Array.from({length:n},(_,i)=>a+(b-a)*i/(n-1));

function horizontalBars(mask,width,region){
  const {x,y,width:w,height:h,bandHeight}=region,min=Math.max(3,Math.round(bandHeight*.18));
  const lineMask=new Uint8Array(w*h);
  for(let row=0;row<h;row++){
    let start=-1;
    for(let col=0;col<=w;col++){
      if(col<w&&mask[(y+row)*width+x+col]){if(start<0)start=col;}
      else if(start>=0){if(col-start>=min)lineMask.fill(1,row*w+start,row*w+col);start=-1;}
    }
  }
  const seen=new Uint8Array(lineMask.length),queue=new Int32Array(lineMask.length),out=[];
  for(let i=0;i<lineMask.length;i++){
    if(!lineMask[i]||seen[i])continue;
    let n=1,head=0,x0=i%w,x1=x0,y0=Math.floor(i/w),y1=y0;queue[0]=i;seen[i]=1;
    while(head<n){const k=queue[head++],cx=k%w,cy=Math.floor(k/w);x0=Math.min(x0,cx);x1=Math.max(x1,cx);y0=Math.min(y0,cy);y1=Math.max(y1,cy);
      for(const j of[cx>0?k-1:-1,cx<w-1?k+1:-1,cy>0?k-w:-1,cy<h-1?k+w:-1])if(j>=0&&!seen[j]&&lineMask[j]){seen[j]=1;queue[n++]=j;}
    }
    out.push({x:x+x0,y:y+y0,width:x1-x0+1,height:y1-y0+1});
  }
  return out;
}

function barAlignment(bars,dot,h){
  const dotx=dot.x+dot.width/2,doty=dot.y+dot.height;
  let best;
  for(const height of range(.75*h,1.12*h,20))for(const slope of range(-.2,.2,41))for(const offset of range(-.06*h,.06*h,5)){
    let error=0;
    for(const bar of bars){
      const relative=(bar.y+bar.height/2-doty-offset-slope*(bar.x+bar.width/2-dotx))/height;
      const distance=Math.min(.2,Math.abs(relative+.94),Math.abs(relative+.5),Math.abs(relative+.06));
      error+=distance*distance;
    }
    if(!best||error<best.error)best={error,height,slope,base:doty+offset};
  }
  // Top and bottom rows converge in an oblique photograph. Fit their separate
  // slopes instead of requiring every cell to have exactly the same height.
  if(bars.length>=6){
    let model={...best,heightSlope:0};
    for(let pass=0;pass<3;pass++){
      const normal=Array.from({length:4},()=>new Float64Array(5));
      let used=0;
      for(const bar of bars){
        const dx=bar.x+bar.width/2-dotx,dy=bar.y+bar.height/2;
        const relative=(dy-model.base-model.slope*dx)/(model.height+model.heightSlope*dx);
        const phase=[-.94,-.5,-.06].sort((a,b)=>Math.abs(a-relative)-Math.abs(b-relative))[0];
        if(Math.abs(phase-relative)>.12)continue;
        const f=[1,dx,phase,phase*dx];used++;
        for(let i=0;i<4;i++){for(let j=0;j<4;j++)normal[i][j]+=f[i]*f[j];normal[i][4]+=f[i]*dy;}
      }
      if(used<6)break;
      let valid=true;
      for(let col=0;col<4;col++){
        let pivot=col;for(let i=col+1;i<4;i++)if(Math.abs(normal[i][col])>Math.abs(normal[pivot][col]))pivot=i;
        [normal[col],normal[pivot]]=[normal[pivot],normal[col]];
        const scale=normal[col][col];if(Math.abs(scale)<1e-8){valid=false;break;}
        for(let j=col;j<5;j++)normal[col][j]/=scale;
        for(let i=0;i<4;i++)if(i!==col){const factor=normal[i][col];for(let j=col;j<5;j++)normal[i][j]-=factor*normal[col][j];}
      }
      if(!valid)break;
      const [base,slope,height,heightSlope]=normal.map(row=>row[4]);
      if(Math.abs(base-doty)>h*.12||height<h*.65||height>h*1.2||Math.abs(heightSlope)>.1)break;
      model={base,slope,height,heightSlope};
    }
    if(model.heightSlope)best.perspective=model;
  }
  return best;
}

function integralMask(mask,width,height){
  const stride=width+1,integral=new Uint32Array(stride*(height+1));
  for(let y=0;y<height;y++){let sum=0;for(let x=0;x<width;x++){sum+=mask[y*width+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum;}}
  return integral;
}

function occupancy(integral,width,height,x,y,dx,dy){
  const x0=Math.max(0,Math.min(width-1,Math.round(x-dx))),x1=Math.max(1,Math.min(width,Math.round(x+dx)+1));
  const y0=Math.max(0,Math.min(height-1,Math.round(y-dy))),y1=Math.max(1,Math.min(height,Math.round(y+dy)+1)),s=width+1;
  return (integral[y1*s+x1]-integral[y0*s+x1]-integral[y1*s+x0]+integral[y0*s+x0])/Math.max(1,(x1-x0)*(y1-y0));
}

function classify(coverage){
  let sum=0,worst=0,margin=Infinity,text='';const digitMargins=[];
  for(let cell=0;cell<8;cell++){
    let first=Infinity,second=Infinity,digit=-1;
    for(let d=0;d<10;d++){
      let cost=0;
      for(let s=0;s<7;s++)cost+=(coverage[cell*7+s]-patterns[d][s])**2;
      cost/=7;
      if(cost<first){second=first;first=cost;digit=d;}else if(cost<second)second=cost;
    }
    sum+=first;worst=Math.max(worst,first);margin=Math.min(margin,second-first);digitMargins.push(second-first);text+=digit;
  }
  return {text,value:Number(text)/100,score:sum/8+worst*.5,margin,digitMargins};
}

function sampleLayout(integral,width,height,layout,refine=false){
  const {left,glyphWidth:w,pitch,height:h,slope,base,shear,dotx,heightSlope=0,curve=0}=layout,coverage=new Float32Array(56);
  for(let cell=0;cell<8;cell++){
    const j=cell-5,cellx=left+j*pitch+j*j*curve*h,cellHeight=h+heightSlope*(cellx+w*.5-dotx),cellWidth=w*cellHeight/h;
    for(let s=0;s<7;s++){
      const [u,v]=positions[s],x=cellx+u*cellWidth+(1-v)*shear*cellHeight,y=base+slope*(cellx+w*.5-dotx)+(v-1)*cellHeight;
      const dx=(horizontal[s] ? .10 : .055)*cellWidth,dy=(horizontal[s] ? .022 : .06)*cellHeight;
      let value=occupancy(integral,width,height,x,y,dx,dy);
      if(refine)for(const ox of[-.08,0,.08])for(const oy of[-.025,0,.025])value=Math.max(value,occupancy(integral,width,height,x+ox*cellWidth,y+oy*cellHeight,dx,dy));
      coverage[cell*7+s]=value;
    }
  }
  return coverage;
}

export function readTotalizerGrid(mask,width,height,regions,components){
  const integral=integralMask(mask,width,height),candidates=[];
  for(const original of regions.slice(0,3)){
    const ratio=original.width/original.bandHeight;
    const region=ratio<4.5?{...original,bandHeight:original.width/6.5}:original;
    const h=region.bandHeight;
    const points=components.filter(c=>c.width>=Math.max(2,h*.035)&&c.height>=Math.max(2,h*.035)&&c.width<h*.2&&c.height<h*.2&&c.width/c.height>.45&&c.width/c.height<1.25&&c.area/(c.width*c.height)>.55&&c.y>region.y+h*.6&&c.y<region.y+region.height&&c.x>region.x+h*2&&c.x<region.x+region.width-h*.4);
    const isBar=c=>c.width>h*.2&&c.width<h*.9&&c.height>h*.025&&c.height<h*.22&&c.width/c.height>2&&c.x>region.x&&c.x<region.x+region.width&&c.y>region.y&&c.y<region.y+region.height;
    let bars=components.filter(isBar);
    if(bars.length<4)bars=horizontalBars(mask,width,region).filter(isBar);
    if(bars.length<4)continue;
    for(const dot of points){
      const alignment=barAlignment(bars,dot,h),dotx=dot.x+dot.width/2,hh=alignment.height,layouts=[];
      for(const pitch of range(.55*hh,.88*hh,23))for(const glyphWidth of range(.43*hh,.72*hh,12))for(const gap of range(-.02*hh,.14*hh,7)){
        const left=dotx-gap-glyphWidth;
        if(left-5*pitch<region.x-h*.15||left+2*pitch+glyphWidth>Math.min(width,region.x+region.width+h*.1))continue;
        for(const shear of range(-.05,.25,7)){
          const layout={...alignment,left,glyphWidth,pitch,shear,dotx};
          const result=classify(sampleLayout(integral,width,height,layout));
          layouts.push({layout,result});
        }
      }
      layouts.sort((a,b)=>a.result.score-b.result.score);
      const refined=[];
      for(const {layout}of layouts.slice(0,400)){
        refined.push({layout,...classify(sampleLayout(integral,width,height,layout,true))});
        if(alignment.perspective)for(const curve of[-.005,0,.005]){
          const adjusted={...layout,...alignment.perspective,curve};
          refined.push({layout:adjusted,...classify(sampleLayout(integral,width,height,adjusted,true))});
        }
      }
      refined.sort((a,b)=>a.score-b.score);
      candidates.push(...refined.slice(0,3));
    }
  }
  return candidates.sort((a,b)=>a.score-b.score).slice(0,5);
}
