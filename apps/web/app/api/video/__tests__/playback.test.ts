/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import Domain from "@models/Domain";
import User from "@models/User";
import Lesson from "@models/Lesson";
import Course from "@models/Course";
import StreamingVideo from "@models/StreamingVideo";
import { getConnector } from "@courselit/video-providers";
import { getProviderConfig } from "@/graphql/videoproviders/logic";
import { GET } from "../[videoId]/playback/route";

jest.mock("@/auth", () => ({
    auth: { api: { getSession: jest.fn() } },
}));
jest.mock("@models/Domain");
jest.mock("@models/User");
jest.mock("@models/Lesson");
jest.mock("@models/Course");
jest.mock("@models/StreamingVideo");
jest.mock("@/graphql/videoproviders/logic", () => ({
    getProviderConfig: jest.fn(),
}));
jest.mock("@courselit/video-providers", () => ({
    ...jest.requireActual("@courselit/video-providers"),
    getConnector: jest.fn(),
}));

const domain = { _id: "domain-id", name: "school" };
const playback = {
    kind: "hls",
    url: "https://cdn.example/tok/expires/v/playlist.m3u8",
    expiresAt: "2030-01-01T00:00:00.000Z",
};
const connector = { getPlayback: jest.fn() };

function request(query = "lessonId=l1&courseId=c1") {
    return {
        headers: { get: (n: string) => (n === "domain" ? "school" : null) },
        nextUrl: { searchParams: new URLSearchParams(query) },
    } as unknown as NextRequest;
}

function call(videoId = "v1", query?: string) {
    return GET(request(query), { params: Promise.resolve({ videoId }) });
}

function asUser(user: any) {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({
        user: { email: "a@example.com" },
    });
    (User.findOne as jest.Mock).mockResolvedValue(user);
}

const learner = (courseIds: string[] = ["c1"]) => ({
    userId: "u1",
    permissions: [],
    purchases: courseIds.map((courseId) => ({
        courseId,
        accessibleGroups: ["g1"],
    })),
});

beforeEach(() => {
    jest.resetAllMocks();
    (Domain.findOne as jest.Mock).mockResolvedValue(domain);
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue(null);
    (Lesson.findOne as jest.Mock).mockResolvedValue({
        lessonId: "l1",
        courseId: "c1",
        groupId: "g1",
        published: true,
        requiresEnrollment: true,
        content: { videoId: "v1" },
    });
    (Course.findOne as jest.Mock).mockResolvedValue({
        courseId: "c1",
        creatorId: "author-1",
        groups: [{ _id: "g1" }],
    });
    (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
        videoId: "v1",
        providerId: "old-provider",
        providerVideoId: "pv1",
        status: "ready",
    });
    (getProviderConfig as jest.Mock).mockResolvedValue({
        type: "bunny",
        settings: {},
        secrets: { tokenSecurityKey: "OLD-KEY" },
    });
    (getConnector as jest.Mock).mockReturnValue(connector);
    connector.getPlayback.mockReturnValue(playback);
});

describe("GET /api/video/[videoId]/playback", () => {
    it("refuses an anonymous viewer when enrollment is required", async () => {
        const res = await call();
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).not.toContain("http");
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        expect(connector.getPlayback).not.toHaveBeenCalled();
    });

    it("refuses a signed-in user who is not enrolled", async () => {
        asUser(learner([]));
        const res = await call();
        expect(res.status).toBe(403);
        expect(connector.getPlayback).not.toHaveBeenCalled();
    });

    it("serves an anonymous viewer when enrollment is not required", async () => {
        (Lesson.findOne as jest.Mock).mockResolvedValue({
            lessonId: "l1",
            courseId: "c1",
            groupId: "g1",
            published: true,
            requiresEnrollment: false,
            content: { videoId: "v1" },
        });
        const res = await call();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "ready", playback });
        expect(connector.getPlayback).toHaveBeenCalledWith("pv1", 14400);
    });

    it("serves an enrolled user with private, no-store caching", async () => {
        asUser(learner());
        const res = await call();
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        expect((await res.json()).playback.url).toBe(playback.url);
    });

    it("serves a course manager who is not enrolled", async () => {
        asUser({
            userId: "author-1",
            permissions: ["course:manage"],
            purchases: [],
        });
        const res = await call();
        expect(res.status).toBe(200);
    });

    it("refuses an enrolled user while the group's drip is not released", async () => {
        (Course.findOne as jest.Mock).mockResolvedValue({
            courseId: "c1",
            creatorId: "author-1",
            groups: [{ _id: "g1", drip: { status: true } }],
        });
        asUser({
            userId: "u1",
            permissions: [],
            purchases: [{ courseId: "c1", accessibleGroups: [] }],
        });
        expect((await call()).status).toBe(403);
    });

    it("hides an unpublished lesson from learners", async () => {
        (Lesson.findOne as jest.Mock).mockResolvedValue({
            lessonId: "l1",
            courseId: "c1",
            groupId: "g1",
            published: false,
            requiresEnrollment: false,
            content: { videoId: "v1" },
        });
        expect((await call()).status).toBe(404);
    });

    it("returns 404 when the video is not the lesson's video", async () => {
        asUser(learner());
        const res = await call("other");
        expect(res.status).toBe(404);
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("returns 404 when the lesson is not in the given course", async () => {
        (Lesson.findOne as jest.Mock).mockResolvedValue(null);
        asUser(learner());
        expect((await call("v1", "lessonId=l1&courseId=zzz")).status).toBe(404);
    });

    it("returns the status without a URL while the video is not ready", async () => {
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
            videoId: "v1",
            providerId: "old-provider",
            providerVideoId: "pv1",
            status: "processing",
        });
        asUser(learner());
        const res = await call();
        expect(await res.json()).toEqual({ status: "processing" });
        expect(connector.getPlayback).not.toHaveBeenCalled();
    });

    it("signs with the provider that hosts the video", async () => {
        asUser(learner());
        await call();
        expect(getProviderConfig).toHaveBeenCalledWith(
            "domain-id",
            "old-provider",
        );
        expect(getConnector).toHaveBeenCalledWith(
            expect.objectContaining({
                secrets: { tokenSecurityKey: "OLD-KEY" },
            }),
        );
    });
});
