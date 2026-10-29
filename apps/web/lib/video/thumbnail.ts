import type { StreamingVideo } from "@courselit/common-models";
import { getConnector } from "@courselit/video-providers";
import { getProviderConfig } from "@/graphql/videoproviders/logic";

const THUMBNAIL_TTL_SECONDS = 4 * 60 * 60;

/**
 * The stored thumbnail url is unsigned; sign it with the provider that hosts
 * the video before it leaves the server. No thumbnail (rather than an error)
 * when the provider config cannot be loaded.
 */
export async function getSignedThumbnailUrl(
    domainId: string,
    video: Pick<
        StreamingVideo,
        "providerId" | "providerVideoId" | "thumbnailUrl"
    > | null,
): Promise<string | undefined> {
    if (!video?.thumbnailUrl) {
        return undefined;
    }
    try {
        const config = await getProviderConfig(domainId, video.providerId);
        if (!config) {
            return undefined;
        }
        return getConnector(config).getThumbnailUrl(
            video.providerVideoId,
            video.thumbnailUrl,
            THUMBNAIL_TTL_SECONDS,
        );
    } catch {
        return undefined;
    }
}
