import { NextRequest } from "next/server";
import { getConnector } from "@courselit/video-providers";
import DomainModel, { Domain } from "@models/Domain";
import StreamingVideoModel from "@models/StreamingVideo";
import { getProviderConfig } from "@/graphql/videoproviders/logic";
import { refreshVideo } from "@/lib/video/refresh";
import { error as logError } from "@/services/logger";

/**
 * POST: provider webhook. The payload is only a hint: its signature is
 * verified and the video is then re-read from the provider API.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ providerId: string }> },
) {
    const { providerId } = await params;

    const domain = await DomainModel.findOne<Domain>({
        name: req.headers.get("domain"),
    });
    if (!domain) {
        return Response.json({ message: "Not found" }, { status: 404 });
    }
    const domainId = domain._id.toString();

    const config = await getProviderConfig(domainId, providerId);
    if (!config) {
        return Response.json({ message: "Not found" }, { status: 404 });
    }

    const rawBody = await req.text();
    const verified = getConnector(config).verifyWebhook(rawBody, req.headers);
    if (!verified) {
        return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const video = await StreamingVideoModel.findOne({
        domain: domain._id,
        providerId,
        providerVideoId: verified.providerVideoId,
    });
    if (!video) {
        return Response.json({ success: true });
    }

    try {
        await refreshVideo(domainId, video.videoId);
    } catch (err: any) {
        logError("Streaming video webhook refresh failed", {
            providerId,
            err: err?.message,
        });
        return Response.json({ message: "Refresh failed" }, { status: 500 });
    }
    return Response.json({ success: true });
}
