import {totalizerRegions} from '../src/totalizer-image.js';

export function gridFixture(){
 const width=900,height=500,gray=new Uint8Array(width*height).fill(190);
 const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
 const boxes=[[8,8,20,10],[32,12,7,30],[32,55,7,30],[8,80,20,10],[1,55,7,30],[1,12,7,30],[8,44,20,10]];
 function fill(x,y,w,h){for(let row=y;row<y+h;row++)gray.fill(30,row*width+x,row*width+x+w);}
 for(const [cell,digit]of [...'23456789'].entries())for(const [i,on]of [...patterns[Number(digit)]].entries()){
  if(on==='1'){const[x,y,w,h]=boxes[i];fill(100+cell*60+x,200+y,w,h);}
 }
 fill(100+5*60+47,282,8,8);
 const {mask,regions,components}=totalizerRegions(gray,width,height);
 return [mask,width,height,regions,components];
}
