# Silero (copia vendorizada para Maity Desktop)

Rust implementation of [Silero VAD](https://github.com/snakers4/silero-vad).

Origen: <https://github.com/emotechlab/silero-rs> @ `1283485dfd4ce6fda25248d52f6f68e27418d46c`
(rama `main`, 2026-07-23). Copiada como *path dependency* porque Maity necesita un parche
que el upstream no tiene: `take_until()` en plena habla dejaba el `start_ms` del estado
`VadState::Speech` apuntando a audio ya borrado y el siguiente `SpeechEnd` hacía `panic`.
La lista completa de parches locales está en la cabecera de `src/lib.rs`.

El modelo `silero_vad.onnx` vive en la raíz del crate (y no en `models/`) porque el
`.gitignore` del repo ignora `**/models/*.onnx`.

## License

This code is licensed under the terms of the MIT License. See LICENSE for more
details. The bundled `silero_vad.onnx` model is MIT licensed by
[snakers4/silero-vad](https://github.com/snakers4/silero-vad).
