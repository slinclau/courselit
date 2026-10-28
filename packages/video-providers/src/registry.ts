import type {
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

/**
 * Pure: the fields to `$set` on a StreamingVideo after reading it from the
 * provider. `readyAt` is only set when the video becomes ready.
 */
export function applyProviderVideo(
    current: Pick<StreamingVideo, "status" | "readyAt">,
    providerVideo: ProviderVideo | null,
    now: Date,
): Partial<StreamingVideo> {
    if (!providerVideo) {
        return {
            status: "error",
            errorMessage: "Video not found at provider",
            lastCheckedAt: now,
        };
    }
    const update: Partial<StreamingVideo> = {
        status: providerVideo.status,
        lastCheckedAt: now,
    };
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
