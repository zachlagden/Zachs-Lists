use super::*;
use bson::Bson;

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/job-progress.json")).unwrap()
}

fn stored_as_json<T: Serialize>(value: &T) -> serde_json::Value {
    Bson::Document(bson::to_document(value).unwrap()).into_relaxed_extjson()
}

fn collect_timestamps(value: &serde_json::Value, key: &str, found: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(fields) => {
            for (name, nested) in fields {
                collect_timestamps(nested, name, found);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_timestamps(item, key, found);
            }
        }
        serde_json::Value::String(text) if key.ends_with("_at") => found.push(text.clone()),
        _ => {}
    }
}

fn assert_utc_milliseconds(stamp: &str) {
    let parsed = chrono::DateTime::parse_from_rfc3339(stamp).unwrap();
    assert_eq!(
        parsed
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        stamp
    );
}

#[test]
fn fixture_documents_keep_every_key_and_value_through_the_worker_types() {
    let fixture = fixture();
    let documents = fixture.as_object().unwrap();
    assert_eq!(
        documents
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>(),
        std::collections::BTreeSet::from(["completed", "mid_download", "mid_generation"])
    );

    for (name, document) in documents {
        let progress: JobProgress = serde_json::from_value(document["progress"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(&progress).unwrap(),
            document["progress"],
            "{name}"
        );
        assert_eq!(stored_as_json(&progress), document["progress"], "{name}");
        let read_back: JobProgress =
            bson::from_document(bson::to_document(&progress).unwrap()).unwrap();
        assert_eq!(read_back, progress, "{name}");

        if document["result"].is_null() {
            continue;
        }
        let result: JobResult = serde_json::from_value(document["result"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            document["result"],
            "{name}"
        );
        assert_eq!(stored_as_json(&result), document["result"], "{name}");
    }
}

#[test]
fn fixture_timestamps_are_utc_with_milliseconds() {
    let mut stamps = Vec::new();
    collect_timestamps(&fixture(), "", &mut stamps);
    assert!(stamps.len() > 20);
    for stamp in stamps {
        assert_utc_milliseconds(&stamp);
    }
}

#[test]
fn stage_changes_write_utc_millisecond_timestamps_and_keep_every_key() {
    let mut progress = JobProgress::downloading(vec![SourceProgress::pending(
        "a".repeat(64),
        "first_list".into(),
        "https://lists.example.com/first.txt".into(),
        Some("advertising".into()),
    )]);
    progress.enter_whitelist(10, 2).unwrap();
    progress
        .enter_generation(GenerationProgress::pending(6, 20))
        .unwrap();
    progress.mark_completed().unwrap();

    let written = serde_json::to_value(&progress).unwrap();
    let mut stamps = Vec::new();
    collect_timestamps(&written, "", &mut stamps);
    assert_eq!(stamps.len(), 10);
    for stamp in stamps {
        assert_utc_milliseconds(&stamp);
    }

    let completed = &fixture()["completed"]["progress"];
    let keys = |value: &serde_json::Value| -> std::collections::BTreeSet<String> {
        value.as_object().unwrap().keys().cloned().collect()
    };
    assert_eq!(keys(&written), keys(completed));
    assert_eq!(keys(&written["sources"][0]), keys(&completed["sources"][0]));
    assert_eq!(keys(&written["whitelist"]), keys(&completed["whitelist"]));
    assert_eq!(keys(&written["generation"]), keys(&completed["generation"]));
    assert_eq!(
        keys(&written["generation"]["formats"][0]),
        keys(&completed["generation"]["formats"][0])
    );
    assert_eq!(keys(&written["stages"]), keys(&completed["stages"]));
    assert_eq!(
        keys(&written["stage_snapshots"]),
        keys(&completed["stage_snapshots"])
    );
    assert_eq!(
        keys(&serde_json::to_value(JobResult::skipped("unchanged")).unwrap()),
        keys(&fixture()["completed"]["result"])
    );
}
