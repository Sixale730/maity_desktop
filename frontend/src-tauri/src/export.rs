use log::{error as log_error, info as log_info};
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use printpdf::*;
use std::io::BufWriter;

use crate::{
    api::api::MeetingTranscript,
    database::repositories::meeting::MeetingsRepository,
    state::AppState,
    validation_helpers,
};

/// Export transcript data structure for serialization
#[derive(Debug, Serialize, Clone)]
pub struct ExportTranscript {
    pub timestamp: String,
    pub speaker: String, // "Usuario" | "Interlocutor" | "Desconocido"
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end: Option<f64>,
}

/// Format MeetingTranscript to ExportTranscript with human-readable speaker names
fn format_transcript_for_export(transcript: &MeetingTranscript) -> ExportTranscript {
    let speaker = match transcript.source_type.as_deref() {
        Some("user") => "Usuario".to_string(),
        Some("interlocutor") => "Interlocutor".to_string(),
        _ => "Desconocido".to_string(),
    };

    ExportTranscript {
        timestamp: transcript.timestamp.clone(),
        speaker,
        text: transcript.text.clone(),
        audio_start: transcript.audio_start_time,
        audio_end: transcript.audio_end_time,
    }
}

/// Export meeting as JSON format with pretty printing
pub fn export_as_json(
    title: &str,
    created_at: &str,
    transcripts: &[MeetingTranscript],
) -> Result<String, String> {
    let export_transcripts: Vec<ExportTranscript> = transcripts
        .iter()
        .map(format_transcript_for_export)
        .collect();

    let json_object = serde_json::json!({
        "metadata": {
            "title": title,
            "created_at": created_at,
            "transcript_count": export_transcripts.len(),
            "export_format": "json"
        },
        "transcripts": export_transcripts
    });

    serde_json::to_string_pretty(&json_object)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))
}

/// Export meeting as CSV format
/// Format: timestamp,speaker,text,audio_start,audio_end
pub fn export_as_csv(
    title: &str,
    created_at: &str,
    transcripts: &[MeetingTranscript],
) -> Result<String, String> {
    let mut csv_output = String::new();

    // Header with metadata
    csv_output.push_str(&format!("# Meeting: {}\n", title));
    csv_output.push_str(&format!("# Created: {}\n", created_at));
    csv_output.push_str(&format!("# Total Transcripts: {}\n", transcripts.len()));
    csv_output.push('\n');

    // CSV header
    csv_output.push_str("Timestamp,Speaker,Text,Audio Start (s),Audio End (s)\n");

    // CSV rows
    for transcript in transcripts {
        let exported = format_transcript_for_export(transcript);

        // Escape CSV fields
        let text_escaped = escape_csv_field(&exported.text);
        let timestamp_escaped = escape_csv_field(&exported.timestamp);
        let speaker_escaped = escape_csv_field(&exported.speaker);

        let audio_start_str = exported
            .audio_start
            .map(|v| v.to_string())
            .unwrap_or_else(|| String::new());
        let audio_end_str = exported
            .audio_end
            .map(|v| v.to_string())
            .unwrap_or_else(|| String::new());

        csv_output.push_str(&format!(
            "{},{},{},{},{}\n",
            timestamp_escaped, speaker_escaped, text_escaped, audio_start_str, audio_end_str
        ));
    }

    Ok(csv_output)
}

/// Export meeting as Markdown format
pub fn export_as_markdown(
    title: &str,
    created_at: &str,
    transcripts: &[MeetingTranscript],
) -> Result<String, String> {
    let mut markdown = String::new();

    // Header
    markdown.push_str(&format!("# {}\n\n", title));
    markdown.push_str(&format!("**Fecha:** {}\n", created_at));
    markdown.push_str(&format!("**Total de transcripciones:** {}\n\n", transcripts.len()));
    markdown.push_str("---\n\n");

    // Transcripts grouped by speaker for better readability
    for transcript in transcripts {
        let exported = format_transcript_for_export(transcript);

        markdown.push_str(&format!("**{}** *({})*\n", exported.speaker, exported.timestamp));
        markdown.push_str(&format!("{}\n\n", exported.text));
    }

    Ok(markdown)
}

