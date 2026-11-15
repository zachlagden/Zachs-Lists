use crate::downloader::Downloader;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    config: String,
    valid: bool,
    sources: Option<usize>,
}

#[test]
fn shared_configuration_contract() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(include_str!("../../tests/fixtures/source-configs.json"))
            .expect("valid shared fixtures");
    for fixture in fixtures {
        let parsed = Downloader::parse_config(&fixture.config);
        assert_eq!(parsed.is_ok(), fixture.valid, "{}", fixture.config);
        if let Some(expected) = fixture.sources {
            assert_eq!(parsed.expect("valid fixture configuration").len(), expected);
        }
    }
}

#[test]
fn fourth_field_sets_the_abp_flag_on_that_source_only() {
    let sources = Downloader::parse_config(
        "https://example.com/one|First|tracking| abp \nhttps://example.com/two|Second|tracking",
    )
    .expect("valid configuration");
    let flags: Vec<bool> = sources.iter().map(|source| source.abp).collect();
    assert_eq!(flags, [true, false]);
}
