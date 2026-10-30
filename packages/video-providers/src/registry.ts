import type {
    MissingAtProviderCheck,
    ProviderConfig,
    ProviderVideo,
    StreamingVideo,
    VideoProviderConnector,
    VideoProviderType,
} from "@courselit/common-models";
import {
    BUNNY_SECRET_FIELDS,
    BUNNY_SETTING_FIELDS,
    createBunnyConnector,
} from "./bunny";

export const SECRET_FIELDS: Record<VideoProviderType, string[]> = {
    bunny: BUNNY_SECRET_FIELDS,
};

export const SETTING_FIELDS: Record<VideoProviderType, string[]> = {
    bunny: BUNNY_SETTING_FIELDS,
};

export function getConnector(config: ProviderConfig): VideoProviderConnector {
    switch (config.type) {
        case "bunny":
            return createBunnyConnector(config);
        default:
            throw new Error(`Unsupported video provider: ${config.type}`);
    }
}

/** Error stored on a video the provider no longer has. */
export const VIDEO_NOT_FOUND_AT_PROVIDER = "Video not found at provider";

/** An upload the provider still has not received after this is an error. */
const UPLOAD_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * Pure: the fields to `$set` on a StreamingVideo after reading it from the
 * provider. `readyAt` is only set when the video becomes ready.
 */
export function applyProviderVideo(
    current: Pick<StreamingVideo, "status" | "readyAt"> &
        Partial<Pick<StreamingVideo, "createdAt">>,
    providerVideo: ProviderVideo | null,
    now: Date,
): Partial<StreamingVideo> {
    if (!providerVideo) {
        return {
            status: "error",
            errorMessage: VIDEO_NOT_FOUND_AT_PROVIDER,
            lastCheckedAt: now,
        };
    }
    if (
        providerVideo.status === "uploading" &&
        current.createdAt &&
        new Date(current.createdAt).getTime() <
            now.getTime() - UPLOAD_TIMEOUT_MS
    ) {
        return {
            status: "error",
            errorMessage: "Upload did not complete",
            lastCheckedAt: now,
        };
    }
    const update: Partial<StreamingVideo> = {
        status: providerVideo.status,
        lastCheckedAt: now,
    };
    // The provider may still report "created" right after the upload ends;
    // do not move a processing video back to uploading.
    if (
        current.status === "processing" &&
        providerVideo.status === "uploading"
    ) {
        delete update.status;
    }
    if (providerVideo.durationSeconds !== undefined) {
        update.durationSeconds = providerVideo.durationSeconds;
    }
    if (providerVideo.thumbnailUrl !== undefined) {
        update.thumbnailUrl = providerVideo.thumbnailUrl;
    }
    if (providerVideo.status === "ready" && !current.readyAt) {
        update.readyAt = now;
    }
    if (providerVideo.status === "error") {
        update.errorMessage = "Video processing failed at provider";
    }
    return update;
}

/**
 * Pure: the `videoId`s of stored videos that a provider listing shows were
 * deleted at the provider. Flags nothing unless the listing is complete.
 * Only `ready` videos are considered, and only when created and ready
 * before the listing started, so a video that appears meanwhile is never
 * flagged; in-flight videos are left to the per-video refresh.
 */
export function findVideosMissingAtProvider({
    stored,
    providerVideoIds,
    listingComplete,
    listingStartedAt,
}: MissingAtProviderCheck): string[] {
    if (!listingComplete) {
        return [];
    }
    const start = listingStartedAt.getTime();
    const before = (date?: Date) =>
        date !== undefined && date !== null && new Date(date).getTime() < start;
    return stored
        .filter(
            (video) =>
                video.status === "ready" &&
                before(video.createdAt) &&
                (video.readyAt === undefined ||
                    video.readyAt === null ||
                    before(video.readyAt)) &&
                !providerVideoIds.has(video.providerVideoId),
        )
        .map((video) => video.videoId);
}
