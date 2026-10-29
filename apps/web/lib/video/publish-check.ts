import { Constants } from "@courselit/common-models";
import { responses } from "../../config/strings";
import LessonModel from "../../models/Lesson";
import StreamingVideoModel from "../../models/StreamingVideo";

/**
 * Throws when any streaming video lesson of the course has no video yet, or
 * its video is not ready. The message lists the blocking lesson titles.
 */
export async function assertStreamingVideosReady({
    domain,
    courseId,
}: {
    domain: unknown;
    courseId: string;
}): Promise<void> {
    const lessons = await LessonModel.find({
        domain,
        courseId,
        type: Constants.LessonType.STREAMING_VIDEO,
    }).lean();
    if (!lessons.length) {
        return;
    }

    const videoIds = lessons
        .map((lesson: any) => lesson.content?.videoId)
        .filter(Boolean);
    const readyVideos = videoIds.length
        ? await StreamingVideoModel.find({
              domain,
              videoId: { $in: videoIds },
              status: "ready",
          })
              .select("videoId")
              .lean()
        : [];
    const readyIds = new Set(readyVideos.map((video) => video.videoId));

    const blocking = lessons
        .filter((lesson: any) => !readyIds.has(lesson.content?.videoId))
        .map((lesson: any) => lesson.title);
    if (blocking.length) {
        throw new Error(
            `${responses.streaming_videos_not_ready}: ${blocking.join(", ")}`,
        );
    }
}
