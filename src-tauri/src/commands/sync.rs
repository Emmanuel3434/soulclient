use super::AppState;
use crate::utils::{AppError, AppResult};
use tauri::{AppHandle, State};

/// Flushes the persisted offline-first sync queue to the backend right now
/// (used by the frontend when it detects that connectivity/Realtime returned).
/// Returns the number of ops still pending after the attempt.
#[tauri::command]
pub async fn flush_sync_queue(app: AppHandle, state: State<'_, AppState>) -> AppResult<usize> {
    crate::sync::flush(&state, Some(&app))
        .await
        .map_err(|e| AppError::from(format!("No se pudo sincronizar la cola: {e}")))
}

/// Number of mutations still waiting to be pushed to the backend (offline).
#[tauri::command]
pub fn get_sync_queue_status(state: State<'_, AppState>) -> usize {
    state.sync_queue.pending_count()
}
