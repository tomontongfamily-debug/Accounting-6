import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { OCR_ASSET_ROOT } from "./src/ocr-assets.js";

// Match the production static rewrite in local development and browser tests.
function versionedOcrAssets(){
  const install=server=>{server.middlewares.use((req,res,next)=>{
    if(req.url?.startsWith(OCR_ASSET_ROOT+'/')){
      req.url='/ocr'+req.url.slice(OCR_ASSET_ROOT.length);
      res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    }
    next();
  });};
  return {name:'versioned-ocr-assets',configureServer:install,configurePreviewServer:install};
}

export default defineConfig({
  plugins: [versionedOcrAssets(),react()],
  build: {rollupOptions: {input: {main:'index.html',phoneOcrCheck:'ocr-phone-check.html',captureSaveCheck:'capture-save-check.html'}}},
});
