mod config;
mod db;
mod downloader;
mod extractor;
mod generator;
mod processor;
mod whitelist;
mod worker;

use anyhow::Result;
use mongodb::Client;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{error, info, Level};
use tracing_subscriber::FmtSubscriber;

use config::Config;
use worker::Worker;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .with_thread_ids(false)
        .compact()
        .init();

    info!("Blocklist Worker starting...");

    // Load .env file from project root (parent directory)
    // Try multiple locations for the .env file
    let env_paths = [
        Path::new("../.env"),           // If running from rust-worker/
        Path::new(".env"),              // If running from project root
        Path::new("../../.env"),        // If running from rust-worker/target/release/
    ];

    for path in env_paths {
        if path.exists() {
            match dotenvy::from_path(path) {
                Ok(_) => {
                    info!("Loaded environment from {:?}", path);
                    break;
                }
                Err(e) => {
                    error!("Failed to load .env from {:?}: {}", path, e);
                }
            }
        }
    }

    // Load configuration
    let config = Config::from_env();
    info!("Worker ID: {}", config.worker_id);
    info!("Data directory: {:?}", config.data_dir);

    // Setup shutdown signal handling
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);

    ctrlc::set_handler(move || {
        info!("Received shutdown signal");
        shutdown_clone.store(true, Ordering::Relaxed);
    })?;

    // Connect to MongoDB
    info!("Connecting to MongoDB at {}", config.mongo_uri);
    let client = Client::with_uri_str(&config.mongo_uri).await?;
    let db = client.database(&config.database_name);

    // Verify connection
    db.run_command(bson::doc! { "ping": 1 }).await?;
    info!("Connected to MongoDB database: {}", config.database_name);

    // Clean up stale cache on startup
    info!("Cleaning up stale cache entries...");
    let downloader = downloader::Downloader::new(config.clone())?;
    match downloader.cleanup_cache().await {
        Ok(cleaned) => {
            if cleaned > 0 {
                info!("Cleaned up {} stale cache entries", cleaned);
            }
        }
        Err(e) => {
            error!("Cache cleanup failed: {}", e);
        }
    }

    // Create and run worker
    let worker = Worker::new(config, db, shutdown);

    if let Err(e) = worker.run().await {
        error!("Worker error: {}", e);
        return Err(e);
    }

    info!("Worker shutdown complete");
    Ok(())
}
