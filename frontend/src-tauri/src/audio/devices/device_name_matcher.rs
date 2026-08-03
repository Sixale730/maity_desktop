// Robust device-name matching for Windows audio devices.
//
// The raw WASAPI enumeration produces strings that drift between sessions
// for the *same* physical device:
//
//   - Diacritics flip with the Windows locale: "Microfono" vs "Microfono".
//   - Case varies by driver: "LOGI USB Headset" vs "Logi USB Headset".
//   - Some drivers insert NBSP (U+00A0) or other Unicode spaces.
//   - After an USB re-plug the name can gain a "(2)" suffix.
//   - A driver update can rename "Logi USB Headset" to "Logitech USB Headset".
//
// Exact string comparison (`a == b` or `a.contains(b)`) misses every case
// above and forces a silent fallback to the system default mic. This module
// is the normalization + fuzzy-match layer used by `windows.rs` and
// `recording_helpers.rs` to avoid that silent failure.

const TOKEN_OVERLAP_MATCH_THRESHOLD: f32 = 0.8;
const MIN_PREFIX_TOKEN_LEN: usize = 4;

/// Normalize a device name so two strings referring to the same physical
/// device compare equal. Lowercase, strip Latin diacritics, fold Unicode
/// spaces into regular spaces, drop any trailing `(N)` re-plug suffix,
/// collapse whitespace, trim.
pub fn normalize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_space = true;
    for ch in name.chars() {
        let folded = fold_char(ch);
        for c in folded.chars() {
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
    while out.ends_with(' ') {
        out.pop();
    }
    strip_replug_suffix(&strip_bt_index(&out))
}

/// Remove the Windows Bluetooth enumeration index that appears *inside* the
/// parenthesized part of the name: `"microfono (2- auriculares bt)"` →
/// `"microfono (auriculares bt)"`. Windows bumps that index on every BT
/// re-pair, so the same headset compares unequal across sessions otherwise.
/// Only the parenthesized form is handled; a bare leading `"2- ..."` (no
/// parens) is left untouched — it is indistinguishable from a real name.
fn strip_bt_index(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        out.push(c);
        if c == '(' {
            let rest = &s[i + 1..];
            let digits = rest.chars().take_while(|c| c.is_ascii_digit()).count();
            // digits, '-' and ' ' are single-byte, so char counts == byte offsets
            if digits > 0 && rest[digits..].starts_with('-') {
                let mut skip = digits + 1;
                skip += rest[skip..].chars().take_while(|c| *c == ' ').count();
                for _ in 0..skip {
                    chars.next();
                }
            }
        }
    }
    out
}

/// Map a single char to its ASCII/fold equivalent. Hand-rolled (no new deps)
/// and intentionally scoped to the Latin chars Windows actually produces in
/// mic names for Spanish / European locales. Unicode spaces are folded to
/// regular space so the whitespace collapse in `normalize` handles them.
fn fold_char(ch: char) -> String {
    match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => "a".into(),
        'é' | 'è' | 'ë' | 'ê' => "e".into(),
        'í' | 'ì' | 'ï' | 'î' => "i".into(),
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => "o".into(),
        'ú' | 'ù' | 'ü' | 'û' => "u".into(),
        'ñ' => "n".into(),
        'ç' => "c".into(),
        'Á' | 'À' | 'Ä' | 'Â' | 'Ã' | 'Å' => "A".into(),
        'É' | 'È' | 'Ë' | 'Ê' => "E".into(),
        'Í' | 'Ì' | 'Ï' | 'Î' => "I".into(),
        'Ó' | 'Ò' | 'Ö' | 'Ô' | 'Õ' => "O".into(),
        'Ú' | 'Ù' | 'Ü' | 'Û' => "U".into(),
        'Ñ' => "N".into(),
        'Ç' => "C".into(),
        '\u{00A0}' | '\u{2007}' | '\u{202F}' | '\u{2009}' | '\u{200A}' => " ".into(),
        other => other.to_string(),
    }
}

