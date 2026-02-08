//! RAG (Retrieval-Augmented Generation) commands for semantic search.

use std::collections::HashSet;

use serde_json;
use tauri::State;
use uuid::Uuid;

use crate::rag::{chunk_page, EmbeddingConfig, SemanticSearchResult};
use crate::search::SearchResult;
use crate::AppState;

use super::CommandError;

/// Get the set of notebook IDs that are encrypted but not unlocked (i.e., locked)
fn get_locked_notebook_ids(state: &State<AppState>) -> Result<HashSet<Uuid>, CommandError> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let encryption_manager = &state.encryption_manager;

    let notebooks = storage.list_notebooks().map_err(|e| CommandError {
        message: format!("Failed to list notebooks: {}", e),
    })?;

    let mut locked_ids = HashSet::new();
    for notebook in notebooks {
        if notebook.is_encrypted() && !encryption_manager.is_notebook_unlocked(notebook.id) {
            locked_ids.insert(notebook.id);
        }
    }

    Ok(locked_ids)
}

/// Configure the embedding model for RAG.
#[tauri::command]
pub fn configure_embeddings(
    state: State<AppState>,
    provider: String,
    model: String,
    dimensions: u32,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<(), CommandError> {
    let mut vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    let config = EmbeddingConfig {
        provider,
        model,
        dimensions,
        api_key,
        base_url,
    };

    vector_index.configure(config).map_err(|e| CommandError {
        message: format!("Failed to configure embeddings: {}", e),
    })?;

    Ok(())
}

/// Get the current embedding configuration.
#[tauri::command]
pub fn get_embedding_config(
    state: State<AppState>,
) -> Result<Option<EmbeddingConfig>, CommandError> {
    let vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    Ok(vector_index.get_config().cloned())
}

/// Perform semantic search using a pre-computed query embedding.
#[tauri::command]
pub fn semantic_search(
    state: State<AppState>,
    query_embedding: Vec<f32>,
    notebook_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SemanticSearchResult>, CommandError> {
    let vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    let notebook_uuid = notebook_id
        .map(|id| Uuid::parse_str(&id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid notebook ID: {}", e),
        })?;

    // Get locked notebook IDs to filter out
    let locked_ids = get_locked_notebook_ids(&state)?;

    let results = vector_index
        .search(&query_embedding, limit.unwrap_or(10), notebook_uuid)
        .map_err(|e| CommandError {
            message: format!("Semantic search failed: {}", e),
        })?;

    // Filter out results from locked notebooks
    let filtered_results: Vec<SemanticSearchResult> = results
        .into_iter()
        .filter(|r| {
            if let Ok(nb_id) = Uuid::parse_str(&r.notebook_id) {
                !locked_ids.contains(&nb_id)
            } else {
                true
            }
        })
        .collect();

    Ok(filtered_results)
}

/// Perform hybrid search combining semantic and keyword search.
#[tauri::command]
pub fn hybrid_search(
    state: State<AppState>,
    query: String,
    query_embedding: Vec<f32>,
    notebook_id: Option<String>,
    limit: Option<usize>,
    semantic_weight: Option<f32>,
) -> Result<Vec<SearchResult>, CommandError> {
    let limit = limit.unwrap_or(10);
    let semantic_weight = semantic_weight.unwrap_or(0.5).clamp(0.0, 1.0);
    let keyword_weight = 1.0 - semantic_weight;

    // Get locked notebook IDs to filter out
    let locked_ids = get_locked_notebook_ids(&state)?;

    // Perform semantic search
    let vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    let notebook_uuid = notebook_id
        .as_ref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid notebook ID: {}", e),
        })?;

    let semantic_results: Vec<SemanticSearchResult> = vector_index
        .search(&query_embedding, limit * 2, notebook_uuid)
        .map_err(|e| CommandError {
            message: format!("Semantic search failed: {}", e),
        })?
        .into_iter()
        .filter(|r| {
            if let Ok(nb_id) = Uuid::parse_str(&r.notebook_id) {
                !locked_ids.contains(&nb_id)
            } else {
                true
            }
        })
        .collect();

    drop(vector_index);

    // Perform keyword search
    let search_index = state.search_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire search index lock: {}", e),
    })?;

    let keyword_results: Vec<SearchResult> = search_index
        .search(&query, limit * 2)
        .map_err(|e| CommandError {
            message: format!("Keyword search failed: {}", e),
        })?
        .into_iter()
        .filter(|r| {
            if let Ok(nb_id) = Uuid::parse_str(&r.notebook_id) {
                !locked_ids.contains(&nb_id)
            } else {
                true
            }
        })
        .collect();

    drop(search_index);

    // Combine results using Reciprocal Rank Fusion
    use std::collections::HashMap;

    const K: f32 = 60.0; // RRF constant

    let mut page_scores: HashMap<String, (f32, Option<String>, Option<String>, Option<String>)> =
        HashMap::new();

    // Add semantic scores
    for (rank, result) in semantic_results.iter().enumerate() {
        let rrf = 1.0 / (K + rank as f32 + 1.0);
        let entry = page_scores.entry(result.page_id.clone()).or_insert((
            0.0,
            Some(result.notebook_id.clone()),
            Some(result.title.clone()),
            Some(result.content.clone()),
        ));
        entry.0 += semantic_weight * rrf;
    }

    // Add keyword scores
    for (rank, result) in keyword_results.iter().enumerate() {
        let rrf = 1.0 / (K + rank as f32 + 1.0);
        let entry = page_scores.entry(result.page_id.clone()).or_insert((
            0.0,
            Some(result.notebook_id.clone()),
            Some(result.title.clone()),
            Some(result.snippet.clone()),
        ));
        entry.0 += keyword_weight * rrf;
        // Update metadata from keyword results if not set
        if entry.1.is_none() {
            entry.1 = Some(result.notebook_id.clone());
        }
        if entry.2.is_none() {
            entry.2 = Some(result.title.clone());
        }
    }

    // Sort and return top results
    let mut results: Vec<_> = page_scores
        .into_iter()
        .map(|(page_id, (score, notebook_id, title, snippet))| SearchResult {
            page_id,
            notebook_id: notebook_id.unwrap_or_default(),
            title: title.unwrap_or_default(),
            snippet: snippet.unwrap_or_default(),
            score,
            page_type: "standard".to_string(),
        })
        .collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);

    Ok(results)
}

