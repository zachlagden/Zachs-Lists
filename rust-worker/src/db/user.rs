use anyhow::Result;
use bson::{doc, oid::ObjectId, Bson, DateTime as BsonDateTime, Document};
use mongodb::error::{ErrorKind, WriteFailure};
use mongodb::options::ReturnDocument;
use mongodb::{Collection, Database};

use crate::config::DEFAULT_TARGET;

const DEFAULT_BUILD_DOCUMENT_ID: &str = "default_build";
const DUPLICATE_KEY_ERROR_CODE: i32 = 11000;

#[derive(Debug, Clone, PartialEq)]
pub struct ListMetadata {
    pub name: String,
    pub is_public: bool,
    pub formats: Vec<String>,
    pub domain_count: u64,
    pub last_updated: BsonDateTime,
}

#[derive(Debug, Clone, Copy)]
pub struct Target<'a> {
    pub username: &'a str,
    pub user_id: Option<ObjectId>,
}

impl Target<'_> {
    fn is_default(&self) -> bool {
        self.username == DEFAULT_TARGET
    }

    fn filter(&self) -> Document {
        if self.is_default() {
            return doc! { "_id": DEFAULT_BUILD_DOCUMENT_ID };
        }
        let mut filter = doc! { "username": self.username };
        if let Some(user_id) = self.user_id {
            filter.insert("_id", user_id);
        }
        filter
    }
}

#[derive(Debug, Clone)]
pub struct Publication<'a> {
    pub generation_id: &'a str,
    pub job_id: &'a str,
    pub job_created_at: BsonDateTime,
    pub attempt: i64,
    pub inputs_digest: &'a str,
    pub lists: &'a [ListMetadata],
    pub total_domains: u64,
    pub total_output_size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublishOutcome {
    Published { replaced: Option<String> },
    Superseded,
    TargetMissing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedState {
    pub generation_id: String,
    pub inputs_digest: Option<String>,
}

fn is_duplicate_key(error: &mongodb::error::Error) -> bool {
    matches!(
        error.kind.as_ref(),
        ErrorKind::Write(WriteFailure::WriteError(write)) if write.code == DUPLICATE_KEY_ERROR_CODE
    )
}

pub struct UserRepository {
    users: Collection<Document>,
    system_config: Collection<Document>,
}

impl UserRepository {
    pub fn new(db: &Database) -> Self {
        Self {
            users: db.collection("users"),
            system_config: db.collection("system_config"),
        }
    }

    fn collection(&self, target: &Target<'_>) -> &Collection<Document> {
        if target.is_default() {
            &self.system_config
        } else {
            &self.users
        }
    }

    pub async fn published_state(&self, target: &Target<'_>) -> Result<Option<PublishedState>> {
        let stored = self
            .collection(target)
            .find_one(target.filter())
            .projection(doc! { "published_generation": 1, "published.inputs_digest": 1 })
            .await?;
        let Some(stored) = stored else {
            return Ok(None);
        };
        let Ok(generation_id) = stored.get_str("published_generation") else {
            return Ok(None);
        };
        let inputs_digest = stored
            .get_document("published")
            .ok()
            .and_then(|published| published.get_str("inputs_digest").ok())
            .map(String::from);
        Ok(Some(PublishedState {
            generation_id: generation_id.to_string(),
            inputs_digest,
        }))
    }

    async fn ensure_default_build_document(&self) -> Result<()> {
        let created = self
            .system_config
            .update_one(
                doc! { "_id": DEFAULT_BUILD_DOCUMENT_ID },
                doc! { "$setOnInsert": { "published_generation": Bson::Null } },
            )
            .upsert(true)
            .await;
        match created {
            Ok(_) => Ok(()),
            Err(error) if is_duplicate_key(&error) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn pointer_update(target: &Target<'_>, publication: &Publication<'_>) -> Document {
        let now = BsonDateTime::now();
        let lists: Vec<Document> = publication
            .lists
            .iter()
            .map(|list| {
                doc! {
                    "name": &list.name,
                    "is_public": list.is_public,
                    "formats": &list.formats,
                    "domain_count": list.domain_count as i64,
                    "last_updated": list.last_updated,
                }
            })
            .collect();
        let mut set = doc! {
            "published_generation": publication.generation_id,
            "published": {
                "job_id": publication.job_id,
                "job_created_at": publication.job_created_at,
                "attempt": publication.attempt,
                "inputs_digest": publication.inputs_digest,
                "published_at": now,
            },
            "lists": lists,
        };
        let total_domains = publication.total_domains as i64;
        let total_output_size_bytes = publication.total_output_size_bytes as i64;
        if target.is_default() {
            set.insert("total_domains", total_domains);
            set.insert("total_output_size_bytes", total_output_size_bytes);
            set.insert("last_build_at", now);
            return doc! { "$set": set, "$unset": { "config_fingerprint": "" } };
        }
        set.insert("stats.total_domains", total_domains);
        set.insert("stats.total_output_size_bytes", total_output_size_bytes);
        set.insert("stats.last_build_at", now);
        set.insert("updated_at", now);
        doc! {
            "$set": set,
            "$unset": { "stats.config_hash": "", "stats.config_fingerprint": "" },
        }
    }

    pub async fn publish(
        &self,
        target: &Target<'_>,
        publication: &Publication<'_>,
    ) -> Result<PublishOutcome> {
        if target.is_default() {
            self.ensure_default_build_document().await?;
        }
        let mut only_forward = target.filter();
        only_forward.insert(
            "$or",
            vec![
                doc! { "published": Bson::Null },
                doc! { "published.job_created_at": { "$lt": publication.job_created_at } },
                doc! {
                    "published.job_created_at": publication.job_created_at,
                    "published.attempt": { "$lt": publication.attempt },
                },
            ],
        );
        let collection = self.collection(target);
        let before = collection
            .find_one_and_update(only_forward, Self::pointer_update(target, publication))
            .projection(doc! { "published_generation": 1 })
            .return_document(ReturnDocument::Before)
            .await?;
        if let Some(before) = before {
            return Ok(PublishOutcome::Published {
                replaced: before
                    .get_str("published_generation")
                    .ok()
                    .map(String::from),
            });
        }
        let target_exists = collection
            .find_one(target.filter())
            .projection(doc! { "_id": 1 })
            .await?
            .is_some();
        Ok(if target_exists {
            PublishOutcome::Superseded
        } else {
            PublishOutcome::TargetMissing
        })
    }
}
