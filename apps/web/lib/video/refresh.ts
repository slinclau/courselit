import StreamingVideoModel from "@models/StreamingVideo";
import {
    applyProviderVideo,
    getConnector,
    VIDEO_NOT_FOUND_AT_PROVIDER,
} from "@courselit/video-providers";
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
        {
            $set: update,
            // A video that recovered no longer carries its old error.
            ...(update.status && update.status !== "error"
                ? { $unset: { errorMessage: 1 } }
                : {}),
        },
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
/**
 * A ready video, or one marked as not found at the provider, is re-read now
 * and then to notice a deletion at the provider, or that it is back.
 */
const SETTLED_STALE_AFTER_MS = 60 * 60 * 1000;
const PENDING = ["uploading", "processing"];

/** The stored state a due check is claimed on, or null if none is due. */
function staleCheckFilter(
    video: { status: string; errorMessage?: string },
    now: Date,
) {
    const after = (ms: number) => ({
        cutoff: new Date(now.getTime() - ms),
    });
    if (PENDING.includes(video.status)) {
        return { status: { $in: PENDING }, ...after(STALE_AFTER_MS) };
    }
    if (video.status === "ready") {
        return { status: "ready", ...after(SETTLED_STALE_AFTER_MS) };
    }
    if (
        video.status === "error" &&
        video.errorMessage === VIDEO_NOT_FOUND_AT_PROVIDER
    ) {
        return {
            status: "error",
            errorMessage: VIDEO_NOT_FOUND_AT_PROVIDER,
            ...after(SETTLED_STALE_AFTER_MS),
        };
    }
    return null;
}

/**
 * Refreshes a video that is still uploading or processing when it was last
 * checked more than a minute ago, or a ready or not-found one checked more
 * than an hour ago (it may have been deleted at the provider, or be back),
 * so the editor does not depend on the queue or a webhook. Concurrent
 * callers race on `lastCheckedAt`: only the request that claims the check
 * calls the provider. Returns the freshest stored record; provider failures
 * are logged and the stored record is returned.
 */
export async function refreshVideoIfStale<
    T extends {
        videoId: string;
        status: string;
        errorMessage?: string;
        lastCheckedAt?: Date;
    },
>(domainId: string, video: T, now: Date = new Date()) {
    const due = staleCheckFilter(video, now);
    if (!due || (video.lastCheckedAt && video.lastCheckedAt > due.cutoff)) {
        return video;
    }
    const { cutoff, ...state } = due;
    const claimed = await StreamingVideoModel.findOneAndUpdate(
        {
            domain: domainId,
            videoId: video.videoId,
            ...state,
            $or: [
                { lastCheckedAt: { $exists: false } },
                { lastCheckedAt: { $lt: cutoff } },
                { lastCheckedAt: null },
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