/// Export meeting as PDF format with styled layout
pub fn export_as_pdf(
    title: &str,
    created_at: &str,
    transcripts: &[MeetingTranscript],
) -> Result<Vec<u8>, String> {
    // Create PDF document with A4 page size
    let (document, page1, layer1) =
        PdfDocument::new("Transcript", Mm(210.0), Mm(297.0), "Layer 1");

    let font = document
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Failed to load font: {}", e))?;
    let font_bold = document
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("Failed to load bold font: {}", e))?;

    let current_layer = document.get_page(page1).get_layer(layer1);

    let mut y_position = Mm(277.0); // Start near top, leaving margin
    let left_margin = Mm(15.0);
    let _page_width = Mm(180.0); // Usable width (210 - 2*15)
    let line_height = Mm(5.0);
    let heading_line_height = Mm(7.0);

    // Page 1: Title and metadata
    current_layer.use_text(title, 24.0, left_margin, y_position, &font_bold);
    y_position -= heading_line_height * 1.5;

    current_layer.use_text(
        &format!("Fecha: {}", created_at),
        10.0,
        left_margin,
        y_position,
        &font,
    );
    y_position -= line_height;

    current_layer.use_text(
        &format!("Total de transcripciones: {}", transcripts.len()),
        10.0,
        left_margin,
        y_position,
        &font,
    );
    y_position -= line_height * 2.0;

    // Separator (text-based, avoids printpdf Line API complexity)
    current_layer.use_text(
        "────────────────────────────────────────────────────────────",
        8.0,
        left_margin,
        y_position,
        &font,
    );
    y_position -= line_height * 1.5;

    // Add transcripts
    let min_y_position = Mm(10.0); // Bottom margin
    let mut current_page = page1;
    let mut current_layer_ref = current_layer;

    for transcript in transcripts {
        let exported = format_transcript_for_export(transcript);

        // Format: "Timestamp - Speaker: Text"
        let header = format!("{} - {}", exported.timestamp, exported.speaker);

        // Check if we need a new page
        if y_position < min_y_position + line_height * 3.0 {
            let (new_page, new_layer) =
                document.add_page(Mm(210.0), Mm(297.0), "New Page");
            current_page = new_page;
            let new_layer_id = new_layer;
            current_layer_ref = document.get_page(current_page).get_layer(new_layer_id);
            y_position = Mm(277.0);
        }

        // Draw header with timestamp and speaker
        current_layer_ref.use_text(&header, 11.0, left_margin, y_position, &font_bold);
        y_position -= heading_line_height;

        // Draw transcript text with word wrapping
        let words: Vec<&str> = exported.text.split_whitespace().collect();
        let mut current_line = String::new();
        let max_chars_per_line = 90; // Approximate character limit for wrapping

        for word in words {
            if current_line.len() + word.len() + 1 > max_chars_per_line {
                // Draw current line and start new one
                current_layer_ref.use_text(&current_line, 10.0, left_margin, y_position, &font);
                y_position -= line_height;

                // Check page boundary again
                if y_position < min_y_position + line_height {
                    let (new_page, new_layer) =
                        document.add_page(Mm(210.0), Mm(297.0), "New Page");
                    current_page = new_page;
                    let new_layer_id = new_layer;
                    current_layer_ref = document.get_page(current_page).get_layer(new_layer_id);
                    y_position = Mm(277.0);
                }

                current_line = word.to_string();
            } else if current_line.is_empty() {
                current_line = word.to_string();
            } else {
                current_line.push(' ');
                current_line.push_str(word);
            }
        }

        // Draw final line
        if !current_line.is_empty() {
            current_layer_ref.use_text(&current_line, 10.0, left_margin, y_position, &font);
            y_position -= line_height;
        }

        y_position -= line_height; // Spacing between entries
    }

    // Write PDF to bytes buffer
    let mut buffer = Vec::new();
    {
        let mut writer = BufWriter::new(&mut buffer);
        document
            .save(&mut writer)
            .map_err(|e| format!("Failed to save PDF: {}", e))?;
    }

    Ok(buffer)
}

