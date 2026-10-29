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
import {
    getActiveProviderConfig,
    getProviderConfig,
} from "@/graphql/videoproviders/logic";

jest.mock("@/auth", () => ({
    auth: { api: { getSession: jest.fn() } },
}));
jest.mock("@models/Domain");
jest.mock("@models/User");
jest.mock("@models/Lesson");
jest.mock("@models/Course");
jest.mock("@models/StreamingVideo");
jest.mock("@/services/logger", () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));
jest.mock("@/graphql/videoproviders/logic", () => ({
    getActiveProviderConfig: jest.fn(),
    getProviderConfig: jest.fn(),
}));
jest.mock("@courselit/video-providers", () => ({
    ...jest.requireActual("@courselit/video-providers"),
    getConnector: jest.fn(),
}));

const domain = { _id: "domain-id", name: "school" };
const author = {
    userId: "author-1",
    permissions: ["course:manage"],
};
const stranger = { userId: "other", permissions: ["course:manage"] };
const config = { type: "bunny", settings: {}, secrets: { apiKey: "SECRET" } };
const instructions = {
    protocol: "tus",
    endpoint: "https://video.example/tusupload",
    headers: { AuthorizationSignature: "sig", VideoId: "pv1" },
    metadata: { filetype: "video/mp4" },
    expiresAt: new Date("2030-01-01"),
};

function request(opts: {
    body?: unknown;
    raw?: string;
    headers?: Record<string, string>;
}) {
    const headers: Record<string, string> = {
        domain: "school",
        ...(opts.headers || {}),
    };
    return {
        json: jest.fn().mockResolvedValue(opts.body),
        text: jest.fn().mockResolvedValue(opts.raw ?? ""),
        headers: {
            get: jest.fn((n: string) => headers[n] ?? null),
        },
    } as unknown as NextRequest;
}

const connector = {
    ensureGroup: jest.fn(),
    createUpload: jest.fn(),
    getVideo: jest.fn(),
    verifyWebhook: jest.fn(),
    getThumbnailUrl: jest.fn(),
};

function asUser(user: any) {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({
        user: { email: "a@example.com" },
    });
    (User.findOne as jest.Mock).mockResolvedValue(user);
}

beforeEach(() => {
    jest.resetAllMocks();
    (Domain.findOne as jest.Mock).mockResolvedValue(domain);
    (getConnector as jest.Mock).mockReturnValue(connector);
    (getProviderConfig as jest.Mock).mockResolvedValue(config);
    (getActiveProviderConfig as jest.Mock).mockResolvedValue({
        ...config,
        providerId: "p2",
    });
    (Course.findOne as jest.Mock).mockResolvedValue({
        courseId: "c1",
        title: "Course",
        creatorId: "author-1",
    });
    (Lesson.findOne as jest.Mock).mockResolvedValue({
        lessonId: "l1",
        courseId: "c1",
        title: "Lesson",
        type: "streaming_video",
        content: {},
    });
    connector.ensureGroup.mockResolvedValue("group-1");
    connector.createUpload.mockResolvedValue({
        providerVideoId: "pv1",
        upload: instructions,
    });
    (StreamingVideo.create as jest.Mock).mockResolvedValue({});
    connector.getThumbnailUrl.mockImplementation(
        (id: string, url: string) => `${url}?signed=${id}`,
    );
});

