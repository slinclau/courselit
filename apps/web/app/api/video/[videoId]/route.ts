import { NextRequest } from "next/server";
import StreamingVideoModel from "@models/StreamingVideo";
import { authenticateAuthor, canManageVideoCourse } from "@/lib/video/access";
import { refreshVideoIfStale } from "@/lib/video/refresh";
import { getSignedThumbnailUrl } from "@/lib/video/thumbnail";

/** GET: processing status of a streaming video (author only). */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ videoId: string }> },
) {
    const { videoId } = await params;
    const ctx = await authenticateAuthor(req);
    if (ctx instanceof Response) {
        return ctx;
    }
    const { domain, user } = ctx;

    const stored = await StreamingVideoModel.findOne({
        domain: domain._id,
        videoId,
    });
    if (!stored) {
        return Response.json({ message: "Video not found" }, { status: 404 });
    }
    if (
        !(await canManageVideoCourse({
            domain,
            user,
            courseId: stored.courseId,
            createdBy: stored.createdBy,
        }))
    ) {
        return Response.json({ message: "Forbidden" }, { status: 403 });
    }

    const video = await refreshVideoIfStale(domain._id.toString(), stored);

    return Response.json({
        status: video.status,
        durationSeconds: video.durationSeconds,
        thumbnailUrl: await getSignedThumbnailUrl(domain._id.toString(), video),
        errorMessage: video.errorMessage,
    });
}
