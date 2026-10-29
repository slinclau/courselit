import { Constants } from "@courselit/common-models";
import DomainModel from "@/models/Domain";
import UserModel from "@/models/User";
import CourseModel from "@/models/Course";
import LessonModel from "@/models/Lesson";
import StreamingVideoModel from "@/models/StreamingVideo";
import { createLesson, updateLesson } from "../logic";
import { responses } from "@/config/strings";

jest.mock("@/services/medialit", () => ({
    deleteMedia: jest.fn(),
    sealMedia: jest.fn(),
}));

const SUITE_PREFIX = `lesson-logic-${Date.now()}`;
const id = (suffix: string) => `${SUITE_PREFIX}-${suffix}`;
const email = (suffix: string) => `${suffix}-${SUITE_PREFIX}@example.com`;

describe("Lesson logic", () => {
    let testDomain: any;
    let manager: any;
    let course: any;
    let groupId: string;
    let ctx: any;

    beforeAll(async () => {
        testDomain = await DomainModel.create({
            name: id("domain"),
            email: email("domain"),
            features: [],
        });
        manager = await UserModel.create({
            domain: testDomain._id,
            userId: id("manager"),
            email: email("manager"),
            name: "Manager",
            active: true,
            permissions: ["course:manage"],
            unsubscribeToken: id("unsubscribe-manager"),
            purchases: [],
        });
        groupId = id("group-1");
        course = await CourseModel.create({
            domain: testDomain._id,
            courseId: id("course"),
            title: "Logic Course",
            lessons: [],
            creatorId: manager.userId,
            cost: 0,
            privacy: "public",
            type: "course",
            costType: "free",
            slug: id("course-slug"),
            published: true,
            groups: [
                {
                    _id: groupId,
                    name: "Default Group",
                    lessonsOrder: [],
                    rank: 1,
                    collapsed: true,
                    drip: { status: false, type: "relative-date" },
                },
            ],
        });
        ctx = {
            user: { ...manager.toObject(), permissions: ["course:manage"] },
            subdomain: testDomain,
        };
    });

    afterAll(async () => {
        await LessonModel.deleteMany({ domain: testDomain._id });
        await StreamingVideoModel.deleteMany({ domain: testDomain._id });
        await CourseModel.deleteMany({ domain: testDomain._id });
        await UserModel.deleteMany({ domain: testDomain._id });
        await DomainModel.deleteOne({ _id: testDomain._id });
    });

    const baseLesson = (overrides: any) => ({
        title: "Lesson",
        courseId: course.courseId,
        groupId,
        requiresEnrollment: true,
        published: false,
        ...overrides,
    });

    // nanoid is mocked to a constant in the test environment, so give every
    // created lesson a unique lessonId before it is looked up again.
    let seq = 0;
    const create = async (overrides: any) => {
        const lesson = await createLesson(baseLesson(overrides) as any, ctx);
        const lessonId = id(`lesson-${++seq}`);
        await LessonModel.updateOne({ _id: lesson._id }, { lessonId });
        lesson.lessonId = lessonId;
        return lesson;
    };

    // Each streaming video needs its own videoId and providerVideoId, since
    // nanoid is mocked to a constant.
    let videoSeq = 0;
    const video = async (courseId: string | null) => {
        const n = ++videoSeq;
        const doc = await StreamingVideoModel.create({
            domain: testDomain._id,
            videoId: id(`video-${n}`),
            providerId: "provider-1",
            providerVideoId: id(`provider-video-${n}`),
            courseId,
            title: "Video",
            createdBy: manager.userId,
        });
        return doc.videoId;
    };

    describe("streaming_video lessons", () => {
        it("creates a lesson with empty content", async () => {
            const lesson = await createLesson(
                baseLesson({
                    type: Constants.LessonType.STREAMING_VIDEO,
                    content: "{}",
                }) as any,
                ctx,
            );
            expect(lesson.type).toBe("streaming_video");
            expect(lesson.content).toEqual({});
        });

        it("creates a lesson with a videoId of the same course", async () => {
            const videoId = await video(course.courseId);
            const lesson = await createLesson(
                baseLesson({
                    type: Constants.LessonType.STREAMING_VIDEO,
                    content: JSON.stringify({ videoId }),
                }) as any,
                ctx,
            );
            expect(lesson.content).toEqual({ videoId });
        });

        it("rejects content with unknown keys", async () => {
            await expect(
                createLesson(
                    baseLesson({
                        type: Constants.LessonType.STREAMING_VIDEO,
                        content: JSON.stringify({ videoId: "x", other: 1 }),
                    }) as any,
                    ctx,
                ),
            ).rejects.toThrow(responses.content_cannot_be_null);
        });

        it("rejects a non-string videoId", async () => {
            await expect(
                createLesson(
                    baseLesson({
                        type: Constants.LessonType.STREAMING_VIDEO,
                        content: JSON.stringify({ videoId: 5 }),
                    }) as any,
                    ctx,
                ),
            ).rejects.toThrow(responses.content_cannot_be_null);
        });

        it("updates the videoId and rejects unknown keys on update", async () => {
            const lesson = await create({
                type: Constants.LessonType.STREAMING_VIDEO,
                content: "{}",
            });
            const videoId = await video(course.courseId);
            const updated = await updateLesson(
                {
                    id: lesson.lessonId,
                    lessonId: lesson.lessonId,
                    content: JSON.stringify({ videoId }),
                } as any,
                ctx,
            );
            expect(updated.content).toEqual({ videoId });

            await expect(
                updateLesson(
                    {
                        id: lesson.lessonId,
                        lessonId: lesson.lessonId,
                        content: JSON.stringify({ foo: "bar" }),
                    } as any,
                    ctx,
                ),
            ).rejects.toThrow(responses.content_cannot_be_null);
        });
    });

    describe("streaming_video lesson videoId ownership", () => {
        it("rejects a video of another course on create", async () => {
            const videoId = await video(id("other-course"));
            await expect(
                createLesson(
                    baseLesson({
                        type: Constants.LessonType.STREAMING_VIDEO,
                        content: JSON.stringify({ videoId }),
                    }) as any,
                    ctx,
                ),
            ).rejects.toThrow(responses.streaming_video_not_in_course);
        });

        it("rejects an unknown video on create", async () => {
            await expect(
                createLesson(
                    baseLesson({
                        type: Constants.LessonType.STREAMING_VIDEO,
                        content: JSON.stringify({ videoId: id("missing") }),
                    }) as any,
                    ctx,
                ),
            ).rejects.toThrow(responses.streaming_video_not_in_course);
        });

        it("rejects a video of another course on update", async () => {
            const lesson = await create({
                type: Constants.LessonType.STREAMING_VIDEO,
                content: "{}",
            });
            const videoId = await video(id("other-course"));
            await expect(
                updateLesson(
                    {
                        id: lesson.lessonId,
                        lessonId: lesson.lessonId,
                        content: JSON.stringify({ videoId }),
                    } as any,
                    ctx,
                ),
            ).rejects.toThrow(responses.streaming_video_not_in_course);
            const stored = await LessonModel.findOne({
                lessonId: lesson.lessonId,
            });
            expect(stored!.content).toEqual({});
        });

        it("rejects an unfiled video on update (stale editor tab)", async () => {
            const current = await video(course.courseId);
            const lesson = await create({
                type: Constants.LessonType.STREAMING_VIDEO,
                content: JSON.stringify({ videoId: current }),
            });
            const unfiled = await video(null);
            await expect(
                updateLesson(
                    {
                        id: lesson.lessonId,
                        lessonId: lesson.lessonId,
                        content: JSON.stringify({ videoId: unfiled }),
                    } as any,
                    ctx,
                ),
            ).rejects.toThrow(responses.streaming_video_not_in_course);
        });

        it("accepts a video of the same course on update", async () => {
            const lesson = await create({
                type: Constants.LessonType.STREAMING_VIDEO,
                content: "{}",
            });
            const videoId = await video(course.courseId);
            const updated = await updateLesson(
                {
                    id: lesson.lessonId,
                    lessonId: lesson.lessonId,
                    content: JSON.stringify({ videoId }),
                } as any,
                ctx,
            );
            expect(updated.content).toEqual({ videoId });
        });

        it("accepts an unchanged videoId, even once unfiled", async () => {
            const videoId = await video(course.courseId);
            const lesson = await create({
                type: Constants.LessonType.STREAMING_VIDEO,
                content: JSON.stringify({ videoId }),
            });
            await StreamingVideoModel.updateOne(
                { domain: testDomain._id, videoId },
                { $set: { courseId: null } },
            );
            const renamed = await updateLesson(
                {
                    id: lesson.lessonId,
                    lessonId: lesson.lessonId,
                    title: "Renamed",
                } as any,
                ctx,
            );
            expect(renamed.title).toBe("Renamed");
            const resent = await updateLesson(
                {
                    id: lesson.lessonId,
                    lessonId: lesson.lessonId,
                    title: "Renamed again",
                    content: JSON.stringify({ videoId }),
                } as any,
                ctx,
            );
            expect(resent.content).toEqual({ videoId });
        });
    });

    describe("video lessons (regression)", () => {
        it("updates a video lesson title without new requirements", async () => {
            const lesson = await create({
                type: Constants.LessonType.VIDEO,
                content: "{}",
            });
            const updated = await updateLesson(
                {
                    id: lesson.lessonId,
                    lessonId: lesson.lessonId,
                    title: "Renamed",
                } as any,
                ctx,
            );
            expect(updated.title).toBe("Renamed");
            expect(updated.type).toBe("video");
        });
    });
});