describe("POST /api/video/uploads", () => {
    const body = { lessonId: "l1", filename: "a.mp4", filetype: "video/mp4" };

    it("creates the record and links the lesson", async () => {
        asUser(author);
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(connector.ensureGroup).toHaveBeenCalledWith("c1", "Course");
        expect(connector.createUpload).toHaveBeenCalledWith({
            title: "Lesson",
            groupId: "group-1",
            filetype: "video/mp4",
        });
        const created = (StreamingVideo.create as jest.Mock).mock.calls[0][0];
        expect(created).toMatchObject({
            domain: "domain-id",
            providerId: "p2",
            providerVideoId: "pv1",
            courseId: "c1",
            status: "uploading",
            createdBy: "author-1",
            title: "Lesson",
        });
        expect(Lesson.updateOne).toHaveBeenCalledWith(
            { lessonId: "l1", domain: "domain-id" },
            { $set: { content: { videoId: created.videoId } } },
        );
        expect(json.videoId).toBe(created.videoId);
        expect(json.upload.endpoint).toBe(instructions.endpoint);
        expect(JSON.stringify(json)).not.toContain("SECRET");
    });

    it("defaults an empty filetype to application/octet-stream", async () => {
        asUser(author);
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body: { ...body, filetype: "" } }));
        expect(res.status).toBe(200);
        expect(connector.createUpload).toHaveBeenCalledWith(
            expect.objectContaining({ filetype: "application/octet-stream" }),
        );
    });

    it("returns a controlled 409 when the record already exists", async () => {
        asUser(author);
        (StreamingVideo.create as jest.Mock).mockRejectedValue(
            Object.assign(new Error("E11000 duplicate key"), { code: 11000 }),
        );
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        expect(res.status).toBe(409);
        expect(JSON.stringify(await res.json())).not.toContain("E11000");
        expect(Lesson.updateOne).not.toHaveBeenCalled();
    });

    it("returns a controlled 502 when the record cannot be stored", async () => {
        asUser(author);
        (StreamingVideo.create as jest.Mock).mockRejectedValue(
            new Error("db down"),
        );
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        expect(res.status).toBe(502);
        expect(Lesson.updateOne).not.toHaveBeenCalled();
    });

    it("rejects a non-author with 403", async () => {
        asUser(stranger);
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        expect(res.status).toBe(403);
        expect(connector.createUpload).not.toHaveBeenCalled();
        expect(StreamingVideo.create).not.toHaveBeenCalled();
    });

    it("returns 409 when there is no active provider", async () => {
        asUser(author);
        (getActiveProviderConfig as jest.Mock).mockResolvedValue(null);
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        expect(res.status).toBe(409);
        expect(StreamingVideo.create).not.toHaveBeenCalled();
    });

    it("returns 502 and stores nothing when the provider fails", async () => {
        asUser(author);
        connector.createUpload.mockRejectedValue(new Error("boom SECRET"));
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        expect(res.status).toBe(502);
        expect(JSON.stringify(await res.json())).not.toContain("SECRET");
        expect(StreamingVideo.create).not.toHaveBeenCalled();
        expect(Lesson.updateOne).not.toHaveBeenCalled();
    });

    it("unfiles the previous video and never deletes at the provider", async () => {
        asUser(author);
        (Lesson.findOne as jest.Mock).mockResolvedValue({
            lessonId: "l1",
            courseId: "c1",
            title: "Lesson",
            type: "streaming_video",
            content: { videoId: "old" },
        });
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        expect(res.status).toBe(200);
        expect(StreamingVideo.updateOne).toHaveBeenCalledWith(
            { domain: "domain-id", videoId: "old" },
            { $set: { courseId: null } },
        );
        expect(connector.getVideo).not.toHaveBeenCalled();
        expect(connector.verifyWebhook).not.toHaveBeenCalled();
        expect(connector.ensureGroup).toHaveBeenCalledTimes(1);
        expect(connector.createUpload).toHaveBeenCalledTimes(1);
    });

    it("rejects a lesson that is not a streaming video", async () => {
        asUser(author);
        (Lesson.findOne as jest.Mock).mockResolvedValue({
            lessonId: "l1",
            courseId: "c1",
            type: "video",
        });
        const { POST } = await import("../uploads/route");
        const res = await POST(request({ body }));
        expect(res.status).toBe(400);
    });
});

