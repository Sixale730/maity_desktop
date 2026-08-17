//! Manifiesto pinneado de los modelos Parakeet descargables.
//!
//! Digests obtenidos del API de HuggingFace (`/api/models/<repo>/tree/main` →
//! `lfs.oid`) el 2026-08-17 y pinneados al commit vigente de cada repo. El pin a
//! commit convierte la URL en contenido inmutable (mismo principio que un
//! lockfile): `resolve/main` es una ref móvil que puede cambiar de bytes bajo
//! los pies, `resolve/<sha>` siempre sirve exactamente lo que este manifiesto
//! hasheó. Los `vocab.txt` no son LFS; su SHA-256 se calculó localmente sobre
//! el archivo bajado del commit pinneado.
//!
//! Para actualizar el modelo: cambiar el commit del `base_url` Y regenerar los
//! digests desde el API de HF en el mismo cambio — nunca uno sin el otro.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

/// Un archivo del modelo: nombre, tamaño EXACTO en bytes y SHA-256 (hex).
pub struct FileSpec {
    pub name: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// Manifiesto de un modelo: URL base pinneada a commit + archivos con digest.
pub struct ModelManifest {
    /// Termina en `resolve/<commit-sha>` — jamás `resolve/main`.
    pub base_url: &'static str,
    pub files: &'static [FileSpec],
}

/// parakeet-tdt-0.6b-v3-int8 (istupakov/parakeet-tdt-0.6b-v3-onnx)
pub static V3_INT8: ModelManifest = ModelManifest {
    base_url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce",
    files: &[
        FileSpec {
            name: "encoder-model.int8.onnx",
            size: 652_183_999,
            sha256: "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09",
        },
        FileSpec {
            name: "decoder_joint-model.int8.onnx",
            size: 18_202_004,
            sha256: "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70",
        },
        FileSpec {
            name: "nemo128.onnx",
            size: 139_764,
            sha256: "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f",
        },
        FileSpec {
            name: "vocab.txt",
            size: 93_939,
            sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
        },
    ],
};

/// parakeet-tdt-0.6b-v2-int8 (istupakov/parakeet-tdt-0.6b-v2-onnx)
pub static V2_INT8: ModelManifest = ModelManifest {
    base_url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx/resolve/0bbb45a3365852604aef28b538a8f066f4ccaa85",
    files: &[
        FileSpec {
            name: "encoder-model.int8.onnx",
            size: 652_184_014,
            sha256: "3e0581fda6ab843888b51e56d7ee78b6d5bc3237ec113af1f732d1d5286aa155",
        },
        FileSpec {
            name: "decoder_joint-model.int8.onnx",
            size: 8_998_286,
            sha256: "a449f49acd68979d418651dd2dcb737cc0f1bf0225e009e29ee326354edbf7d3",
        },
        FileSpec {
            name: "nemo128.onnx",
            size: 139_764,
            sha256: "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f",
        },
        FileSpec {
            name: "vocab.txt",
            size: 9_384,
            sha256: "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d",
        },
    ],
};

/// Manifiesto para un nombre de modelo del registry. Mismo mapeo que usaba el
/// `base_url` histórico: `-v2-` → v2, todo lo demás → v3 (el default).
pub fn manifest_for(model_name: &str) -> &'static ModelManifest {
    if model_name.contains("-v2-") {
        &V2_INT8
    } else {
        &V3_INT8
    }
}

/// Lee el archivo en chunks de 1 MB y compara su SHA-256 con `expected` (hex).
/// I/O síncrono a propósito: llamarla vía `spawn_blocking` desde código async
/// (el encoder son 652 MB; hashearlo toma segundos).
pub fn verify_file_sha256(path: &Path, expected: &str) -> std::io::Result<bool> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();
    Ok(actual.eq_ignore_ascii_case(expected))
}

/// Backoff exponencial con jitter: 2^intento segundos (tope 8 s) + 0..1 s
/// uniforme. Con 4 intentos la espera total queda acotada en ~17 s.
pub fn backoff_delay(attempt: u32) -> Duration {
    use rand::Rng;
    let base_secs = 2u64.saturating_pow(attempt).min(8);
    let jitter_ms: u64 = rand::thread_rng().gen_range(0..1000);
    Duration::from_secs(base_secs) + Duration::from_millis(jitter_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_acepta_archivo_correcto_y_rechaza_un_byte_mutado() {
        // sha256("abc"), vector de prueba estándar de FIPS 180
        let expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let path = std::env::temp_dir().join(format!(
            "maity-manifest-test-{}.bin",
            std::process::id()
        ));
        std::fs::write(&path, b"abc").unwrap();
        assert!(verify_file_sha256(&path, expected).unwrap());
        // Case-insensitive (los hex de HF vienen en minúsculas, pero no depender de eso)
        assert!(verify_file_sha256(&path, &expected.to_uppercase()).unwrap());

        std::fs::write(&path, b"abd").unwrap();
        assert!(!verify_file_sha256(&path, expected).unwrap());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn backoff_crece_con_tope_y_tiene_jitter() {
        for attempt in 1..=3u32 {
            let base = 2u64.saturating_pow(attempt).min(8);
            let d = backoff_delay(attempt);
            assert!(d >= Duration::from_secs(base), "intento {} por debajo de la base", attempt);
            assert!(d < Duration::from_secs(base + 1), "intento {} excede base + jitter", attempt);
        }
        // Tope: intentos altos no crecen más allá de 8 s + jitter
        assert!(backoff_delay(10) < Duration::from_secs(9));
        // Jitter: 20 muestras del mismo intento no pueden ser todas idénticas
        let samples: std::collections::HashSet<u128> =
            (0..20).map(|_| backoff_delay(1).as_millis()).collect();
        assert!(samples.len() > 1, "el backoff no tiene jitter");
    }

    #[test]
    fn manifiesto_completo_y_pinneado_a_commit() {
        for (label, manifest) in [("v3", &V3_INT8), ("v2", &V2_INT8)] {
            let commit = manifest.base_url.rsplit('/').next().unwrap();
            assert_ne!(commit, "main", "{}: base_url debe pinnear a commit", label);
            assert_eq!(commit.len(), 40, "{}: el pin no es un SHA de git", label);
            assert!(commit.chars().all(|c| c.is_ascii_hexdigit()), "{}", label);

            assert_eq!(manifest.files.len(), 4, "{}", label);
            for spec in manifest.files {
                assert!(spec.size > 0, "{}: {} sin tamaño", label, spec.name);
                assert_eq!(spec.sha256.len(), 64, "{}: {} sin sha256 completo", label, spec.name);
                assert!(
                    spec.sha256.chars().all(|c| c.is_ascii_hexdigit()),
                    "{}: {} con sha256 no-hex",
                    label,
                    spec.name
                );
            }
        }
    }

    #[test]
    fn manifest_for_mapea_los_dos_modelos_del_registry() {
        assert!(std::ptr::eq(manifest_for("parakeet-tdt-0.6b-v3-int8"), &V3_INT8));
        assert!(std::ptr::eq(manifest_for("parakeet-tdt-0.6b-v2-int8"), &V2_INT8));
    }
}
