import type {
    MissingAtProviderCheck,
    MissingAtProviderCounts,
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

function optionalDetails(
    providerVideo: ProviderVideo,
): Partial<StreamingVideo> {
    const details: Partial<StreamingVideo> = {};
    if (providerVideo.durationSeconds !== undefined) {
        details.durationSeconds = providerVideo.durationSeconds;
    }
    if (providerVideo.thumbnailUrl !== undefined) {
        details.thumbnailUrl = providerVideo.thumbnailUrl;
    }
    return details;
}

/**
 * Pure: the fields to `$set` on a StreamingVideo after reading it from the
 * provider. `readyAt` is only set when the video becomes ready. A stored
 * ready video keeps its status unless the provider no longer has it.
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
    if (current.status === "ready") {
        // A ready video stays ready: only its absence at the provider
        // (above) changes its status.
        return {
            lastCheckedAt: now,
            ...optionalDetails(providerVideo),
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
    Object.assign(update, optionalDetails(providerVideo));
    if (providerVideo.status === "ready" && !current.readyAt) {
        update.readyAt = now;
    }
    if (providerVideo.status === "error") {
        update.errorMessage = "Video processing failed at provider";
    }
    return update;
}

/** Margin before the listing start for videos that may not be listed yet. */
const LISTING_START_MARGIN_MS = 5 * 60 * 1000;

/**
 * Pure: the `videoId`s of stored videos that a provider listing suggests
 * were deleted at the provider. These are only candidates: confirm each one
 * with `getVideo` (null) before flagging it, since a listing paged while the
 * library changes can skip videos. Nominates nothing unless the listing is
 * complete. Only `ready` videos are considered, and only when created, and
 * ready if `readyAt` is known, more than 5 minutes before the listing
 * started; in-flight videos are left to the per-video refresh.
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
    const start = listingStartedAt.getTime() - LISTING_START_MARGIN_MS;
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

/**
 * Pure: whether flagging this many ready videos as missing at once more
 * likely means the provider settings point at another library than that
 * the videos were deleted. True when more than 5 videos and more than 20 %
 * of the ready ones are missing, or when the listing is empty and more than
 * one ready video is missing.
 */
export function isLikelyMisconfiguration({
    missing,
    ready,
    listed,
}: MissingAtProviderCounts): boolean {
    return (
        (missing > 5 && missing * 5 > ready) || (listed === 0 && missing > 1)
    );
}