describe("video status and uploaded", () => {
    const video = {
        videoId: "v1",
        providerId: "p1",
        providerVideoId: "pv1",
        courseId: "c1",
        status: "uploading",
        createdBy: "author-1",
    };

    it("GET returns status for the author only", async () => {
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
            ...video,
            status: "ready",
            durationSeconds: 12,
            thumbnailUrl: "https://t",
        });
        const { GET } = await import("../[videoId]/route");

        asUser(stranger);
        const denied = await GET(request({}), {
            params: Promise.resolve({ videoId: "v1" }),
        });
        expect(denied.status).toBe(403);

        asUser(author);
        const ok = await GET(request({}), {
            params: Promise.resolve({ videoId: "v1" }),
        });
        expect(await ok.json()).toEqual({
            status: "ready",
            durationSeconds: 12,
            thumbnailUrl: "https://t?signed=pv1",
            errorMessage: undefined,
        });
        // Signed with the provider that hosts the video.
        expect(getProviderConfig).toHaveBeenCalledWith("domain-id", "p1");
        expect(connector.getThumbnailUrl).toHaveBeenCalledWith(
            "pv1",
            "https://t",
            expect.any(Number),
        );
    });

    it("GET returns no thumbnail when the provider config cannot load", async () => {
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
            ...video,
            status: "ready",
            thumbnailUrl: "https://t",
        });
        (getConnector as jest.Mock).mockImplementation(() => {
            throw new Error("missing libraryId");
        });
        asUser(author);
        const { GET } = await import("../[videoId]/route");
        const res = await GET(request({}), {
            params: Promise.resolve({ videoId: "v1" }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe("ready");
        expect(json.thumbnailUrl).toBeUndefined();
    });

    it("GET returns no thumbnail when the provider is gone", async () => {
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
            ...video,
            status: "ready",
            thumbnailUrl: "https://t",
        });
        (getProviderConfig as jest.Mock).mockResolvedValue(null);
        asUser(author);
        const { GET } = await import("../[videoId]/route");
        const res = await GET(request({}), {
            params: Promise.resolve({ videoId: "v1" }),
        });
        expect(res.status).toBe(200);
        expect((await res.json()).thumbnailUrl).toBeUndefined();
    });

    describe("GET re-reads a pending video from the provider", () => {
        const minutesAgo = (n: number) => new Date(Date.now() - n * 60000);
        const get = async () => {
            const { GET } = await import("../[videoId]/route");
            return GET(request({}), {
                params: Promise.resolve({ videoId: "v1" }),
            });
        };

        beforeEach(() => {
            asUser(author);
            (StreamingVideo.findOneAndUpdate as jest.Mock).mockReset();
            connector.getVideo.mockReset();
        });

        it("refreshes a processing video last checked over a minute ago", async () => {
            const stored = {
                ...video,
                status: "processing",
                lastCheckedAt: minutesAgo(2),
            };
            (StreamingVideo.findOne as jest.Mock).mockResolvedValue(stored);
            (StreamingVideo.findOneAndUpdate as jest.Mock)
                .mockResolvedValueOnce(stored)
                .mockResolvedValueOnce({
                    ...stored,
                    status: "ready",
                    durationSeconds: 21,
                });
            connector.getVideo.mockResolvedValue({
                status: "ready",
                durationSeconds: 21,
            });

            const res = await get();

            expect(connector.getVideo).toHaveBeenCalledWith("pv1");
            const json = await res.json();
            expect(json.status).toBe("ready");
            expect(json.durationSeconds).toBe(21);
            // The claim only matches a pending video not checked recently.
            const claim = (StreamingVideo.findOneAndUpdate as jest.Mock).mock
                .calls[0];
            expect(claim[0]).toMatchObject({
                domain: "domain-id",
                videoId: "v1",
                status: { $in: ["uploading", "processing"] },
            });
            expect(claim[1].$set.lastCheckedAt).toBeInstanceOf(Date);
        });

        it("does not call the provider for a video checked recently", async () => {
            (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
                ...video,
                status: "processing",
                lastCheckedAt: minutesAgo(0.25),
            });
            const res = await get();
            expect(connector.getVideo).not.toHaveBeenCalled();
            expect(StreamingVideo.findOneAndUpdate).not.toHaveBeenCalled();
            expect((await res.json()).status).toBe("processing");
        });

        it("does not call the provider when another request claimed the check", async () => {
            (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
                ...video,
                status: "uploading",
            });
            (
                StreamingVideo.findOneAndUpdate as jest.Mock
            ).mockResolvedValueOnce(null);
            const res = await get();
            expect(connector.getVideo).not.toHaveBeenCalled();
            expect((await res.json()).status).toBe("uploading");
        });

        it("does not refresh a ready video", async () => {
            (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
                ...video,
                status: "ready",
                lastCheckedAt: minutesAgo(60),
            });
            await get();
            expect(connector.getVideo).not.toHaveBeenCalled();
            expect(StreamingVideo.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it("returns the stored status when the provider fails", async () => {
            const stored = {
                ...video,
                status: "processing",
                lastCheckedAt: minutesAgo(5),
            };
            (StreamingVideo.findOne as jest.Mock).mockResolvedValue(stored);
            (
                StreamingVideo.findOneAndUpdate as jest.Mock
            ).mockResolvedValueOnce(stored);
            connector.getVideo.mockRejectedValue(new Error("Bunny down"));
            const res = await get();
            expect(res.status).toBe(200);
            expect((await res.json()).status).toBe("processing");
        });
    });

    it("/uploaded returns a signed thumbnail", async () => {
        asUser(author);
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue(video);
        (StreamingVideo.findOneAndUpdate as jest.Mock).mockResolvedValue({
            ...video,
            status: "ready",
            thumbnailUrl: "https://t",
        });
        connector.getVideo.mockResolvedValue({
            providerVideoId: "pv1",
            title: "t",
            status: "ready",
            thumbnailUrl: "https://t",
        });
        const { POST } = await import("../[videoId]/uploaded/route");
        const res = await POST(request({}), {
            params: Promise.resolve({ videoId: "v1" }),
        });
        expect((await res.json()).thumbnailUrl).toBe("https://t?signed=pv1");
    });

    it("/uploaded moves uploading to processing, then refreshes", async () => {
        asUser(author);
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue(video);
        (StreamingVideo.findOneAndUpdate as jest.Mock).mockResolvedValue({
            ...video,
            status: "processing",
        });
        connector.getVideo.mockResolvedValue({
            providerVideoId: "pv1",
            title: "t",
            status: "processing",
        });
        const { POST } = await import("../[videoId]/uploaded/route");
        const res = await POST(request({}), {
            params: Promise.resolve({ videoId: "v1" }),
        });
        expect(res.status).toBe(200);
        expect(StreamingVideo.updateOne).toHaveBeenCalledWith(
            { domain: "domain-id", videoId: "v1", status: "uploading" },
            { $set: { status: "processing" } },
        );
        expect(getProviderConfig).toHaveBeenCalledWith("domain-id", "p1");
        expect(connector.getVideo).toHaveBeenCalledWith("pv1");
    });

    it("/uploaded keeps processing when the provider still says uploading", async () => {
        asUser(author);
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue(video);
        (StreamingVideo.findOneAndUpdate as jest.Mock).mockResolvedValue({});
        connector.getVideo.mockResolvedValue({
            providerVideoId: "pv1",
            title: "t",
            status: "uploading",
        });
        // The record is read back as processing after the conditional update.
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue({
            ...video,
            status: "processing",
        });
        const { POST } = await import("../[videoId]/uploaded/route");
        await POST(request({}), {
            params: Promise.resolve({ videoId: "v1" }),
        });
        const set = (StreamingVideo.findOneAndUpdate as jest.Mock).mock
            .calls[0][1].$set;
        expect(set.status).toBeUndefined();
    });
});

