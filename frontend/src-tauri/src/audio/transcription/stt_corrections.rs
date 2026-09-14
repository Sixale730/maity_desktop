//! Diccionario de correcciones de términos STT (empresa + personales).
//!
//! Corrige términos que Parakeet transcribe mal de forma sistemática
//! (ej. "Alien" → "Allianz" cuando la empresa del usuario es cliente de
//! Allianz). Dos fuentes que se combinan:
//!
//! - **Empresa**: pares bajados de Supabase vía la RPC `public.get_stt_terms`
//!   (los administra Maity por SQL). El frontend los empuja con
//!   `set_stt_company_terms` al iniciar sesión y quedan cacheados en el store
//!   para arranques offline.
//! - **Personales**: pares que el usuario captura en Ajustes → Transcripción
//!   (`set_stt_personal_terms`). Ganan sobre los de empresa si la clave
//!   plegada colisiona.
//!
//! Aplicación: `apply()` es el punto único, llamado DESPUÉS de
//! `spanish_postprocess::enhance` en los dos caminos (lote:
//! `batch/transcriber.rs`; streaming: `worker.rs`). El texto corregido queda
//! en SQLite antes del sync → la nube analiza el texto ya corregido.
//!
//! Matching: UNA alternación `\b(?:…)\b` case-insensitive con vocales
//! tolerantes a tildes (`[aá]`…), `\s+` entre palabras y todo lo demás
//! escapado (los términos son datos, nunca sintaxis regex). `ñ` NO se pliega
//! (año/ano). El regex se compila solo al cambiar los términos; el hot path
//! toma únicamente un read-lock.

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SttTerm {
    pub wrong: String,
    pub right: String,
}

const STORE_FILE: &str = "stt_corrections.json";
const COMPANY_KEY: &str = "company";
const PERSONAL_KEY: &str = "personal";
/// Límite duro de pares combinados: acota el tamaño del autómata.
const MAX_TERMS: usize = 500;
/// Longitud máxima de cada lado de un par (espeja el CHECK de la tabla).
const MAX_TERM_LEN: usize = 80;

#[derive(Default)]
struct CompiledCorrections {
    regex: Option<regex::Regex>,
    canon_by_key: HashMap<String, String>,
}

static CORRECTIONS: LazyLock<RwLock<CompiledCorrections>> =
    LazyLock::new(|| RwLock::new(CompiledCorrections::default()));

/// Plegado para clave de lookup: lowercase + tildes de vocal fuera + espacios
/// colapsados. `ñ` se conserva distinta (plegarla colisionaría año/ano).
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_space = true;
    for c in s.trim().chars() {
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
                last_space = true;
            }
            continue;
        }
        last_space = false;
        for lc in c.to_lowercase() {
            out.push(match lc {
                'á' => 'a',
                'é' => 'e',
                'í' => 'i',
                'ó' => 'o',
                'ú' | 'ü' => 'u',
                other => other,
            });
        }
    }
    out.trim_end().to_string()
}

/// Patrón regex para una clave YA plegada: vocal → clase tolerante a tilde,
/// espacio → `\s+`, resto escapado. La case-insensitivity la pone el builder.
fn pattern_for_key(key: &str) -> String {
    let mut pat = String::with_capacity(key.len() * 4);
    for c in key.chars() {
        match c {
            'a' => pat.push_str("[aá]"),
            'e' => pat.push_str("[eé]"),
            'i' => pat.push_str("[ií]"),
            'o' => pat.push_str("[oó]"),
            'u' => pat.push_str("[uúü]"),
            ' ' => pat.push_str(r"\s+"),
            other => pat.push_str(&regex::escape(&other.to_string())),
        }
    }
    pat
}

/// Reemplazo preservando la mayúscula inicial del match (respeta el
/// `capitalize_sentences` previo de `enhance`).
fn replacement_for(matched: &str, canonical: &str) -> String {
    let match_starts_upper = matched.chars().next().is_some_and(|c| c.is_uppercase());
    let canon_starts_lower = canonical.chars().next().is_some_and(|c| c.is_lowercase());
    if match_starts_upper && canon_starts_lower {
        let mut chars = canonical.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().chain(chars).collect(),
            None => canonical.to_string(),
        }
    } else {
        canonical.to_string()
    }
}