/// Get RAG context for AI chat - retrieve relevant chunks for a query.
#[tauri::command]
pub fn get_rag_context(
    state: State<AppState>,
    query_embedding: Vec<f32>,
    notebook_id: Option<String>,
    max_chunks: Option<usize>,
) -> Result<Vec<SemanticSearchResult>, CommandError> {
    let vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    let notebook_uuid = notebook_id
        .map(|id| Uuid::parse_str(&id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid notebook ID: {}", e),
        })?;

    // Get locked notebook IDs to filter out
    let locked_ids = get_locked_notebook_ids(&state)?;

    let results = vector_index
        .search(&query_embedding, max_chunks.unwrap_or(5), notebook_uuid)
        .map_err(|e| CommandError {
            message: format!("Failed to get RAG context: {}", e),
        })?;

    // Filter out results from locked notebooks
    let filtered_results: Vec<SemanticSearchResult> = results
        .into_iter()
        .filter(|r| {
            if let Ok(nb_id) = Uuid::parse_str(&r.notebook_id) {
                !locked_ids.contains(&nb_id)
            } else {
                true
            }
        })
        .collect();

    Ok(filtered_results)
}

/// Index a page with its embedding.
#[tauri::command]
pub fn index_page_embedding(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    embeddings: Vec<Vec<f32>>,
) -> Result<(), CommandError> {
    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // Get the page from storage
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let page = storage.get_page(notebook_uuid, page_uuid).map_err(|e| CommandError {
        message: format!("Failed to get page: {}", e),
    })?;

    drop(storage);

    // Chunk the page
    let chunks = chunk_page(&page);

    if chunks.len() != embeddings.len() {
        return Err(CommandError {
            message: format!(
                "Chunk count ({}) doesn't match embedding count ({})",
                chunks.len(),
                embeddings.len()
            ),
        });
    }

    // Index the page
    let mut vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    vector_index
        .index_page(page_uuid, &page.title, &chunks, &embeddings)
        .map_err(|e| CommandError {
            message: format!("Failed to index page: {}", e),
        })?;

    Ok(())
}