describe("POST /api/video/webhook/[providerId]", () => {
    const params = { params: Promise.resolve({ providerId: "p1" }) };
    const known = {
        videoId: "v1",
        providerId: "p1",
        providerVideoId: "pv1",
        status: "processing",
    };

    it("rejects a bad signature with 401", async () => {
        connector.verifyWebhook.mockReturnValue(null);
        const { POST } = await import("../webhook/[providerId]/route");
        const res = await POST(request({ raw: "{}" }), params);
        expect(res.status).toBe(401);
        expect(StreamingVideo.findOne).not.toHaveBeenCalled();
        expect(connector.getVideo).not.toHaveBeenCalled();
        expect(StreamingVideo.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown provider", async () => {
        (getProviderConfig as jest.Mock).mockResolvedValue(null);
        const { POST } = await import("../webhook/[providerId]/route");
        const res = await POST(request({ raw: "{}" }), params);
        expect(res.status).toBe(404);
    });

    it("is a 200 no-op for an unknown video", async () => {
        connector.verifyWebhook.mockReturnValue({ providerVideoId: "nope" });
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue(null);
        const { POST } = await import("../webhook/[providerId]/route");
        const res = await POST(request({ raw: "{}" }), params);
        expect(res.status).toBe(200);
        expect(StreamingVideo.findOneAndUpdate).not.toHaveBeenCalled();
        expect(StreamingVideo.updateOne).not.toHaveBeenCalled();
    });

    it("does not trust the body status, it re-reads the provider", async () => {
        connector.verifyWebhook.mockReturnValue({ providerVideoId: "pv1" });
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue(known);
        connector.getVideo.mockResolvedValue({
            providerVideoId: "pv1",
            title: "t",
            status: "processing",
        });
        (StreamingVideo.findOneAndUpdate as jest.Mock).mockResolvedValue({});
        const { POST } = await import("../webhook/[providerId]/route");
        const res = await POST(
            request({ raw: JSON.stringify({ VideoGuid: "pv1", Status: 3 }) }),
            params,
        );
        expect(res.status).toBe(200);
        const set = (StreamingVideo.findOneAndUpdate as jest.Mock).mock
            .calls[0][1].$set;
        expect(set.status).toBe("processing");
        expect(getProviderConfig).toHaveBeenCalledWith("domain-id", "p1");
    });

    it("returns a controlled 500 for an incomplete provider config", async () => {
        (getConnector as jest.Mock).mockImplementation(() => {
            throw new Error("missing libraryId");
        });
        const { POST } = await import("../webhook/[providerId]/route");
        const res = await POST(request({ raw: "{}" }), params);
        expect(res.status).toBe(500);
        expect(JSON.stringify(await res.json())).not.toContain("libraryId");
    });

    it("returns 500 when the provider API fails", async () => {
        connector.verifyWebhook.mockReturnValue({ providerVideoId: "pv1" });
        (StreamingVideo.findOne as jest.Mock).mockResolvedValue(known);
        connector.getVideo.mockRejectedValue(new Error("down"));
        const { POST } = await import("../webhook/[providerId]/route");
        const res = await POST(request({ raw: "{}" }), params);
        expect(res.status).toBe(500);
    });
});
