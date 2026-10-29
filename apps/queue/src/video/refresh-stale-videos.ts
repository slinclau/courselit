import { applyProviderVideo, getConnector } from "@courselit/video-providers";
import { generateUniqueId } from "@courselit/utils";
import type { ProviderVideo } from "@courselit/common-models";
import StreamingVideoModel from "../domain/model/streaming-video";
import { logger } from "../logger";
import { loadAllProviders, LoadedProvider } from "./load-providers";

const STALE_AFTER_MS = 5 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_LIST_PAGES = 1000;
const IMPORTED_BY = "system";

interface Result {
    refreshed: number;
    failed: number;
    imported: number;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function refreshProviderVideos(
    provider: LoadedProvider,
    connector: ReturnType<typeof getConnector>,
    now: Date,
    result: Result,
) {
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
    const uploadDeadline = new Date(now.getTime() - UPLOAD_TIMEOUT_MS);
    const stale = await StreamingVideoModel.find({
        domain: provider.domain,
        providerId: provider.providerId,
        status: { $in: ["uploading", "processing"] },
        $or: [
            { lastCheckedAt: { $exists: false } },
            { lastCheckedAt: null },
            { lastCheckedAt: { $lt: staleBefore } },
        ],
    }).lean();

    for (const video of stale as any[]) {
        try {
            const providerVideo = await connector.getVideo(
                video.providerVideoId,
            );
            let update: Record<string, any> = applyProviderVideo(
                video,
                providerVideo,
                now,
            );
            if (
                providerVideo?.status === "uploading" &&
                video.createdAt &&
                new Date(video.createdAt) < uploadDeadline
            ) {
                update = {
                    status: "error",
                    errorMessage: "Upload did not complete",
                    lastCheckedAt: now,
                };
            }
            await StreamingVideoModel.updateOne(
                { _id: video._id },
                { $set: update },
            );
            result.refreshed++;
        } catch (err) {
            result.failed++;
            logger.error(
                `refresh-stale-videos: provider ${provider.providerId} video ${video.videoId}: ${errorMessage(err)}`,
            );
        }
    }
}

async function importUnknownVideos(
    provider: LoadedProvider,
    connector: ReturnType<typeof getConnector>,
    now: Date,
    result: Result,
) {
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const { items, hasMore } = await connector.listVideos({ page });
        for (const item of items as ProviderVideo[]) {
            // Possibly a live upload whose record is not stored yet; it is
            // imported on a later run once it moved on.
            if (item.status === "uploading") {
                continue;
            }
            const res = await StreamingVideoModel.updateOne(
                {
                    domain: provider.domain,
                    providerId: provider.providerId,
                    providerVideoId: item.providerVideoId,
                },
                {
                    $setOnInsert: {
                        videoId: generateUniqueId(),
                        courseId: null,
                        title: item.title,
                        status: item.status,
                        durationSeconds: item.durationSeconds,
                        thumbnailUrl: item.thumbnailUrl,
                        createdBy: IMPORTED_BY,
                        lastCheckedAt: now,
                        ...(item.status === "ready" ? { readyAt: now } : {}),
                    },
                },
                { upsert: true },
            );
            if (res.upsertedCount) {
                result.imported++;
            }
        }
        if (!hasMore) {
            break;
        }
    }
}

/**
 * Safety net for missed webhooks: re-reads stale in-flight videos from their
 * hosting provider and imports provider videos we do not know about. Never
 * deletes anything, in the database or at a provider.
 */
export async function refreshStaleVideos(now: Date): Promise<Result> {
    const result: Result = { refreshed: 0, failed: 0, imported: 0 };
    const providers = await loadAllProviders();

    for (const provider of providers) {
        try {
            const connector = getConnector(provider.config);
            await refreshProviderVideos(provider, connector, now, result);
            await importUnknownVideos(provider, connector, now, result);
        } catch (err) {
            result.failed++;
            logger.error(
                `refresh-stale-videos: provider ${provider.providerId}: ${errorMessage(err)}`,
            );
        }
    }
    return result;
}