fn apply_with(compiled: &CompiledCorrections, text: &str) -> String {
    let Some(regex) = &compiled.regex else {
        return text.to_string();
    };
    regex
        .replace_all(text, |caps: &regex::Captures| {
            let matched = &caps[0];
            match compiled.canon_by_key.get(&fold(matched)) {
                Some(canonical) => replacement_for(matched, canonical),
                // No debería pasar (el regex se construyó desde las claves),
                // pero ante duda el texto original manda.
                None => matched.to_string(),
            }
        })
        .into_owned()
}

/// Compila company + personal en una sola alternación. Personal gana sobre
/// company en colisión de clave plegada. Pares inválidos se descartan con log.
fn compile(company: &[SttTerm], personal: &[SttTerm]) -> CompiledCorrections {
    let mut canon_by_key: HashMap<String, String> = HashMap::new();

    for (source, terms) in [("company", company), ("personal", personal)] {
        for term in terms {
            let key = fold(&term.wrong);
            let canonical = term.right.trim().to_string();
            if key.is_empty() || canonical.is_empty() {
                warn!("[stt_corrections] par vacío descartado ({})", source);
                continue;
            }
            if key.chars().count() > MAX_TERM_LEN || canonical.chars().count() > MAX_TERM_LEN {
                warn!("[stt_corrections] par demasiado largo descartado ({})", source);
                continue;
            }
            if canon_by_key.len() >= MAX_TERMS && !canon_by_key.contains_key(&key) {
                warn!(
                    "[stt_corrections] límite de {} pares alcanzado; el resto se ignora",
                    MAX_TERMS
                );
                break;
            }
            // personal se inserta después → sobreescribe company en colisión.
            canon_by_key.insert(key, canonical);
        }
    }

    // Guard de idempotencia por par: aplicar el par sobre su propio canonical
    // debe ser identidad (si no, cada pasada re-expande: "maity ai" →
    // "maity ai platform" → "maity ai platform platform" …).
    canon_by_key.retain(|key, canonical| {
        let single_pattern = format!(r"\b(?:{})\b", pattern_for_key(key));
        match regex::RegexBuilder::new(&single_pattern)
            .case_insensitive(true)
            .build()
        {
            Ok(re) => {
                let stable = re
                    .replace_all(canonical, |caps: &regex::Captures| {
                        replacement_for(&caps[0], canonical)
                    })
                    .into_owned()
                    == *canonical;
                if !stable {
                    warn!(
                        "[stt_corrections] par no idempotente descartado: '{}' → '{}'",
                        key, canonical
                    );
                }
                stable
            }
            Err(e) => {
                warn!("[stt_corrections] patrón inválido descartado ('{}'): {}", key, e);
                false
            }
        }
    });

    if canon_by_key.is_empty() {
        return CompiledCorrections::default();
    }

    // Alternativas por longitud DESC: el crate regex es leftmost-first, así
    // "modo lote" gana sobre "lote" cuando ambas existen.
    let mut keys: Vec<&String> = canon_by_key.keys().collect();
    keys.sort_by(|a, b| b.chars().count().cmp(&a.chars().count()).then(a.cmp(b)));
    let alternation = keys
        .iter()
        .map(|k| pattern_for_key(k))
        .collect::<Vec<_>>()
        .join("|");
    let full = format!(r"\b(?:{})\b", alternation);

    match regex::RegexBuilder::new(&full)
        .case_insensitive(true)
        .size_limit(4 * 1024 * 1024)
        .build()
    {
        Ok(re) => {
            info!("[stt_corrections] {} pares compilados", canon_by_key.len());
            CompiledCorrections {
                regex: Some(re),
                canon_by_key,
            }
        }
        Err(e) => {
            // Degradar a sin-correcciones, jamás panic: la transcripción
            // sigue funcionando sin diccionario.
            warn!("[stt_corrections] fallo compilando regex combinado: {}", e);
            CompiledCorrections::default()
        }
    }
}

/// PUNTO ÚNICO de aplicación sobre texto ya pasado por `enhance`.
/// Sin términos cargados es passthrough (solo un read-lock).
pub fn apply(text: &str) -> String {
    match CORRECTIONS.read() {
        Ok(compiled) => apply_with(&compiled, text),
        Err(e) => {
            warn!("[stt_corrections] read-lock envenenado: {}", e);
            text.to_string()
        }
    }
}

