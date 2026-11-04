// Bump this prefix whenever an OCR worker, model, dictionary or runtime changes.
// Versioned URLs can stay in the phone's HTTP cache without serving old models.
export const OCR_ASSET_VERSION='lcd-neural-3-20261104';
export const OCR_ASSET_ROOT=`/ocr/${OCR_ASSET_VERSION}`;
export const ocrAsset=path=>`${OCR_ASSET_ROOT}/${path}`;
