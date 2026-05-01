//! `SidecarPool` — pool de procesos `llama-helper` indexado por nombre de modelo.
//!
//! Reemplaza el singleton `SIDECAR_MANAGER` por un pool que mantiene un
//! `HashMap<model_name, Arc<SidecarManager>>`. Permite tener varios modelos
//! cargados simultaneamente (ej. Gemma 1B para coach + Gemma 4B para summary)
//! sin colisionar.
//!
//! Comportamiento:
//! - Si un modelo ya tiene sidecar, `get_or_spawn` lo reusa (zero-cost).
//! - Si dos servicios usan el mismo modelo, comparten sidecar.
//! - Si dos servicios usan modelos distintos, hay 2 procesos en paralelo.
//!
//! Patron: double-check con `RwLock` para evitar spawns duplicados bajo
//! concurrencia.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use tokio::sync::RwLock;

use crate::summary::summary_engine::sidecar::SidecarManager;

/// Pool de `SidecarManager` indexado por nombre de modelo.
pub struct SidecarPool {
    /// Mapa modelo -> sidecar. RwLock permite multiples lecturas concurrentes
    /// y serializa solo los spawns nuevos.
    sidecars: RwLock<HashMap<String, Arc<SidecarManager>>>,

    /// Directorio base de la app (para resolver paths de modelos).
    /// `SidecarManager::new` solo lo necesita para herencia futura — no
    /// lo usa hoy, pero lo guardamos para poder pasarselo en cada spawn.
    app_data_dir: PathBuf,
}

impl SidecarPool {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            sidecars: RwLock::new(HashMap::new()),
            app_data_dir,
        }
    }

    /// Devuelve el sidecar para `model_name`, creandolo si no existe.
    /// `model_path` es la ruta absoluta al archivo `.gguf` que el sidecar
    /// debe cargar al arrancar.
    ///
    /// Idempotente: si el modelo ya tiene sidecar, lo reusa. Si dos llamadas
    /// concurrentes piden el mismo modelo nuevo, solo una lo crea (double-check).
    pub async fn get_or_spawn(
        &self,
        model_name: &str,
        model_path: PathBuf,
    ) -> Result<Arc<SidecarManager>> {
        // Fast path: read lock + ya existe
        {
            let map = self.sidecars.read().await;
            if let Some(manager) = map.get(model_name) {
                manager.ensure_running(model_path.clone()).await?;
                return Ok(manager.clone());
            }
        }

        // Slow path: write lock + double check + spawn
        let mut map = self.sidecars.write().await;
        if let Some(manager) = map.get(model_name) {
            manager.ensure_running(model_path.clone()).await?;
            return Ok(manager.clone());
        }

        log::info!(
            "SidecarPool: spawning new sidecar for model '{}'",
            model_name
        );
        let manager = Arc::new(SidecarManager::new(self.app_data_dir.clone())?);
        manager.ensure_running(model_path).await?;
        map.insert(model_name.to_string(), manager.clone());
        Ok(manager)
    }

    /// Devuelve el sidecar de un modelo si ya esta cargado. None si no.
    pub async fn get(&self, model_name: &str) -> Option<Arc<SidecarManager>> {
        let map = self.sidecars.read().await;
        map.get(model_name).cloned()
    }

    /// Cuenta de sidecars activos (para metricas/debug).
    pub async fn active_count(&self) -> usize {
        self.sidecars.read().await.len()
    }

    /// Snapshot de los sidecars para chequeos de health del pool (clones de los Arcs).
    /// Devuelve un Vec en lugar de mantener el lock.
    pub async fn sidecars_for_health_check(&self) -> Vec<Arc<SidecarManager>> {
        self.sidecars.read().await.values().cloned().collect()
    }

    /// Apaga todos los sidecars (graceful). Util al cierre de la app.
    pub async fn shutdown_all(&self) -> Result<()> {
        let managers: Vec<(String, Arc<SidecarManager>)> = {
            let mut map = self.sidecars.write().await;
            map.drain().collect()
        };

        let mut errors = Vec::new();
        for (model_name, manager) in managers {
            if let Err(e) = manager.shutdown().await {
                log::error!(
                    "SidecarPool: error apagando sidecar de '{}': {}",
                    model_name,
                    e
                );
                errors.push(format!("{}: {}", model_name, e));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(
                "Errores apagando sidecars: {}",
                errors.join(", ")
            ))
        }
    }

    /// Apaga el sidecar de un modelo especifico (graceful).
    pub async fn shutdown_one(&self, model_name: &str) -> Result<()> {
        let manager = {
            let mut map = self.sidecars.write().await;
            map.remove(model_name)
        };
        if let Some(manager) = manager {
            manager.shutdown().await?;
        }
        Ok(())
    }
}
