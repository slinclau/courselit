import {
    applyProviderVideo,
    findVideosMissingAtProvider,
    getConnector,
} from "@courselit/video-providers";
import { generateUniqueId } from "@courselit/utils";
import type { ProviderVideo } from "@courselit/common-models";
import StreamingVideoModel from "../domain/model/streaming-video";
import { logger } from "../logger";
import { loadAllProviders, LoadedProvider } from "./load-providers";

const STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_LIST_PAGES = 1000;
const IMPORTED_BY = "system";

interface Result {
    refreshed: number;
    failed: number;
    imported: number;
    missing: number;
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
            // Also turns uploads not finished after 24 h into errors.
            const update = applyProviderVideo(video, providerVideo, now);
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

/**
 * Pages through the provider listing and imports videos we do not know.
 * Returns every listed id, and whether the listing reached its last page
 * (not cut off by the page cap). A failing page throws.
 */
async function importUnknownVideos(
    provider: LoadedProvider,
    connector: ReturnType<typeof getConnector>,
    now: Date,
    result: Result,
): Promise<{ providerVideoIds: Set<string>; complete: boolean }> {
    const providerVideoIds = new Set<string>();
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const { items, hasMore } = await connector.listVideos({ page });
        for (const item of items as ProviderVideo[]) {
            providerVideoIds.add(item.providerVideoId);
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
            return { providerVideoIds, complete: true };
        }
    }
    return { providerVideoIds, complete: false };
}

/**
 * Marks ready videos that a complete provider listing no longer contains
 * (deleted at the provider) as errors. Never deletes anything.
 */
async function markVideosMissingAtProvider(
    provider: LoadedProvider,
    listing: { providerVideoIds: Set<string>; complete: boolean },
    listingStartedAt: Date,
    now: Date,
    result: Result,
) {
    if (!listing.complete) {
        return;
    }
    const filter = {
        domain: provider.domain,
        providerId: provider.providerId,
        status: "ready",
    };
    const stored = await StreamingVideoModel.find(filter, {
        videoId: 1,
        providerVideoId: 1,
        status: 1,
        createdAt: 1,
        readyAt: 1,
    }).lean();
    const missing = findVideosMissingAtProvider({
        stored: stored as any[],
        providerVideoIds: listing.providerVideoIds,
        listingComplete: listing.complete,
        listingStartedAt,
    });
    if (!missing.length) {
        return;
    }
    const res = await StreamingVideoModel.updateMany(
        { ...filter, videoId: { $in: missing } },
        { $set: applyProviderVideo({ status: "ready" }, null, now) },
    );
    result.missing += res.modifiedCount;
    logger.info(
        `refresh-stale-videos: provider ${provider.providerId}: ${res.modifiedCount} video(s) not found at provider`,
    );
}

/**
 * Safety net for missed webhooks: re-reads stale in-flight videos from their
 * hosting provider, imports provider videos we do not know about and marks
 * ready videos the provider no longer lists as errors. Never deletes
 * anything, in the database or at a provider.
 */
export async function refreshStaleVideos(now: Date): Promise<Result> {
    const result: Result = {
        refreshed: 0,
        failed: 0,
        imported: 0,
        missing: 0,
    };
    const providers = await loadAllProviders();

    for (const provider of providers) {
        try {
            const connector = getConnector(provider.config);
            await refreshProviderVideos(provider, connector, now, result);
            // Real clock: compared with the stored createdAt timestamps.
            const listingStartedAt = new Date();
            const listing = await importUnknownVideos(
                provider,
                connector,
                now,
                result,
            );
            await markVideosMissingAtProvider(
                provider,
                listing,
                listingStartedAt,
                now,
                result,
            );
        } catch (err) {
            result.failed++;
            logger.error(
                `refresh-stale-videos: provider ${provider.providerId}: ${errorMessage(err)}`,
            );
        }
    }
    return result;
}