/// Escape CSV field by quoting if necessary
fn escape_csv_field(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// Main export command: get meeting and export in specified format
#[tauri::command]
pub async fn export_meeting<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    format: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Validate input parameters
    let validated_meeting_id = validation_helpers::validate_meeting_id(&meeting_id)?;
    let validated_format = validation_helpers::validate_string_length(&format, "format", 50)?;

    log_info!(
        "export_meeting called for meeting_id: {}, format: {}",
        validated_meeting_id,
        validated_format
    );

    // Validate format parameter
    let format_lower = validated_format.to_lowercase();
    if !matches!(format_lower.as_str(), "json" | "csv" | "markdown" | "pdf") {
        return Err(format!(
            "Invalid export format: {}. Supported formats: json, csv, markdown, pdf",
            validated_format
        ));
    }

    // Get meeting from database
    let pool = state.db_manager.pool();
    let meeting = MeetingsRepository::get_meeting(pool, &validated_meeting_id)
        .await
        .map_err(|e| {
            log_error!("Error retrieving meeting {}: {}", validated_meeting_id, e);
            format!("Failed to retrieve meeting: {}", e)
        })?
        .ok_or_else(|| {
            log_error!("Meeting not found: {}", validated_meeting_id);
            format!("Meeting not found: {}", validated_meeting_id)
        })?;

    // Handle PDF separately since it returns bytes instead of string
    if format_lower == "pdf" {
        let pdf_bytes =
            export_as_pdf(&meeting.title, &meeting.created_at, &meeting.transcripts)?;

        // Open save dialog for PDF
        let file_path = app
            .dialog()
            .file()
            .set_title(format!("Export {} as PDF", meeting.title))
            .add_filter("PDF Files", &["pdf"])
            .set_file_name(format!(
                "{}_{}.pdf",
                sanitize_filename(&meeting.title),
                chrono::Local::now().format("%Y%m%d_%H%M%S")
            ))
            .blocking_save_file();

        return match file_path {
            Some(path) => {
                let path_str = path.to_string();
                std::fs::write(&path_str, pdf_bytes).map_err(|e| {
                    log_error!("Failed to write PDF export file: {}", e);
                    format!("Failed to write PDF export file: {}", e)
                })?;

                log_info!("Successfully exported meeting as PDF to: {}", path_str);
                Ok(path_str)
            }
            None => {
                log_info!("User cancelled PDF export dialog");
                Err("Export cancelled by user".to_string())
            }
        };
    }

    // Format content for text-based formats
    let content = match format_lower.as_str() {
        "json" => export_as_json(&meeting.title, &meeting.created_at, &meeting.transcripts)?,
        "csv" => export_as_csv(&meeting.title, &meeting.created_at, &meeting.transcripts)?,
        "markdown" => export_as_markdown(&meeting.title, &meeting.created_at, &meeting.transcripts)?,
        _ => {
            return Err(format!("Unsupported format: {}", format_lower));
        }
    };

    // Determine file extension for text formats
    let (file_ext, filter_name) = match format_lower.as_str() {
        "json" => ("json", "JSON Files"),
        "csv" => ("csv", "CSV Files"),
        "markdown" => ("md", "Markdown Files"),
        _ => ("txt", "Text Files"),
    };

    // Open save dialog for text formats
    let file_path = app
        .dialog()
        .file()
        .set_title(format!("Export {} as {}", meeting.title, format))
        .add_filter(filter_name, &[file_ext])
        .set_file_name(format!(
            "{}_{}.{}",
            sanitize_filename(&meeting.title),
            chrono::Local::now().format("%Y%m%d_%H%M%S"),
            file_ext
        ))
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            std::fs::write(&path_str, &content).map_err(|e| {
                log_error!("Failed to write export file: {}", e);
                format!("Failed to write export file: {}", e)
            })?;

            log_info!("Successfully exported meeting to: {}", path_str);
            Ok(path_str)
        }
        None => {
            log_info!("User cancelled export dialog");
            Err("Export cancelled by user".to_string())
        }
    }
}