/// Remove a trailing `(N)` / `(N )` re-plug suffix. Runs after case/diacritic
/// folding so it can work on the already-lowercased string.
fn strip_replug_suffix(s: &str) -> String {
    let trimmed = s.trim_end();
    if !trimmed.ends_with(')') {
        return trimmed.to_string();
    }
    let Some(open_idx) = trimmed.rfind('(') else {
        return trimmed.to_string();
    };
    let inside = &trimmed[open_idx + 1..trimmed.len() - 1];
    if !inside.trim().chars().all(|c| c.is_ascii_digit()) {
        return trimmed.to_string();
    }
    trimmed[..open_idx].trim_end().to_string()
}

/// Compare two device names with increasing leniency. Returns true when
/// they refer to the same physical device with high confidence.
///
/// Order of checks (early-return each):
///   1. Byte-equal (zero-cost happy path)
///   2. Normalized equal
///   3. Normalized substring either way (driver adds a prefix/suffix)
///   4. Token-overlap ratio ≥ `TOKEN_OVERLAP_MATCH_THRESHOLD`, where tokens
///      count as shared if they match exactly *or* one is a prefix of the
///      other with both ≥ `MIN_PREFIX_TOKEN_LEN` chars — this is what lets
///      "Logi" match "Logitech" across a driver rename.
pub fn is_same_device(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let na = normalize(a);
    let nb = normalize(b);
    if na.is_empty() || nb.is_empty() {
        return false;
    }
    if na == nb {
        return true;
    }
    if na.contains(&nb) || nb.contains(&na) {
        return true;
    }
    token_overlap_ratio(&na, &nb) >= TOKEN_OVERLAP_MATCH_THRESHOLD
}

/// Token-overlap similarity in [0.0, 1.0].
///
/// `shared = |{ t in tokens(a) : exists u in tokens(b) with t ≡ u }|`
/// where `t ≡ u` iff `t == u` or one is a prefix of the other with both
/// lengths ≥ `MIN_PREFIX_TOKEN_LEN`. The min-length guard prevents tiny
/// tokens like "a" or "of" from matching anything that starts with them.
fn token_overlap_ratio(a: &str, b: &str) -> f32 {
    let tokens_a: Vec<&str> = a.split(' ').filter(|t| !t.is_empty()).collect();
    let tokens_b: Vec<&str> = b.split(' ').filter(|t| !t.is_empty()).collect();
    if tokens_a.is_empty() || tokens_b.is_empty() {
        return 0.0;
    }
    let mut shared = 0usize;
    for t in &tokens_a {
        if tokens_b.iter().any(|u| tokens_match(t, u)) {
            shared += 1;
        }
    }
    let denom = tokens_a.len().max(tokens_b.len()) as f32;
    shared as f32 / denom
}

fn tokens_match(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    if a.len() < MIN_PREFIX_TOKEN_LEN || b.len() < MIN_PREFIX_TOKEN_LEN {
        return false;
    }
    a.starts_with(b) || b.starts_with(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_diacritics() {
        assert!(is_same_device(
            "Microfono (Logi USB Headset)",
            "Micrófono (Logi USB Headset)",
        ));
    }

    #[test]
    fn handles_case_and_spaces() {
        assert!(is_same_device(
            "LOGI USB HEADSET",
            "  logi  usb  headset ",
        ));
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
    fn handles_windows_bt_index() {
        // Windows bumps the BT index on re-pair: "(2- ...)" → "(3- ...)"
        assert!(is_same_device(
            "Micrófono (2- Auriculares BT)",
            "Micrófono (3- Auriculares BT)",
        ));
        // And against the index-less form some drivers report
        assert!(is_same_device(
            "Micrófono (Auriculares BT)",
            "Micrófono (2- Auriculares BT)",
        ));
    }

    #[test]
    fn bt_index_strip_is_scoped() {
        // Bare leading index (no parens) is NOT stripped — different names stay different
        assert_eq!(normalize("2- Auriculares BT"), "2- auriculares bt");
        // Model numbers with a dash but non-digit prefix are untouched
        assert_eq!(normalize("Headset (WH-1000XM4)"), "headset (wh-1000xm4)");
    }

    #[test]
    fn normalize_strips_nbsp() {
        assert_eq!(
            normalize("Logi\u{00A0}USB\u{00A0}Headset"),
            "logi usb headset",
        );
    }
}