fn set_compiled(compiled: CompiledCorrections) {
    match CORRECTIONS.write() {
        Ok(mut slot) => *slot = compiled,
        Err(e) => warn!("[stt_corrections] write-lock envenenado: {}", e),
    }
}

fn load_terms<R: Runtime>(app: &AppHandle<R>, key: &str) -> Vec<SttTerm> {
    let Ok(store) = app.store(STORE_FILE) else {
        return Vec::new();
    };
    store
        .get(key)
        .and_then(|v| serde_json::from_value::<Vec<SttTerm>>(v).ok())
        .unwrap_or_default()
}

fn persist_terms<R: Runtime>(app: &AppHandle<R>, key: &str, terms: &[SttTerm]) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to access store: {}", e))?;
    let value = serde_json::to_value(terms).map_err(|e| format!("Failed to serialize: {}", e))?;
    store.set(key, value);
    store
        .save()
        .map_err(|e| format!("Failed to persist store: {}", e))
}

fn recompile_from_store<R: Runtime>(app: &AppHandle<R>) {
    let company = load_terms(app, COMPANY_KEY);
    let personal = load_terms(app, PERSONAL_KEY);
    set_compiled(compile(&company, &personal));
}

/// Carga el cache del store y compila. Llamado desde `setup()` de `lib.rs`
/// (spawn, no bloquea el arranque) para que las sesiones offline y el lote
/// temprano ya corrijan.
pub fn init_from_store<R: Runtime>(app: &AppHandle<R>) {
    recompile_from_store(app);
}

/// Términos de empresa (bajados de la RPC `public.get_stt_terms`). Reemplaza
/// el set completo, lo cachea para offline y recompila.
#[tauri::command]
pub async fn set_stt_company_terms<R: Runtime>(
    app: AppHandle<R>,
    terms: Vec<SttTerm>,
) -> Result<(), String> {
    persist_terms(&app, COMPANY_KEY, &terms)?;
    recompile_from_store(&app);
    Ok(())
}

/// Términos personales del usuario (Ajustes → Transcripción). Reemplaza el
/// array completo (patrón `set_recording_preferences`).
#[tauri::command]
pub async fn set_stt_personal_terms<R: Runtime>(
    app: AppHandle<R>,
    terms: Vec<SttTerm>,
) -> Result<(), String> {
    persist_terms(&app, PERSONAL_KEY, &terms)?;
    recompile_from_store(&app);
    Ok(())
}

