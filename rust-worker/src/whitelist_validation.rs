use crate::whitelist::{
    PatternCounts, WhitelistManager, WhitelistProblem, WhitelistProblemCode, MAX_REPORTED_PROBLEMS,
    MAX_WHITELIST_BYTES,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{self, Read, Write};

pub const SUBCOMMAND: &str = "validate-whitelist";
pub const EXIT_VALID: u8 = 0;
pub const EXIT_INVALID: u8 = 1;
pub const EXIT_FAILURE: u8 = 2;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct WhitelistValidationResult {
    pub valid: bool,
    pub patterns: PatternCounts,
    pub errors: Vec<WhitelistProblem>,
    pub error_counts: BTreeMap<WhitelistProblemCode, usize>,
}

impl WhitelistValidationResult {
    fn from_problems(patterns: PatternCounts, mut problems: Vec<WhitelistProblem>) -> Self {
        let mut error_counts = BTreeMap::new();
        for problem in &problems {
            *error_counts.entry(problem.code).or_insert(0) += 1;
        }
        problems.truncate(MAX_REPORTED_PROBLEMS);
        Self {
            valid: problems.is_empty(),
            patterns,
            errors: problems,
            error_counts,
        }
    }

    fn rejected_input(code: WhitelistProblemCode) -> Self {
        Self::from_problems(
            PatternCounts::default(),
            vec![WhitelistProblem::for_input(code)],
        )
    }
}

pub fn validate_content(content: &str) -> WhitelistValidationResult {
    if content.len() > MAX_WHITELIST_BYTES {
        return WhitelistValidationResult::rejected_input(WhitelistProblemCode::InputTooLarge);
    }
    let parsed = WhitelistManager::parse(content);
    WhitelistValidationResult::from_problems(parsed.whitelist.pattern_counts(), parsed.problems)
}

pub fn validate_reader(input: impl Read) -> io::Result<WhitelistValidationResult> {
    let mut bytes = Vec::new();
    input
        .take((MAX_WHITELIST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_WHITELIST_BYTES {
        return Ok(WhitelistValidationResult::rejected_input(
            WhitelistProblemCode::InputTooLarge,
        ));
    }
    Ok(match std::str::from_utf8(&bytes) {
        Ok(content) => validate_content(content),
        Err(_) => WhitelistValidationResult::rejected_input(WhitelistProblemCode::InvalidUtf8),
    })
}

pub fn run(input: impl Read, mut output: impl Write) -> io::Result<u8> {
    let result = validate_reader(input)?;
    serde_json::to_writer(&mut output, &result)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(if result.valid {
        EXIT_VALID
    } else {
        EXIT_INVALID
    })
}

pub fn run_subcommand(extra_arguments: &[String]) -> u8 {
    if !extra_arguments.is_empty() {
        eprintln!("usage: blocklist-worker {SUBCOMMAND} < whitelist.txt");
        return EXIT_FAILURE;
    }
    match run(io::stdin().lock(), io::stdout().lock()) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("whitelist validation failed: {error}");
            EXIT_FAILURE
        }
    }
}
