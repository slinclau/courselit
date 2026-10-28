import { NextRequest } from "next/server";
import StreamingVideoModel from "@models/StreamingVideo";
import { authenticateAuthor, canManageVideoCourse } from "@/lib/video/access";
import { refreshVideo } from "@/lib/video/refresh";
import { error as logError } from "@/services/logger";

/** POST: the browser finished sending the file; start tracking processing. */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ videoId: string }> },
) {
    const { videoId } = await params;
    const ctx = await authenticateAuthor(req);
    if (ctx instanceof Response) {
        return ctx;
    }
    const { domain, user } = ctx;

    const video = await StreamingVideoModel.findOne({
        domain: domain._id,
        videoId,
    });
    if (!video) {
        return Response.json({ message: "Video not found" }, { status: 404 });
    }
    if (
        !(await canManageVideoCourse({
            domain,
            user,
            courseId: video.courseId,
            createdBy: video.createdBy,
        }))
    ) {
        return Response.json({ message: "Forbidden" }, { status: 403 });
    }

    // Only uploading -> processing; never regress a video that moved on.
    await StreamingVideoModel.updateOne(
        { domain: domain._id, videoId, status: "uploading" },
        { $set: { status: "processing" } },
    );

    try {
        const updated = await refreshVideo(domain._id.toString(), videoId);
        return Response.json({
            status: updated?.status,
            durationSeconds: updated?.durationSeconds,
            thumbnailUrl: updated?.thumbnailUrl,
            errorMessage: updated?.errorMessage,
        });
    } catch (err: any) {
        // The status poller and the safety net will catch up.
        logError("Streaming video refresh failed", {
            videoId,
            err: err?.message,
        });
        return Response.json({ status: "processing" });
    }
}