/// Sanitize filename to remove invalid characters
fn sanitize_filename(filename: &str) -> String {
    filename
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_transcripts() -> Vec<MeetingTranscript> {
        vec![
            MeetingTranscript {
                id: "t1".to_string(),
                text: "Hola, buenos días".to_string(),
                timestamp: "2026-04-12T10:00:00Z".to_string(),
                audio_start_time: Some(0.0),
                audio_end_time: Some(2.5),
                duration: Some(2.5),
                source_type: Some("user".to_string()),
            },
            MeetingTranscript {
                id: "t2".to_string(),
                text: "Buenos días, ¿cómo estás?".to_string(),
                timestamp: "2026-04-12T10:00:03Z".to_string(),
                audio_start_time: Some(3.0),
                audio_end_time: Some(5.5),
                duration: Some(2.5),
                source_type: Some("interlocutor".to_string()),
            },
        ]
    }

    #[test]
    fn test_export_as_json_structure() {
        let transcripts = create_test_transcripts();
        let result = export_as_json("Test Meeting", "2026-04-12T10:00:00Z", &transcripts);

        assert!(result.is_ok());
        let json_str = result.unwrap();
        assert!(json_str.contains("\"title\": \"Test Meeting\""));
        assert!(json_str.contains("\"metadata\""));
        assert!(json_str.contains("\"transcripts\""));
        assert!(json_str.contains("\"Usuario\""));
        assert!(json_str.contains("\"Interlocutor\""));
    }

    #[test]
    fn test_export_as_json_with_special_chars() {
        let transcripts = vec![MeetingTranscript {
            id: "t1".to_string(),
            text: r#"Test with "quotes" and special chars: é, ñ, ü"#.to_string(),
            timestamp: "2026-04-12T10:00:00Z".to_string(),
            audio_start_time: Some(0.0),
            audio_end_time: Some(1.0),
            duration: Some(1.0),
            source_type: Some("user".to_string()),
        }];

        let result = export_as_json("Test", "2026-04-12T10:00:00Z", &transcripts);
        assert!(result.is_ok());
        let json_str = result.unwrap();
        // Verify JSON is valid by checking it parses
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(&json_str);
        assert!(parsed.is_ok());
    }

    #[test]
    fn test_export_as_csv_basic() {
        let transcripts = create_test_transcripts();
        let result = export_as_csv("Test Meeting", "2026-04-12T10:00:00Z", &transcripts);

        assert!(result.is_ok());
        let csv_str = result.unwrap();
        assert!(csv_str.contains("# Meeting: Test Meeting"));
        assert!(csv_str.contains("Timestamp,Speaker,Text"));
        assert!(csv_str.contains("Usuario"));
        assert!(csv_str.contains("Interlocutor"));
    }

    #[test]
    fn test_export_as_csv_escaping() {
        let transcripts = vec![MeetingTranscript {
            id: "t1".to_string(),
            text: r#"Text with comma, quote", and newline"#.to_string(),
            timestamp: "2026-04-12T10:00:00Z".to_string(),
            audio_start_time: Some(0.0),
            audio_end_time: Some(1.0),
            duration: Some(1.0),
            source_type: Some("user".to_string()),
        }];

        let result = export_as_csv("Test", "2026-04-12T10:00:00Z", &transcripts);
        assert!(result.is_ok());
        let csv_str = result.unwrap();
        // Check that problematic chars are quoted
        assert!(csv_str.contains('"'));
    }

    #[test]
    fn test_export_as_markdown_basic() {
        let transcripts = create_test_transcripts();
        let result = export_as_markdown("Test Meeting", "2026-04-12T10:00:00Z", &transcripts);

        assert!(result.is_ok());
        let md_str = result.unwrap();
        assert!(md_str.contains("# Test Meeting"));
        assert!(md_str.contains("**Fecha:**"));
        assert!(md_str.contains("**Total de transcripciones:**"));
        assert!(md_str.contains("**Usuario**"));
        assert!(md_str.contains("**Interlocutor**"));
    }

    #[test]
    fn test_export_as_markdown_formatting() {
        let transcripts = vec![MeetingTranscript {
            id: "t1".to_string(),
            text: "Important point here".to_string(),
            timestamp: "2026-04-12T10:00:00Z".to_string(),
            audio_start_time: None,
            audio_end_time: None,
            duration: None,
            source_type: Some("user".to_string()),
        }];

        let result = export_as_markdown("Meeting", "2026-04-12T10:00:00Z", &transcripts);
        assert!(result.is_ok());
        let md_str = result.unwrap();
        assert!(md_str.contains("Important point here"));
        assert!(md_str.contains("*(2026-04-12T10:00:00Z)*"));
    }

    #[test]
    fn test_format_transcript_for_export_user() {
        let transcript = MeetingTranscript {
            id: "t1".to_string(),
            text: "Test text".to_string(),
            timestamp: "2026-04-12T10:00:00Z".to_string(),
            audio_start_time: Some(1.5),
            audio_end_time: Some(3.5),
            duration: Some(2.0),
            source_type: Some("user".to_string()),
        };

        let exported = format_transcript_for_export(&transcript);
        assert_eq!(exported.speaker, "Usuario");
        assert_eq!(exported.text, "Test text");
        assert_eq!(exported.audio_start, Some(1.5));
    }

    #[test]
    fn test_format_transcript_for_export_interlocutor() {
        let transcript = MeetingTranscript {
            id: "t1".to_string(),
            text: "Response text".to_string(),
            timestamp: "2026-04-12T10:00:05Z".to_string(),
            audio_start_time: Some(5.0),
            audio_end_time: Some(7.0),
            duration: Some(2.0),
            source_type: Some("interlocutor".to_string()),
        };

        let exported = format_transcript_for_export(&transcript);
        assert_eq!(exported.speaker, "Interlocutor");
    }

    #[test]
    fn test_format_transcript_for_export_unknown() {
        let transcript = MeetingTranscript {
            id: "t1".to_string(),
            text: "Unknown speaker".to_string(),
            timestamp: "2026-04-12T10:00:00Z".to_string(),
            audio_start_time: None,
            audio_end_time: None,
            duration: None,
            source_type: None,
        };

        let exported = format_transcript_for_export(&transcript);
        assert_eq!(exported.speaker, "Desconocido");
    }

    #[test]
    fn test_sanitize_filename() {
        let filename = r#"Meeting: Q1/2026\Review*Results?"#;
        let sanitized = sanitize_filename(filename);
        assert!(!sanitized.contains('/'));
        assert!(!sanitized.contains('\\'));
        assert!(!sanitized.contains('*'));
        assert!(!sanitized.contains('?'));
        assert!(sanitized.contains('_'));
    }

    #[test]
    fn test_escape_csv_field_no_special_chars() {
        let field = "simple text";
        let escaped = escape_csv_field(field);
        assert_eq!(escaped, "simple text");
    }

    #[test]
    fn test_escape_csv_field_with_comma() {
        let field = "text, with comma";
        let escaped = escape_csv_field(field);
        assert!(escaped.starts_with('"'));
        assert!(escaped.ends_with('"'));
    }

    #[test]
    fn test_escape_csv_field_with_quotes() {
        let field = r#"text with "quotes""#;
        let escaped = escape_csv_field(field);
        assert!(escaped.contains("\"\""));
    }

    #[test]
    fn test_empty_transcripts() {
        let empty = vec![];
        let json_result = export_as_json("Empty", "2026-04-12T10:00:00Z", &empty);
        assert!(json_result.is_ok());

        let csv_result = export_as_csv("Empty", "2026-04-12T10:00:00Z", &empty);
        assert!(csv_result.is_ok());

        let md_result = export_as_markdown("Empty", "2026-04-12T10:00:00Z", &empty);
        assert!(md_result.is_ok());
    }

    #[test]
    fn test_export_as_pdf_basic() {
        let empty = vec![];
        let result = export_as_pdf("Test Meeting", "2026-04-12T10:00:00Z", &empty);

        assert!(result.is_ok());
        let pdf_bytes = result.unwrap();

        // PDF files start with %PDF magic bytes
        assert!(pdf_bytes.len() > 4);
        assert_eq!(&pdf_bytes[0..4], b"%PDF");
    }

    #[test]
    fn test_export_as_pdf_with_transcripts() {
        let transcripts = create_test_transcripts();
        let result = export_as_pdf("Test Meeting", "2026-04-12T10:00:00Z", &transcripts);

        assert!(result.is_ok());
        let pdf_bytes = result.unwrap();

        // PDF files start with %PDF magic bytes
        assert!(pdf_bytes.len() > 4);
        assert_eq!(&pdf_bytes[0..4], b"%PDF");

        // Verify PDF is reasonably sized (should contain content)
        assert!(pdf_bytes.len() > 1000, "PDF should contain transcript content");
    }
}
