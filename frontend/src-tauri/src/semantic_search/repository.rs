//! Persistencia de embeddings en SQLite.

use sqlx::{Row, SqlitePool};

use super::{bytes_to_embedding, embedding_to_bytes};

pub struct EmbeddingsRepository;

#[derive(Debug, Clone)]
pub struct EmbeddingRow {
    pub meeting_id: String,
    pub segment_id: String,
    pub text: String,
    pub embedding: Vec<f32>,
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub source_type: Option<String>,
}

impl EmbeddingsRepository {
    pub async fn upsert(
        pool: &SqlitePool,
        meeting_id: &str,
        segment_id: &str,
        text: &str,
        embedding: &[f32],
        model: &str,
        audio_start_time: Option<f64>,
        audio_end_time: Option<f64>,
        source_type: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let blob = embedding_to_bytes(embedding);
        let dim = embedding.len() as i64;

        sqlx::query(
            "INSERT INTO transcript_embeddings
                (meeting_id, segment_id, text, embedding, model, dim,
                 audio_start_time, audio_end_time, source_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(meeting_id, segment_id, model) DO UPDATE SET
                text = excluded.text,
                embedding = excluded.embedding,
                dim = excluded.dim,
                audio_start_time = excluded.audio_start_time,
                audio_end_time = excluded.audio_end_time,
                source_type = excluded.source_type,
                created_at = CURRENT_TIMESTAMP",
        )
        .bind(meeting_id)
        .bind(segment_id)
        .bind(text)
        .bind(blob)
        .bind(model)
        .bind(dim)
        .bind(audio_start_time)
        .bind(audio_end_time)
        .bind(source_type)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn segment_already_indexed(
        pool: &SqlitePool,
        meeting_id: &str,
        segment_id: &str,
        model: &str,
    ) -> Result<bool, sqlx::Error> {
        let row = sqlx::query(
            "SELECT 1 as found FROM transcript_embeddings
             WHERE meeting_id = ? AND segment_id = ? AND model = ? LIMIT 1",
        )
        .bind(meeting_id)
        .bind(segment_id)
        .bind(model)
        .fetch_optional(pool)
        .await?;
        Ok(row.is_some())
    }

    pub async fn load_all(
        pool: &SqlitePool,
        model: &str,
        meeting_id: Option<&str>,
    ) -> Result<Vec<EmbeddingRow>, sqlx::Error> {
        let rows = if let Some(mid) = meeting_id {
            sqlx::query(
                "SELECT meeting_id, segment_id, text, embedding,
                        audio_start_time, audio_end_time, source_type
                 FROM transcript_embeddings
                 WHERE model = ? AND meeting_id = ?",
            )
            .bind(model)
            .bind(mid)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query(
                "SELECT meeting_id, segment_id, text, embedding,
                        audio_start_time, audio_end_time, source_type
                 FROM transcript_embeddings
                 WHERE model = ?",
            )
            .bind(model)
            .fetch_all(pool)
            .await?
        };

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let blob: Vec<u8> = row.try_get("embedding")?;
            let embedding = match bytes_to_embedding(&blob) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("Skipping malformed embedding row: {}", e);
                    continue;
                }
            };
            out.push(EmbeddingRow {
                meeting_id: row.try_get("meeting_id")?,
                segment_id: row.try_get("segment_id")?,
                text: row.try_get("text")?,
                embedding,
                audio_start_time: row.try_get("audio_start_time").ok(),
                audio_end_time: row.try_get("audio_end_time").ok(),
                source_type: row.try_get("source_type").ok(),
            });
        }
        Ok(out)
    }

    pub async fn delete_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM transcript_embeddings WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
