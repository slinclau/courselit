import { NextRequest } from "next/server";
import StreamingVideoModel from "@models/StreamingVideo";
import { authenticateAuthor, canManageVideoCourse } from "@/lib/video/access";

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

    return Response.json({
        status: video.status,
        durationSeconds: video.durationSeconds,
        thumbnailUrl: video.thumbnailUrl,
        errorMessage: video.errorMessage,
    });
}
