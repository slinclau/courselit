import StreamingVideoModel from "@models/StreamingVideo";
import { applyProviderVideo, getConnector } from "@courselit/video-providers";
import { getProviderConfig } from "@/graphql/videoproviders/logic";
import { error as logError } from "@/services/logger";

/**
 * Re-reads a video from the provider that hosts it (not the active one) and
 * stores the result. Throws when the video or its provider is gone, or when
 * the provider API fails.
 */
export async function refreshVideo(domainId: string, videoId: string) {
    const video = await StreamingVideoModel.findOne({
        domain: domainId,
        videoId,
    });
    if (!video) {
        throw new Error("Video not found");
    }
    const config = await getProviderConfig(domainId, video.providerId);
    if (!config) {
        throw new Error("Video provider not found");
    }
    const providerVideo = await getConnector(config).getVideo(
        video.providerVideoId,
    );
    const update = applyProviderVideo(video, providerVideo, new Date());
    return StreamingVideoModel.findOneAndUpdate(
        { domain: domainId, videoId },
        { $set: update },
        { new: true },
    );
}

const STALE_AFTER_MS = 60 * 1000;
const PENDING = ["uploading", "processing"];

/**
 * Refreshes a video that is still uploading or processing when it was last
 * checked more than a minute ago, so the editor does not depend on the queue
 * or a webhook. Concurrent callers race on `lastCheckedAt`: only the request
 * that claims the check calls the provider. Returns the freshest stored
 * record; provider failures are logged and the stored record is returned.
 */
export async function refreshVideoIfStale<
    T extends { videoId: string; status: string; lastCheckedAt?: Date },
>(domainId: string, video: T, now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    if (
        !PENDING.includes(video.status) ||
        (video.lastCheckedAt && video.lastCheckedAt > cutoff)
    ) {
        return video;
    }
    const claimed = await StreamingVideoModel.findOneAndUpdate(
        {
            domain: domainId,
            videoId: video.videoId,
            status: { $in: PENDING },
            $or: [
                { lastCheckedAt: { $exists: false } },
                { lastCheckedAt: { $lt: cutoff } },
            ],
        },
        { $set: { lastCheckedAt: now } },
    );
    if (!claimed) {
        return video;
    }
    try {
        return (await refreshVideo(domainId, video.videoId)) ?? video;
    } catch (err: any) {
        logError("Streaming video refresh failed", {
            videoId: video.videoId,
            err: err?.message,
        });
        return video;
    }
}
