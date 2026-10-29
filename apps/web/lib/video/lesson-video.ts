import { Constants } from "@courselit/common-models";
import { responses } from "../../config/strings";
import StreamingVideoModel from "../../models/StreamingVideo";

/**
 * A streaming video lesson may only point at a video filed under its own
 * course. Checked only when the videoId is new for the lesson, so saving an
 * unchanged lesson keeps working after its video was unfiled.
 */
export async function assertLessonVideoInCourse({
    domain,
    courseId,
    type,
    content,
    currentVideoId,
}: {
    domain: unknown;
    courseId: string;
    type: string;
    content: string | undefined;
    currentVideoId?: string;
}): Promise<void> {
    if (type !== Constants.LessonType.STREAMING_VIDEO) {
        return;
    }
    let videoId: unknown;
    try {
        videoId = content ? JSON.parse(content)?.videoId : undefined;
    } catch {
        return; // the content validator rejects malformed content
    }
    if (typeof videoId !== "string" || !videoId || videoId === currentVideoId) {
        return;
    }
    const video = await StreamingVideoModel.exists({
        domain,
        videoId,
        courseId,
    });
    if (!video) {
        throw new Error(responses.streaming_video_not_in_course);
    }
}
