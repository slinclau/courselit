import { NextRequest } from "next/server";
import { Constants } from "@courselit/common-models";
import { generateUniqueId } from "@courselit/utils";
import { getConnector } from "@courselit/video-providers";
import LessonModel from "@models/Lesson";
import CourseModel from "@models/Course";
import StreamingVideoModel from "@models/StreamingVideo";
import { getActiveProviderConfig } from "@/graphql/videoproviders/logic";
import { authenticateAuthor, canManageVideoCourse } from "@/lib/video/access";
import { error as logError } from "@/services/logger";

/**
 * POST: start a streaming video upload for a lesson.
 * Body: { lessonId, filename, filetype }
 * Returns the TUS instructions the browser uses to send the file straight
 * to the provider.
 */
export async function POST(req: NextRequest) {
    const ctx = await authenticateAuthor(req);
    if (ctx instanceof Response) {
        return ctx;
    }
    const { domain, user } = ctx;

    let body: any;
    try {
        body = await req.json();
    } catch {
        return Response.json({ message: "Invalid body" }, { status: 400 });
    }
    const { lessonId } = body || {};
    if (typeof lessonId !== "string" || typeof body.filetype !== "string") {
        return Response.json(
            { message: "lessonId and filetype are required" },
            { status: 400 },
        );
    }
    // Browsers report an empty type for unknown extensions; TUS needs one.
    const filetype: string = body.filetype.trim() || "application/octet-stream";

    const lesson = await LessonModel.findOne({
        lessonId,
        domain: domain._id,
    });
    if (!lesson) {
        return Response.json({ message: "Lesson not found" }, { status: 404 });
    }
    if (lesson.type !== Constants.LessonType.STREAMING_VIDEO) {
        return Response.json(
            { message: "Lesson is not a streaming video lesson" },
            { status: 400 },
        );
    }

    if (
        !(await canManageVideoCourse({
            domain,
            user,
            courseId: lesson.courseId,
        }))
    ) {
        return Response.json({ message: "Forbidden" }, { status: 403 });
    }

    const active = await getActiveProviderConfig(domain._id.toString());
    if (!active) {
        return Response.json(
            { message: "No active video provider" },
            { status: 409 },
        );
    }

    const course = await CourseModel.findOne({
        courseId: lesson.courseId,
        domain: domain._id,
    });
    if (!course) {
        return Response.json({ message: "Course not found" }, { status: 404 });
    }

    let created;
    try {
        const connector = getConnector(active);
        const groupId = await connector.ensureGroup(
            course.courseId,
            course.title,
        );
        created = await connector.createUpload({
            title: lesson.title,
            groupId,
            filetype,
        });
    } catch (err: any) {
        logError("Streaming video upload could not be created", {
            lessonId,
            err: err?.message,
        });
        return Response.json(
            { message: "The video provider could not start the upload" },
            { status: 502 },
        );
    }

    const videoId = generateUniqueId();
    try {
        await StreamingVideoModel.create({
            domain: domain._id,
            videoId,
            providerId: active.providerId,
            providerVideoId: created.providerVideoId,
            courseId: lesson.courseId,
            title: lesson.title,
            status: "uploading",
            createdBy: user.userId,
        });
    } catch (err: any) {
        // A duplicate key means the import job filed this provider video
        // first; the lesson is left unchanged either way.
        const duplicate = err?.code === 11000;
        logError("Streaming video record could not be stored", {
            lessonId,
            err: err?.message,
        });
        return Response.json(
            {
                message: duplicate
                    ? "This video is already tracked, start the upload again"
                    : "The upload could not be started",
            },
            { status: duplicate ? 409 : 502 },
        );
    }

    // The replaced video stays at the provider; it is only unfiled.
    const previousVideoId = lesson.content?.videoId;
    if (previousVideoId) {
        await StreamingVideoModel.updateOne(
            { domain: domain._id, videoId: previousVideoId },
            { $set: { courseId: null } },
        );
    }
    await LessonModel.updateOne(
        { lessonId, domain: domain._id },
        { $set: { content: { videoId } } },
    );

    return Response.json({ videoId, upload: created.upload });
}
