// Exact SIMD probe from the pinned onnxruntime-web@1.31.1:
// lib/wasm/wasm-factory.ts:isSimdSupported. It validates i32x4.dot_i16x8_s,
// not merely the presence of WebAssembly or a browser/user-agent name.
// The shipped runtime requires SIMD:
// https://onnxruntime.ai/docs/tutorials/web/deploy.html#webassembly-binaries
const SIMD_PROBE=new Uint8Array([
  0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,30,1,28,0,65,0,253,15,253,12,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,253,186,1,26,11,
]);

export function supportsNeuralTotalizer(wasm=globalThis.WebAssembly){
  try{return typeof wasm?.validate==='function'&&wasm.validate(SIMD_PROBE)===true;}
  catch{return false;}
}
export function assertNeuralTotalizerSupport(){
  if(!supportsNeuralTotalizer())throw Object.assign(new Error('This browser does not support the advanced automatic reader.'),{reason:'unsupported-browser'});
}