/// Remove a page from the vector index.
#[tauri::command]
pub fn remove_page_embedding(state: State<AppState>, page_id: String) -> Result<(), CommandError> {
    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let mut vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    vector_index.remove_page(page_uuid).map_err(|e| CommandError {
        message: format!("Failed to remove page from vector index: {}", e),
    })?;

    Ok(())
}

/// Find pages similar to a given page using its chunk embeddings.
#[tauri::command]
pub fn find_similar_pages(
    state: State<AppState>,
    page_id: String,
    notebook_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SemanticSearchResult>, CommandError> {
    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let notebook_uuid = notebook_id
        .map(|id| Uuid::parse_str(&id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid notebook ID: {}", e),
        })?;

    let locked_ids = get_locked_notebook_ids(&state)?;

    let vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    let results = vector_index
        .find_similar_pages(page_uuid, limit.unwrap_or(10), notebook_uuid)
        .map_err(|e| CommandError {
            message: format!("Find similar pages failed: {}", e),
        })?;

    // Filter out results from locked notebooks
    let filtered_results: Vec<SemanticSearchResult> = results
        .into_iter()
        .filter(|r| {
            if let Ok(nb_id) = Uuid::parse_str(&r.notebook_id) {
                !locked_ids.contains(&nb_id)
            } else {
                true
            }
        })
        .collect();

    Ok(filtered_results)
}

/// Get chunks for a page (for embedding generation).
#[tauri::command]
pub fn get_page_chunks(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> Result<Vec<String>, CommandError> {
    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let page = storage.get_page(notebook_uuid, page_uuid).map_err(|e| CommandError {
        message: format!("Failed to get page: {}", e),
    })?;

    drop(storage);

    let chunks = chunk_page(&page);
    Ok(chunks.into_iter().map(|c| c.content).collect())
}

/// Rebuild the vector index (clear all embeddings).
#[tauri::command]
pub fn rebuild_vector_index(state: State<AppState>) -> Result<(), CommandError> {
    let mut vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    vector_index.rebuild().map_err(|e| CommandError {
        message: format!("Failed to rebuild vector index: {}", e),
    })?;

    Ok(())
}

/// Get vector index statistics.
#[tauri::command]
pub fn get_vector_index_stats(
    state: State<AppState>,
) -> Result<serde_json::Value, CommandError> {
    let vector_index = state.vector_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire vector index lock: {}", e),
    })?;

    let stats = vector_index.stats().map_err(|e| CommandError {
        message: format!("Failed to get vector index stats: {}", e),
    })?;

    serde_json::to_value(stats).map_err(|e| CommandError {
        message: format!("Failed to serialize stats: {}", e),
    })
}

/// Generate embedding for a single text via Python.
#[tauri::command]
pub fn generate_embedding(
    state: State<AppState>,
    text: String,
    config: String,
) -> Result<Vec<f64>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai.generate_embedding(&text, &config).map_err(|e| CommandError {
        message: format!("Failed to generate embedding: {}", e),
    })
}

/// Generate embeddings for multiple texts via Python.
#[tauri::command]
pub fn generate_embeddings_batch(
    state: State<AppState>,
    texts: Vec<String>,
    config: String,
) -> Result<Vec<Vec<f64>>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();

    python_ai.generate_embeddings_batch(text_refs, &config).map_err(|e| CommandError {
        message: format!("Failed to generate embeddings: {}", e),
    })
}

/// Discover available embedding models from a provider.
#[tauri::command]
pub fn discover_embedding_models(
    state: State<AppState>,
    provider: String,
    base_url: Option<String>,
) -> Result<Vec<crate::python_bridge::DiscoveredModel>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .discover_embedding_models(&provider, base_url.as_deref())
        .map_err(|e| CommandError {
            message: format!("Failed to discover models: {}", e),
        })
}
