import { Worker } from "bullmq";
import { logger } from "../logger";
import { captureError, getDomainId } from "../observability/posthog";
import { registerWorkerEvents, workerOptions } from "../bullmq";
import { refreshStaleVideos } from "./refresh-stale-videos";

export function startVideoWorker() {
    const worker = new Worker(
        "video",
        async (job) => {
            if (job.name !== "refresh-stale-videos") {
                return;
            }
            try {
                const result = await refreshStaleVideos(new Date());
                logger.info(result, "refresh-stale-videos finished");
                return result;
            } catch (err: any) {
                logger.error(err);
                captureError({
                    error: err,
                    source: "worker.video",
                    domainId: getDomainId(),
                    context: {
                        queue_name: "video",
                        job_id: String(job.id),
                    },
                });
                throw err;
            }
        },
        workerOptions,
    );

    registerWorkerEvents(worker, "video");

    return worker;
}
