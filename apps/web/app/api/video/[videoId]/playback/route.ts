import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getCourseManagementAccess } from "@courselit/common-logic";
import { getConnector } from "@courselit/video-providers";
import DomainModel, { Domain } from "@models/Domain";
import UserModel from "@models/User";
import LessonModel from "@models/Lesson";
import CourseModel from "@models/Course";
import StreamingVideoModel from "@models/StreamingVideo";
import { getProviderConfig } from "@/graphql/videoproviders/logic";

const PLAYBACK_TTL_SECONDS = 4 * 60 * 60;
const NO_STORE = { "Cache-Control": "private, no-store" };

function reply(body: unknown, status = 200) {
    return Response.json(body, { status, headers: NO_STORE });
}

/**
 * GET: a signed playback URL for a streaming video, for whoever may open the
 * lesson that holds it. Same rule as `getLessonDetails`: published, enrolled
 * when the lesson requires it, drip released; course managers always pass.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ videoId: string }> },
) {
    const { videoId } = await params;
    const lessonId = req.nextUrl?.searchParams.get("lessonId");
    const courseId = req.nextUrl?.searchParams.get("courseId");
    if (!lessonId || !courseId) {
        return reply({ message: "lessonId and courseId are required" }, 400);
    }

    const domain = await DomainModel.findOne<Domain>({
        name: req.headers.get("domain"),
    });
    if (!domain) {
        return reply({ message: "Domain not found" }, 404);
    }

    const lesson = await LessonModel.findOne({
        lessonId,
        courseId,
        domain: domain._id,
    });
    const video = await StreamingVideoModel.findOne({
        domain: domain._id,
        videoId,
    });
    if (!lesson || !video || (lesson.content as any)?.videoId !== videoId) {
        return reply({ message: "Video not found" }, 404);
    }

    const course = await CourseModel.findOne({
        courseId: lesson.courseId,
        domain: domain._id,
    });
    if (!course) {
        return reply({ message: "Video not found" }, 404);
    }

    const session = await auth.api.getSession({ headers: req.headers });
    const user = session?.user?.email
        ? await UserModel.findOne({
              email: session.user.email,
              domain: domain._id,
              active: true,
          })
        : null;

    const canManage =
        !!user &&
        getCourseManagementAccess({
            creatorId: course.creatorId.toString(),
            userId: user.userId,
            permissions: user.permissions,
        }).canManage;

    if (!canManage) {
        if (!lesson.published) {
            return reply({ message: "Video not found" }, 404);
        }
        const purchase = user?.purchases?.find(
            (p: any) => p.courseId === lesson.courseId,
        );
        if (lesson.requiresEnrollment && !purchase) {
            return reply({ message: "Forbidden" }, 403);
        }
        const group = (course.groups ?? []).find(
            (g: any) => (g._id ?? g.id) === lesson.groupId,
        );
        if (
            group?.drip?.status &&
            (!purchase || !purchase.accessibleGroups?.includes(lesson.groupId))
        ) {
            return reply({ message: "Forbidden" }, 403);
        }
    }

    if (video.status !== "ready") {
        return reply({ status: video.status });
    }

    // Sign with the provider that hosts the video, not the active one.
    const config = await getProviderConfig(
        domain._id.toString(),
        video.providerId,
    );
    if (!config) {
        return reply({ message: "Video provider unavailable" }, 502);
    }
    let playback;
    try {
        playback = getConnector(config).getPlayback(
            video.providerVideoId,
            PLAYBACK_TTL_SECONDS,
        );
    } catch {
        // Incomplete provider config; never echo its details.
        return reply({ message: "Video provider unavailable" }, 502);
    }
    return reply({ status: "ready", playback });
}
