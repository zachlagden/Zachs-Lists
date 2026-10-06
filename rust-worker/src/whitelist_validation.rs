use crate::whitelist::{
    WhitelistErrorCode, WhitelistManager, WhitelistValidationError, WhitelistValidationFailure,
    MAX_WHITELIST_BYTES,
};
use serde::Serialize;
use std::io::{self, Read, Write};

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct WhitelistValidationResult {
    pub valid: bool,
    pub validated_count: usize,
    pub errors: Vec<WhitelistValidationError>,
}

impl From<WhitelistValidationFailure> for WhitelistValidationResult {
    fn from(failure: WhitelistValidationFailure) -> Self {
        Self {
            valid: false,
            validated_count: failure.validated_count,
            errors: failure.errors,
        }
    }
}

impl WhitelistValidationResult {
    fn input_error(code: WhitelistErrorCode) -> Self {
        Self {
            valid: false,
            validated_count: 0,
            errors: vec![WhitelistValidationError::new(None, code)],
        }
    }
}

pub fn validate_content(content: &str) -> WhitelistValidationResult {
    match WhitelistManager::try_from_content(content) {
        Ok(manager) => WhitelistValidationResult {
            valid: true,
            validated_count: manager.pattern_count(),
            errors: Vec::new(),
        },
        Err(failure) => failure.into(),
    }
}

pub fn validate_reader(input: impl Read) -> WhitelistValidationResult {
    let mut bytes = Vec::new();
    if input
        .take((MAX_WHITELIST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return WhitelistValidationResult::input_error(WhitelistErrorCode::InputReadFailed);
    }
    if bytes.len() > MAX_WHITELIST_BYTES {
        return WhitelistValidationResult::input_error(WhitelistErrorCode::InputTooLarge);
    }
    match std::str::from_utf8(&bytes) {
        Ok(content) => validate_content(content),
        Err(_) => WhitelistValidationResult::input_error(WhitelistErrorCode::InvalidUtf8),
    }
}

pub fn run(input: impl Read, mut output: impl Write) -> io::Result<i32> {
    let result = validate_reader(input);
    serde_json::to_writer(&mut output, &result)?;
    output.write_all(b"\n")?;
    Ok(if result.valid { 0 } else { 2 })
}
