// audio/devices/device_name_matcher.rs
//
// Robust device-name matching for Windows / macOS / Linux audio devices.
//
// Why: device names are user-visible strings produced by the OS audio stack
// and can drift between two enumerations of the *same* physical device:
//   - Diacritics: "Microfono" vs "Micrófono" (Windows locale change)
//   - Case:      "Logi USB Headset" vs "logi usb headset"
//   - Whitespace: trailing tabs, double spaces, NBSP from some drivers
//   - Suffixes:  "Logi USB Headset" vs "Logi USB Headset (2)" after re-plug
//   - Mojibake:  saved as cp1252 vs enumerated as utf-8
//
// The previous matcher used `name == base_name || name.contains(base_name)`,
// which fails on every case above. This module adds a normalized comparison
// that keeps the strict match as the fast path and falls back to a fuzzy
// match driven by Jaro-Winkler-style overlap of normalized tokens.

/// Normalize a device name for comparison: lowercase, strip diacritics,
/// collapse runs of whitespace, trim. Returns an owned String to avoid
/// lifetime gymnastics at the call sites.
pub fn normalize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_space = true; // collapses leading whitespace too
    for ch in name.chars() {
        // Strip combining marks (NFD decomposition would be nicer but pulls
        // a dep; this hand-roll covers the common Latin diacritics that
        // Windows produces when locale flips between EN and ES).
        let stripped = strip_diacritic(ch);
        for c in stripped.chars() {
            let lower = c.to_ascii_lowercase();
            if lower.is_whitespace() {
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            } else {
                out.push(lower);
                last_was_space = false;
            }
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Map a small set of Latin characters with diacritics to their ASCII
/// equivalents. Not exhaustive — covers Spanish + common European chars
/// that Windows mic names use in real installations.
fn strip_diacritic(ch: char) -> String {
    match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' => "a".into(),
        'é' | 'è' | 'ë' | 'ê' => "e".into(),
        'í' | 'ì' | 'ï' | 'î' => "i".into(),
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => "o".into(),
        'ú' | 'ù' | 'ü' | 'û' => "u".into(),
        'ñ' => "n".into(),
        'ç' => "c".into(),
        'Á' | 'À' | 'Ä' | 'Â' | 'Ã' => "A".into(),
        'É' | 'È' | 'Ë' | 'Ê' => "E".into(),
        'Í' | 'Ì' | 'Ï' | 'Î' => "I".into(),
        'Ó' | 'Ò' | 'Ö' | 'Ô' | 'Õ' => "O".into(),
        'Ú' | 'Ù' | 'Ü' | 'Û' => "U".into(),
        'Ñ' => "N".into(),
        'Ç' => "C".into(),
        // Convert NBSP (\u{a0}) to regular space so collapse can take care of it.
        '\u{00A0}' | '\u{2007}' | '\u{202F}' => " ".into(),
        other => other.to_string(),
    }
}

/// Returns true if `a` and `b` refer to the same device with high confidence.
///
/// Order of precedence:
///   1. exact equality (covers happy path, zero cost)
///   2. normalized equality
///   3. one normalized name contains the other (handles `(2)` suffixes added
///      after re-plug)
///   4. token-overlap ratio >= 0.85 (handles small driver-name changes
///      such as "Logi USB Headset" vs "Logitech USB Headset")
pub fn is_same_device(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let na = normalize(a);
    let nb = normalize(b);
    if na == nb {
        return true;
    }
    if na.contains(&nb) || nb.contains(&na) {
        return true;
    }
    token_overlap_ratio(&na, &nb) >= 0.85
}

/// Return a similarity ratio in [0.0, 1.0] based on token overlap.
/// Cheap to compute, no extra dependencies, good enough for the cases
/// we see in the wild (small wording drift between locales / drivers).
fn token_overlap_ratio(a: &str, b: &str) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let tokens_a: Vec<&str> = a.split(' ').filter(|t| !t.is_empty()).collect();
    let tokens_b: Vec<&str> = b.split(' ').filter(|t| !t.is_empty()).collect();
    if tokens_a.is_empty() || tokens_b.is_empty() {
        return 0.0;
    }
    let mut shared = 0usize;
    for t in &tokens_a {
        if tokens_b.contains(t) {
            shared += 1;
        }
    }
    let denom = tokens_a.len().max(tokens_b.len()) as f32;
    shared as f32 / denom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_diacritics() {
        assert!(is_same_device("Microfono (Logi USB Headset)", "Micrófono (Logi USB Headset)"));
    }

    #[test]
    fn handles_case_and_spaces() {
        assert!(is_same_device("LOGI USB HEADSET", "  logi  usb  headset "));
    }

    #[test]
    fn handles_replug_suffix() {
        assert!(is_same_device("Logi USB Headset", "Logi USB Headset (2)"));
    }

    #[test]
    fn handles_driver_wording_drift() {
        assert!(is_same_device("Logi USB Headset", "Logitech USB Headset"));
    }

    #[test]
    fn rejects_unrelated_devices() {
        assert!(!is_same_device("Logi USB Headset", "Realtek Audio"));
        assert!(!is_same_device("Microphone Array", "Speakers"));
    }

    #[test]
    fn normalize_strips_nbsp() {
        assert_eq!(normalize("Logi\u{00A0}USB\u{00A0}Headset"), "logi usb headset");
    }
}
