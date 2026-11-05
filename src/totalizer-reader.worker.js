import { readTotalizerGrid } from './totalizer-grid.js';

// Reuse one worker for the fallback readers. Geometry, tensor preparation and
// model inference must not block camera controls, uploads or screen updates.
globalThis.onmessage=async({data:{id,operation,args}})=>{
  try{
    let result;
    if(operation==='grid')result=readTotalizerGrid(...args);
    else{
      const neural=await import('./totalizer-neural.js');
      if(operation==='prepare'){await neural.prepareNeuralTotalizer(args[0]);result=true;}
      else if(operation==='neural')result=await neural.neuralTotalizerCandidates(...args);
      else throw Error('Unknown reader operation.');
    }
    globalThis.postMessage({id,result});
  }catch{globalThis.postMessage({id,error:true});}
};
