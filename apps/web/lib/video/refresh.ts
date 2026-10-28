import StreamingVideoModel from "@models/StreamingVideo";
import { applyProviderVideo, getConnector } from "@courselit/video-providers";
import { getProviderConfig } from "@/graphql/videoproviders/logic";

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
