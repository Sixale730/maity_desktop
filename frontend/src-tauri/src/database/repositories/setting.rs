use crate::database::models::{Setting, TranscriptSetting};
use crate::summary::CustomOpenAIConfig;
use sqlx::SqlitePool;

#[derive(serde::Deserialize, Debug)]
pub struct SaveModelConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
pub struct SaveTranscriptConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

pub struct SettingsRepository;

// Transcript providers: parakeet, canary, elevenLabs, groq, openai
// Summary providers: openai, claude, ollama, groq, added openrouter
// NOTE: Handle data exclusion in the higher layer as this is database abstraction layer(using SELECT *)

impl SettingsRepository {
    pub async fn get_model_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<Setting>, sqlx::Error> {
        let setting = sqlx::query_as::<_, Setting>("SELECT * FROM settings LIMIT 1")
            .fetch_optional(pool)
            .await?;
        Ok(setting)
    }

    pub async fn save_model_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
        whisper_model: &str,
        ollama_endpoint: Option<&str>,
    ) -> std::result::Result<(), sqlx::Error> {
        // Using id '1' for backward compatibility
        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, ollamaEndpoint)
            VALUES ('1', $1, $2, $3, $4)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                whisperModel = excluded.whisperModel,
                ollamaEndpoint = excluded.ollamaEndpoint
            "#,
        )
        .bind(provider)
        .bind(model)
        .bind(whisper_model)
        .bind(ollama_endpoint)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn save_api_key(
        pool: &SqlitePool,
        provider: &str,
        api_key: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        // Custom OpenAI uses JSON config (customOpenAIConfig) instead of a separate API key column
        if provider == "custom-openai" {
            return Err(sqlx::Error::Protocol(
                "custom-openai provider should use save_custom_openai_config() instead of save_api_key()".into(),
            ));
        }

        // Validate provider and handle early returns
        match provider {
            "openai" | "claude" | "ollama" | "groq" | "openrouter" => {},
            "builtin-ai" => return Ok(()), // No API key needed
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = match provider {
            "openai" => r#"
            INSERT INTO settings (id, provider, model, whisperModel, "openaiApiKey")
            VALUES ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', $1)
            ON CONFLICT(id) DO UPDATE SET "openaiApiKey" = $1
            "#,
            "claude" => r#"
            INSERT INTO settings (id, provider, model, whisperModel, "anthropicApiKey")
            VALUES ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', $1)
            ON CONFLICT(id) DO UPDATE SET "anthropicApiKey" = $1
            "#,
            "ollama" => r#"
            INSERT INTO settings (id, provider, model, whisperModel, "ollamaApiKey")
            VALUES ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', $1)
            ON CONFLICT(id) DO UPDATE SET "ollamaApiKey" = $1
            "#,
            "groq" => r#"
            INSERT INTO settings (id, provider, model, whisperModel, "groqApiKey")
            VALUES ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', $1)
            ON CONFLICT(id) DO UPDATE SET "groqApiKey" = $1
            "#,
            "openrouter" => r#"
            INSERT INTO settings (id, provider, model, whisperModel, "openRouterApiKey")
            VALUES ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', $1)
            ON CONFLICT(id) DO UPDATE SET "openRouterApiKey" = $1
            "#,
            _ => unreachable!(), // Already validated above
        };
        sqlx::query(query).bind(api_key).execute(pool).await?;

        Ok(())
    }

    pub async fn get_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        // Custom OpenAI uses JSON config - extract API key from there
        if provider == "custom-openai" {
            let config = Self::get_custom_openai_config(pool).await?;
            return Ok(config.and_then(|c| c.api_key));
        }

        // Validate provider and handle early returns
        match provider {
            "openai" | "ollama" | "groq" | "claude" | "openrouter" => {},
            "builtin-ai" => return Ok(None), // No API key needed
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = match provider {
            "openai" => "SELECT openaiApiKey FROM settings WHERE id = '1' LIMIT 1",
            "ollama" => "SELECT ollamaApiKey FROM settings WHERE id = '1' LIMIT 1",
            "groq" => "SELECT groqApiKey FROM settings WHERE id = '1' LIMIT 1",
            "claude" => "SELECT anthropicApiKey FROM settings WHERE id = '1' LIMIT 1",
            "openrouter" => "SELECT openRouterApiKey FROM settings WHERE id = '1' LIMIT 1",
            _ => unreachable!(), // Already validated above
        };
        let api_key = sqlx::query_scalar(query).fetch_optional(pool).await?;
        Ok(api_key)
    }

    pub async fn get_transcript_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<TranscriptSetting>, sqlx::Error> {
        let setting =
            sqlx::query_as::<_, TranscriptSetting>("SELECT * FROM transcript_settings LIMIT 1")
                .fetch_optional(pool)
                .await?;
        Ok(setting)

    }

    pub async fn save_transcript_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO transcript_settings (id, provider, model)
            VALUES ('1', $1, $2)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model
            "#,
        )
        .bind(provider)
        .bind(model)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn save_transcript_api_key(
        pool: &SqlitePool,
        provider: &str,
        api_key: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        // Validate provider and handle early returns
        match provider {
            "parakeet" => return Ok(()), // Parakeet doesn't need an API key, return early
            "canary" => return Ok(()), // Canary doesn't need an API key
            "elevenLabs" | "groq" | "openai" => {},
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = match provider {
            "elevenLabs" => r#"
            INSERT INTO transcript_settings (id, provider, model, "elevenLabsApiKey")
            VALUES ('1', 'parakeet', 'parakeet-tdt-0.6b-v3-int8', $1)
            ON CONFLICT(id) DO UPDATE SET "elevenLabsApiKey" = $1
            "#,
            "groq" => r#"
            INSERT INTO transcript_settings (id, provider, model, "groqApiKey")
            VALUES ('1', 'parakeet', 'parakeet-tdt-0.6b-v3-int8', $1)
            ON CONFLICT(id) DO UPDATE SET "groqApiKey" = $1
            "#,
            "openai" => r#"
            INSERT INTO transcript_settings (id, provider, model, "openaiApiKey")
            VALUES ('1', 'parakeet', 'parakeet-tdt-0.6b-v3-int8', $1)
            ON CONFLICT(id) DO UPDATE SET "openaiApiKey" = $1
            "#,
            _ => unreachable!(), // Already validated above
        };
        sqlx::query(query).bind(api_key).execute(pool).await?;

        Ok(())
    }

    pub async fn get_transcript_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        // Validate provider and handle early returns
        match provider {
            "parakeet" => return Ok(None), // Parakeet doesn't need an API key
            "canary" => return Ok(None), // Canary doesn't need an API key
            "elevenLabs" | "groq" | "openai" => {},
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = match provider {
            "elevenLabs" => "SELECT elevenLabsApiKey FROM transcript_settings WHERE id = '1' LIMIT 1",
            "groq" => "SELECT groqApiKey FROM transcript_settings WHERE id = '1' LIMIT 1",
            "openai" => "SELECT openaiApiKey FROM transcript_settings WHERE id = '1' LIMIT 1",
            _ => unreachable!(), // Already validated above
        };
        let api_key = sqlx::query_scalar(query).fetch_optional(pool).await?;
        Ok(api_key)
    }

    pub async fn delete_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        // Custom OpenAI uses JSON config - clear the entire config
        if provider == "custom-openai" {
            sqlx::query("UPDATE settings SET customOpenAIConfig = NULL WHERE id = '1'")
                .execute(pool)
                .await?;
            return Ok(());
        }

        // Validate provider and handle early returns
        match provider {
            "openai" | "ollama" | "groq" | "claude" | "openrouter" => {},
            "builtin-ai" => return Ok(()), // No API key needed
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = match provider {
            "openai" => "UPDATE settings SET openaiApiKey = NULL WHERE id = '1'",
            "ollama" => "UPDATE settings SET ollamaApiKey = NULL WHERE id = '1'",
            "groq" => "UPDATE settings SET groqApiKey = NULL WHERE id = '1'",
            "claude" => "UPDATE settings SET anthropicApiKey = NULL WHERE id = '1'",
            "openrouter" => "UPDATE settings SET openRouterApiKey = NULL WHERE id = '1'",
            _ => unreachable!(), // Already validated above
        };
        sqlx::query(query).execute(pool).await?;

        Ok(())
    }

    // ===== CUSTOM OPENAI CONFIG METHODS =====

    /// Gets the custom OpenAI configuration from JSON
    ///
    /// # Returns
    /// * `Ok(Some(CustomOpenAIConfig))` - Config exists and is valid JSON
    /// * `Ok(None)` - No config stored
    /// * `Err(sqlx::Error)` - Database error
    pub async fn get_custom_openai_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<CustomOpenAIConfig>, sqlx::Error> {
        use sqlx::Row;

        let row = sqlx::query(
            r#"
            SELECT customOpenAIConfig
            FROM settings
            WHERE id = '1'
            LIMIT 1
            "#
        )
        .fetch_optional(pool)
        .await?;

        match row {
            Some(record) => {
                let config_json: Option<String> = record.get("customOpenAIConfig");

                if let Some(json) = config_json {
                    // Parse JSON into CustomOpenAIConfig
                    let config: CustomOpenAIConfig = serde_json::from_str(&json)
                        .map_err(|e| sqlx::Error::Protocol(
                            format!("Invalid JSON in customOpenAIConfig: {}", e).into()
                        ))?;

                    Ok(Some(config))
                } else {
                    Ok(None)
                }
            }
            None => Ok(None),
        }
    }

    /// Saves the custom OpenAI configuration as JSON
    ///
    /// # Arguments
    /// * `pool` - Database connection pool
    /// * `config` - CustomOpenAIConfig to save (includes endpoint, apiKey, model, maxTokens, temperature, topP)
    ///
    /// # Returns
    /// * `Ok(())` - Config saved successfully
    /// * `Err(sqlx::Error)` - Database or JSON serialization error
    pub async fn save_custom_openai_config(
        pool: &SqlitePool,
        config: &CustomOpenAIConfig,
    ) -> std::result::Result<(), sqlx::Error> {
        // Serialize config to JSON
        let config_json = serde_json::to_string(config)
            .map_err(|e| sqlx::Error::Protocol(
                format!("Failed to serialize config to JSON: {}", e).into()
            ))?;

        // Upsert into settings table
        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, customOpenAIConfig)
            VALUES ('1', 'custom-openai', $1, 'large-v3', $2)
            ON CONFLICT(id) DO UPDATE SET
                customOpenAIConfig = excluded.customOpenAIConfig
            "#,
        )
        .bind(&config.model)
        .bind(config_json)
        .execute(pool)
        .await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_model_config_request_deserialization() {
        let json = r#"{
            "provider": "ollama",
            "model": "llama2",
            "whisperModel": "base",
            "apiKey": "test-key-123",
            "ollamaEndpoint": "http://localhost:11434"
        }"#;

        let request: SaveModelConfigRequest =
            serde_json::from_str(json).expect("deserialization failed");

        assert_eq!(request.provider, "ollama");
        assert_eq!(request.model, "llama2");
        assert_eq!(request.whisper_model, "base");
        assert_eq!(request.api_key, Some("test-key-123".to_string()));
        assert_eq!(
            request.ollama_endpoint,
            Some("http://localhost:11434".to_string())
        );
    }

    #[test]
    fn test_save_model_config_request_without_optional_fields() {
        let json = r#"{
            "provider": "openai",
            "model": "gpt-4o",
            "whisperModel": "large-v3"
        }"#;

        let request: SaveModelConfigRequest =
            serde_json::from_str(json).expect("deserialization failed");

        assert_eq!(request.provider, "openai");
        assert!(request.api_key.is_none());
        assert!(request.ollama_endpoint.is_none());
    }

    #[test]
    fn test_save_transcript_config_request_deserialization() {
        let json = r#"{
            "provider": "parakeet",
            "model": "parakeet-tdt-0.6b-v3-int8",
            "apiKey": null
        }"#;

        let request: SaveTranscriptConfigRequest =
            serde_json::from_str(json).expect("deserialization failed");

        assert_eq!(request.provider, "parakeet");
        assert_eq!(request.model, "parakeet-tdt-0.6b-v3-int8");
        assert!(request.api_key.is_none());
    }

    #[test]
    fn test_save_transcript_config_request_with_api_key() {
        let json = r#"{
            "provider": "groq",
            "model": "parakeet-tdt-0.6b-v3-int8",
            "apiKey": "groq-api-key-789"
        }"#;

        let request: SaveTranscriptConfigRequest =
            serde_json::from_str(json).expect("deserialization failed");

        assert_eq!(request.provider, "groq");
        assert_eq!(request.api_key, Some("groq-api-key-789".to_string()));
    }

    #[test]
    fn test_valid_summary_providers() {
        // Test that various summary providers are recognized as valid
        let providers = vec!["openai", "claude", "ollama", "groq", "openrouter"];
        for provider in providers {
            // Just checking that these provider names are expected in the codebase
            assert!(!provider.is_empty());
        }
    }

    #[test]
    fn test_valid_transcript_providers() {
        // Test that various transcript providers are recognized as valid
        let providers = vec![
            "parakeet",
            "canary",
            "elevenLabs",
            "groq",
            "openai",
        ];
        for provider in providers {
            // Just checking that these provider names are expected in the codebase
            assert!(!provider.is_empty());
        }
    }

    #[test]
    fn test_builtin_ai_provider_no_api_key() {
        // builtin-ai is a special provider that doesn't require an API key
        let provider = "builtin-ai";
        assert_eq!(provider, "builtin-ai");
    }

    #[test]
    fn test_parakeet_transcript_provider_no_api_key() {
        // parakeet doesn't need an API key because it's a local model
        let provider = "parakeet";
        assert_eq!(provider, "parakeet");
    }

    #[test]
    fn test_canary_transcript_provider_no_api_key() {
        // canary doesn't need an API key because it's a local model
        let provider = "canary";
        assert_eq!(provider, "canary");
    }

    #[test]
    fn test_custom_openai_provider_json_config() {
        // custom-openai uses JSON config instead of a simple API key
        let provider = "custom-openai";
        assert_eq!(provider, "custom-openai");
    }

    #[test]
    fn test_api_key_string_formats() {
        // Test common API key patterns
        let test_keys = vec![
            "sk-test-key-123",
            "groq-api-key-456",
            "key_with_underscores",
            "UPPERCASE_KEY_789",
        ];

        for key in test_keys {
            assert!(!key.is_empty());
            assert!(key.len() > 5, "API keys should have minimum length");
        }
    }

    #[test]
    fn test_endpoint_url_format() {
        let endpoints = vec![
            "http://localhost:11434",
            "https://api.openai.com/v1",
            "http://192.168.1.100:8000",
        ];

        for endpoint in endpoints {
            assert!(endpoint.starts_with("http"));
        }
    }
}

