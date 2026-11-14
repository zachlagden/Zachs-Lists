//! Published allowlists are written by the API, not the blocklist pipeline.
//!
//! The list name matches `ALLOWLIST_NAME` in `backend/app/allowlist.py`.
//! Copy-on-match must not delete or copy these files: publication is opt-in
//! and is not part of the blocklist fingerprint.

pub const ALLOWLIST_NAME: &str = "allowlist";

pub fn is_allowlist_artifact(filename: &str) -> bool {
    let name = file_name(filename);
    name.starts_with(&format!("{ALLOWLIST_NAME}_"))
        && (name.ends_with(".txt.gz") || name.ends_with(".txt"))
}

pub fn is_blocklist_artifact(filename: &str) -> bool {
    let name = file_name(filename);
    name.ends_with(".txt.gz") && !is_allowlist_artifact(name)
}

pub fn is_blocklist_list_name(name: &str) -> bool {
    name != ALLOWLIST_NAME
}

fn file_name(filename: &str) -> &str {
    filename.rsplit(['/', '\\']).next().unwrap_or(filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_artifacts_are_not_blocklist_outputs() {
        assert!(is_allowlist_artifact("allowlist_adblock.txt.gz"));
        assert!(is_allowlist_artifact("allowlist_plain.txt.gz"));
        assert!(is_allowlist_artifact(
            "/data/users/sam/output/allowlist_adblock.txt.gz"
        ));
        assert!(!is_allowlist_artifact("all_domains_hosts.txt.gz"));
        assert!(!is_allowlist_artifact("all_domains_adblock.txt.gz"));
        assert!(!is_allowlist_artifact("advertising_hosts.txt.gz"));
        assert!(!is_blocklist_artifact("allowlist_adblock.txt.gz"));
        assert!(is_blocklist_artifact("all_domains_hosts.txt.gz"));
        assert!(!is_blocklist_artifact("allowlist_adblock.txt"));
    }

    #[test]
    fn allowlist_is_not_a_blocklist_category_name() {
        assert!(!is_blocklist_list_name(ALLOWLIST_NAME));
        assert!(is_blocklist_list_name("all_domains"));
        assert!(is_blocklist_list_name("advertising"));
    }
}
