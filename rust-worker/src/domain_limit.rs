use crate::db::progress::LimitMeasurement;

const SETTING_VALUES_THAT_ENFORCE: [&str; 4] = ["1", "true", "yes", "on"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LimitVerdict {
    Within,
    OverButObserved { warning: String },
    OverAndEnforced { error: String },
}

pub fn is_enforced(configured: Option<&str>) -> bool {
    configured.is_some_and(|value| {
        SETTING_VALUES_THAT_ENFORCE.contains(&value.trim().to_lowercase().as_str())
    })
}

pub fn judge(measured: &LimitMeasurement, enforced: bool) -> LimitVerdict {
    let Some(max_domains) = measured.max_domains else {
        return LimitVerdict::Within;
    };
    if !measured.is_over() {
        return LimitVerdict::Within;
    }
    let over = format!(
        "These lists have {} domains across all categories, which is over the limit of {}",
        grouped(measured.actual_domains),
        grouped(max_domains)
    );
    if enforced {
        LimitVerdict::OverAndEnforced {
            error: format!(
                "{over}, so nothing was published and the previously published lists remain in place."
            ),
        }
    } else {
        LimitVerdict::OverButObserved {
            warning: format!(
                "{over}, and builds over the limit will fail once the limit is enforced."
            ),
        }
    }
}

pub fn too_many_sources(sources: usize, max_source_lists: Option<u64>) -> Option<String> {
    let max_source_lists = max_source_lists?;
    let sources = sources as u64;
    (sources > max_source_lists).then(|| {
        format!(
            "The configuration has {} sources, which is more than the limit of {}.",
            grouped(sources),
            grouped(max_source_lists)
        )
    })
}

fn grouped(number: u64) -> String {
    let digits = number.to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (position, digit) in digits.chars().enumerate() {
        if position > 0 && (digits.len() - position).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../../tests/fixtures/domain-limit.json")).unwrap()
    }

    fn measured(max_domains: Option<u64>, actual_domains: u64) -> LimitMeasurement {
        LimitMeasurement {
            max_domains,
            actual_domains,
        }
    }

    #[test]
    fn setting_enforces_only_for_the_values_in_the_shared_fixture() {
        let setting = &fixture()["enforcement_setting"];
        assert!(!is_enforced(None));
        for value in setting["on"].as_array().unwrap() {
            assert!(is_enforced(value.as_str()), "{value}");
        }
        for value in setting["off"].as_array().unwrap() {
            assert!(!is_enforced(value.as_str()), "{value}");
        }
    }

    #[test]
    fn over_the_limit_fails_when_enforced_and_warns_when_observed() {
        let case = &fixture()["over_limit"];
        let limit: LimitMeasurement = serde_json::from_value(case["limit"].clone()).unwrap();

        assert_eq!(
            judge(&limit, true),
            LimitVerdict::OverAndEnforced {
                error: case["error"].as_str().unwrap().to_string()
            }
        );
        assert_eq!(
            judge(&limit, false),
            LimitVerdict::OverButObserved {
                warning: case["warning"].as_str().unwrap().to_string()
            }
        );
    }

    #[test]
    fn exactly_at_the_limit_is_within_it() {
        assert_eq!(judge(&measured(Some(10), 10), true), LimitVerdict::Within);
        assert_eq!(judge(&measured(Some(10), 9), true), LimitVerdict::Within);
        assert!(matches!(
            judge(&measured(Some(10), 11), true),
            LimitVerdict::OverAndEnforced { .. }
        ));
    }

    #[test]
    fn missing_limit_never_fails() {
        assert_eq!(judge(&measured(None, u64::MAX), true), LimitVerdict::Within);
        assert_eq!(
            judge(&measured(None, u64::MAX), false),
            LimitVerdict::Within
        );
    }

    #[test]
    fn source_count_is_refused_only_above_a_known_limit() {
        let case = &fixture()["too_many_sources"];
        let sources = case["sources"].as_u64().unwrap() as usize;
        let max_source_lists = case["max_source_lists"].as_u64();

        assert_eq!(
            too_many_sources(sources, max_source_lists).as_deref(),
            case["error"].as_str()
        );
        assert_eq!(too_many_sources(10, Some(10)), None);
        assert_eq!(too_many_sources(1_000_000, None), None);
    }

    #[test]
    fn numbers_are_grouped_in_thousands() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(1_000), "1,000");
        assert_eq!(grouped(12_345_678), "12,345,678");
    }
}