#[tauri::command]
pub async fn get_stt_personal_terms<R: Runtime>(app: AppHandle<R>) -> Result<Vec<SttTerm>, String> {
    Ok(load_terms(&app, PERSONAL_KEY))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn term(wrong: &str, right: &str) -> SttTerm {
        SttTerm {
            wrong: wrong.to_string(),
            right: right.to_string(),
        }
    }

    fn apply_terms(company: &[SttTerm], personal: &[SttTerm], text: &str) -> String {
        apply_with(&compile(company, personal), text)
    }

    #[test]
    fn reemplaza_case_insensitive_con_canonical() {
        let c = [term("alien", "Allianz")];
        assert_eq!(apply_terms(&c, &[], "hablamos de alien hoy"), "hablamos de Allianz hoy");
        assert_eq!(apply_terms(&c, &[], "Alien es el cliente"), "Allianz es el cliente");
        assert_eq!(apply_terms(&c, &[], "ALIEN"), "Allianz");
    }

    #[test]
    fn matching_acento_insensible_en_ambas_direcciones() {
        // Término guardado sin tilde matchea texto con tilde y viceversa.
        let c = [term("mexico", "México")];
        assert_eq!(apply_terms(&c, &[], "viajamos a mexico"), "viajamos a México");
        assert_eq!(apply_terms(&c, &[], "viajamos a méxico"), "viajamos a México");
        let c2 = [term("méxico", "México")];
        assert_eq!(apply_terms(&c2, &[], "viajamos a mexico"), "viajamos a México");
    }

    #[test]
    fn respeta_limites_de_palabra() {
        let c = [term("mai", "Maity")];
        assert_eq!(apply_terms(&c, &[], "el maitiano llegó"), "el maitiano llegó");
        assert_eq!(apply_terms(&c, &[], "hablamos con mai ayer"), "hablamos con Maity ayer");
    }

    #[test]
    fn multi_palabra_tolera_espacios_multiples() {
        let c = [term("modo lote", "modo batch")];
        assert_eq!(apply_terms(&c, &[], "usamos modo   lote aquí"), "usamos modo batch aquí");
    }

    #[test]
    fn colision_gana_la_mas_larga() {
        let c = [term("lote", "batch"), term("modo lote", "modo batch")];
        assert_eq!(apply_terms(&c, &[], "el modo lote nuevo"), "el modo batch nuevo");
        assert_eq!(apply_terms(&c, &[], "el lote nuevo"), "el batch nuevo");
    }

    #[test]
    fn personal_sobreescribe_company() {
        let company = [term("guasap", "WhatsApp")];
        let personal = [term("guasap", "Telegram")];
        assert_eq!(apply_terms(&company, &personal, "reunión por guasap"), "reunión por Telegram");
    }

    #[test]
    fn guard_descarta_canonical_que_contiene_al_termino() {
        // "acme" → "Acme Inc": el canonical contiene al término → una segunda
        // pasada daría "Acme Inc Inc". El guard lo descarta completo.
        let c = [term("acme", "Acme Inc")];
        let compiled = compile(&c, &[]);
        assert_eq!(apply_with(&compiled, "reunión con acme"), "reunión con acme");
    }

    #[test]
    fn preserva_mayuscula_inicial_de_oracion() {
        // Canonical en minúscula + match capitalizado por enhance → conserva mayúscula.
        let c = [term("jira", "jira")];
        assert_eq!(apply_terms(&c, &[], "Jira está caído."), "Jira está caído.");
        let c2 = [term("guasap", "whatsapp")];
        assert_eq!(apply_terms(&c2, &[], "Guasap no abre"), "Whatsapp no abre");
    }

    #[test]
    fn idempotente() {
        let c = [term("alien", "Allianz"), term("guasap", "WhatsApp")];
        let compiled = compile(&c, &[]);
        let once = apply_with(&compiled, "alien usa guasap");
        let twice = apply_with(&compiled, &once);
        assert_eq!(once, "Allianz usa WhatsApp");
        assert_eq!(once, twice);
    }

    #[test]
    fn guard_descarta_par_no_idempotente() {
        // "maity ai" → "maity ai platform": re-expandiría en cada pasada.
        let c = [term("maity ai", "maity ai platform"), term("alien", "Allianz")];
        let compiled = compile(&c, &[]);
        assert_eq!(
            apply_with(&compiled, "maity ai es la empresa de alien"),
            "maity ai es la empresa de Allianz"
        );
    }

    #[test]
    fn correccion_de_solo_casing_es_estable() {
        // fold(wrong) == fold(right) pero apply(right) == right → se conserva.
        let c = [term("allianz", "Allianz")];
        assert_eq!(apply_terms(&c, &[], "cliente allianz"), "cliente Allianz");
        assert_eq!(apply_terms(&c, &[], "cliente Allianz"), "cliente Allianz");
    }

    #[test]
    fn enie_no_se_pliega() {
        let c = [term("ano fiscal", "año fiscal")];
        assert_eq!(apply_terms(&c, &[], "el ano fiscal cierra"), "el año fiscal cierra");
        // "año" NO matchea el término "ano": ñ es letra distinta.
        assert_eq!(apply_terms(&c, &[], "el año fiscal cierra"), "el año fiscal cierra");
    }

    #[test]
    fn sin_terminos_es_passthrough() {
        let compiled = compile(&[], &[]);
        assert!(compiled.regex.is_none());
        assert_eq!(apply_with(&compiled, "texto normal"), "texto normal");
    }

    #[test]
    fn pares_invalidos_descartados() {
        let c = [
            term("", "algo"),
            term("algo", ""),
            term("   ", "x"),
            term(&"a".repeat(100), "b"),
        ];
        let compiled = compile(&c, &[]);
        assert!(compiled.regex.is_none());
    }
}
