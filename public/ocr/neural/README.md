# Local pump-photo recognition model

`english-mobile.onnx` is the English PP-OCRv5 mobile recognition model from
PaddleOCR, converted to ONNX and distributed by RapidAI/RapidOCR v3.10.0.
The weights are unmodified. `characters.json` contains the vocabulary extracted
from its ONNX `character` metadata, with the CTC blank and space tokens.

- Source: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
- Conversion/distribution: https://github.com/RapidAI/RapidOCR
- Weights SHA-256: `c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8`
- Licenses: Apache-2.0; see `PADDLE-LICENSE` and `LICENSE`.

Inference runs in the station browser using ONNX Runtime Web 1.31.1 (MIT,
license beside its WebAssembly files). No photograph is uploaded to an external
recognition provider and no provider API key is needed. The neural result is
corroborated by the existing seven-segment reader or an image-derived physical
cell fit. Recognition receives no opening reading or known answer.

The character decoder retains per-digit certainty. A high average must not hide
an uncertain integer digit, and an extra ninth digit is not truncated. Several
resolutions of one neural model count as one recognition method. Unresolved
photos require a closer capture without reflections; manual transcription is
an explicit cashier override. Existing accounting confirmation remains required.
