use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const WORK_GRAIN: usize = 8192;

#[derive(Debug, thiserror::Error)]
#[error("job cancelled")]
pub struct Cancelled;

#[derive(Debug, Clone, Default)]
pub struct Cancellation {
    cancelled: Arc<AtomicBool>,
}

impl Cancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> Result<(), Cancelled> {
        if self.is_cancelled() {
            Err(Cancelled)
        } else {
            Ok(())
        }
    }
}
