mod config;
mod db;
mod downloader;
mod extractor;
mod generator;
mod processor;
mod safe_http;
#[cfg(test)]
mod source_contract_tests;
mod whitelist;
mod worker;

use anyhow::Result;
use mongodb::{Client, Database};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tracing::{error, info, warn, Level};
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
    let db = connect_with_retry(&config).await?;

    // Clean up stale cache on startup
    info!("Cleaning up stale cache entries...");
    let downloader = downloader::Downloader::new(config.clone(), &db)?;
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

async fn ping_database(config: &Config) -> Result<Database> {
    let client = Client::with_uri_str(&config.mongo_uri).await?;
    let db = client.database(&config.database_name);
    db.run_command(bson::doc! { "ping": 1 }).await?;
    Ok(db)
}

async fn connect_with_retry(config: &Config) -> Result<Database> {
    info!("Connecting to MongoDB");

    let deadline = Instant::now() + Duration::from_secs(config.mongo_connect_timeout_secs);
    let max_backoff = Duration::from_secs(15);
    let mut backoff = Duration::from_secs(1);

    loop {
        match ping_database(config).await {
            Ok(db) => {
                info!("Connected to MongoDB database: {}", config.database_name);
                return Ok(db);
            }
            Err(_) if Instant::now() + backoff < deadline => {
                warn!("MongoDB not reachable yet, retrying in {:?}", backoff);
                sleep(backoff).await;
                backoff = (backoff * 2).min(max_backoff);
            }
            Err(e) => {
                error!(
                    "MongoDB unreachable after {}s, giving up: {}",
                    config.mongo_connect_timeout_secs, e
                );
                return Err(e);
            }
        }
    }
}
