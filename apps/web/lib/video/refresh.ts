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
    // Only write over the status this update was computed from: a webhook
    // or another request may have moved the video on meanwhile.
    const updated = await StreamingVideoModel.findOneAndUpdate(
        { domain: domainId, videoId, status: video.status },
        { $set: update },
        { new: true },
    );
    return (
        updated ??
        StreamingVideoModel.findOne({
            domain: domainId,
            videoId,
        })
    );
}

const STALE_AFTER_MS = 60 * 1000;
/** A ready video is re-read now and then to notice deletion at the provider. */
const READY_STALE_AFTER_MS = 60 * 60 * 1000;
const PENDING = ["uploading", "processing"];

/**
 * Refreshes a video that is still uploading or processing when it was last
 * checked more than a minute ago, or a ready one checked more than an hour
 * ago (it may have been deleted at the provider), so the editor does not
 * depend on the queue or a webhook. Concurrent callers race on
 * `lastCheckedAt`: only the request that claims the check calls the
 * provider. Returns the freshest stored record; provider failures are logged
 * and the stored record is returned.
 */
export async function refreshVideoIfStale<
    T extends { videoId: string; status: string; lastCheckedAt?: Date },
>(domainId: string, video: T, now: Date = new Date()) {
    const pending = PENDING.includes(video.status);
    if (!pending && video.status !== "ready") {
        return video;
    }
    const cutoff = new Date(
        now.getTime() - (pending ? STALE_AFTER_MS : READY_STALE_AFTER_MS),
    );
    if (video.lastCheckedAt && video.lastCheckedAt > cutoff) {
        return video;
    }
    const claimed = await StreamingVideoModel.findOneAndUpdate(
        {
            domain: domainId,
            videoId: video.videoId,
            status: pending ? { $in: PENDING } : "ready",
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
