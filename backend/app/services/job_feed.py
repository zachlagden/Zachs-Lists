from datetime import datetime
from typing import Any

from bson import ObjectId

from app.extensions import mongo
from app.models.job import Job
from app.models.worker import Worker

CLIENT_PROJECTION = {"config_snapshot": 0}
CLAIM_ORDER = [("priority", 1), ("created_at", 1)]

QueueInfo = dict[str, int]


def database_time() -> datetime:
    local_time: datetime = mongo.db.command("hello")["localTime"]
    return local_time.replace(tzinfo=None)


def queued_jobs_with_positions() -> list[tuple[Job, QueueInfo]]:
    queued = [
        Job(document)
        for document in mongo.db[Job.COLLECTION]
        .find({"status": Job.STATUS_QUEUED}, CLIENT_PROJECTION)
        .sort(CLAIM_ORDER)
    ]
    if not queued:
        return []
    workers_alive = Worker.count_alive()
    jobs_processing = Job.count_processing()
    return [
        (
            job,
            {
                "position": position,
                "total_queued": len(queued),
                "workers_alive": workers_alive,
                "active_workers": workers_alive,
                "jobs_processing": jobs_processing,
            },
        )
        for position, job in enumerate(queued, start=1)
    ]


def queue_info_by_job() -> dict[str, QueueInfo]:
    return {job.job_id: info for job, info in queued_jobs_with_positions()}


def job_payload(job: Job, queue: dict[str, QueueInfo] | None = None) -> dict[str, Any]:
    payload = job.to_dict()
    if job.status != Job.STATUS_QUEUED:
        return payload
    if queue is None:
        queue = queue_info_by_job()
    info = queue.get(job.job_id)
    if info is not None:
        payload["queue_info"] = info
    return payload


def job_payloads(jobs: list[Job]) -> list[dict[str, Any]]:
    queue = (
        queue_info_by_job()
        if any(job.status == Job.STATUS_QUEUED for job in jobs)
        else {}
    )
    return [job_payload(job, queue) for job in jobs]


def active_job_payloads(user_id: str | None) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"status": {"$in": list(Job.ACTIVE_STATUSES)}}
    if user_id is not None:
        query["user_id"] = ObjectId(user_id)
    jobs = [
        Job(document)
        for document in mongo.db[Job.COLLECTION]
        .find(query, CLIENT_PROJECTION)
        .sort(CLAIM_ORDER)
    ]
    return job_payloads(jobs)
