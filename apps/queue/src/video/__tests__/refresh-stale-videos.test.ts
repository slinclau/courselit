/**
 * @jest-environment node
 */

import mongoose from "mongoose";
import StreamingVideoModel from "../../domain/model/streaming-video";
import VideoProviderModel from "../../domain/model/video-provider";
import { refreshStaleVideos } from "../refresh-stale-videos";

const mockGetVideo = jest.fn();
const mockListVideos = jest.fn();
const mockGetConnector = jest.fn();

jest.mock("@courselit/video-providers", () => ({
    ...jest.requireActual("@courselit/video-providers"),
    getConnector: (...args: any[]) => mockGetConnector(...args),
}));
// The queue jest setup mocks nanoid to a constant; ids must be unique here.
let idCounter = 0;
jest.mock("@courselit/utils", () => ({
    ...jest.requireActual("@courselit/utils"),
    generateUniqueId: () => `vid-${++idCounter}`,
}));
jest.mock("../../logger", () => ({
    logger: { info: jest.fn(), error: jest.fn() },
}));

const NOW = new Date("2026-10-29T12:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const domain = new mongoose.Types.ObjectId();

async function addProvider(providerId = "p1") {
    return VideoProviderModel.create({
        domain,
        providerId,
        type: "bunny",
        name: "Bunny",
        active: true,
        settings: { libraryId: "1" },
        secrets: { apiKey: "SECRET-KEY" },
    });
}

async function addVideo(overrides: Record<string, any> = {}) {
    const { createdAt, ...rest } = overrides;
    const doc = await StreamingVideoModel.create({
        domain,
        providerId: "p1",
        videoId: "seed-" + Math.random(),
        providerVideoId: "pv-" + Math.random(),
        title: "t",
        createdBy: "u",
        status: "processing",
        ...rest,
    });
    if (createdAt) {
        await StreamingVideoModel.collection.updateOne(
            { _id: doc._id },
            { $set: { createdAt } },
        );
    }
    return doc;
}

describe("refreshStaleVideos", () => {
    beforeEach(async () => {
        await StreamingVideoModel.deleteMany({});
        await VideoProviderModel.deleteMany({});
        mockGetVideo.mockReset();
        mockListVideos.mockReset();
        mockGetConnector.mockReset();
        mockListVideos.mockResolvedValue({ items: [], hasMore: false });
        mockGetConnector.mockReturnValue({
            getVideo: mockGetVideo,
            listVideos: mockListVideos,
        });
    });

    it("moves a stale processing video to ready", async () => {
        await addProvider();
        const v = await addVideo({
            status: "processing",
            lastCheckedAt: new Date(NOW.getTime() - 10 * MIN),
            createdAt: new Date(NOW.getTime() - HOUR),
        });
        mockGetVideo.mockResolvedValue({
            providerVideoId: v.providerVideoId,
            title: "t",
            status: "ready",
            durationSeconds: 42,
        });

        const result = await refreshStaleVideos(NOW);

        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("ready");
        expect(after.durationSeconds).toBe(42);
        expect(after.readyAt).toEqual(NOW);
        expect(after.lastCheckedAt).toEqual(NOW);
        expect(result).toEqual({ refreshed: 1, failed: 0, imported: 0 });
        expect(mockGetConnector).toHaveBeenCalledWith(
            expect.objectContaining({
                secrets: { apiKey: "SECRET-KEY" },
                settings: { libraryId: "1" },
            }),
        );
    });

    it("refreshes a video that was never checked", async () => {
        await addProvider();
        const v = await addVideo({ status: "uploading" });
        mockGetVideo.mockResolvedValue({
            providerVideoId: v.providerVideoId,
            title: "t",
            status: "processing",
        });
        await refreshStaleVideos(NOW);
        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("processing");
    });

    it.each(["uploading", "processing"])(
        "marks a 25 h old %s video as error when the provider still says uploading",
        async (stored) => {
            await addProvider();
            const v = await addVideo({
                status: stored,
                lastCheckedAt: new Date(NOW.getTime() - 10 * MIN),
                createdAt: new Date(NOW.getTime() - 25 * HOUR),
            });
            mockGetVideo.mockResolvedValue({
                providerVideoId: v.providerVideoId,
                title: "t",
                status: "uploading",
            });

            await refreshStaleVideos(NOW);

            const after: any = await StreamingVideoModel.findById(v._id).lean();
            expect(after.status).toBe("error");
            expect(after.errorMessage).toBe("Upload did not complete");
        },
    );

    it("keeps a recent uploading video uploading", async () => {
        await addProvider();
        const v = await addVideo({
            status: "uploading",
            lastCheckedAt: new Date(NOW.getTime() - 10 * MIN),
            createdAt: new Date(NOW.getTime() - 2 * HOUR),
        });
        mockGetVideo.mockResolvedValue({
            providerVideoId: v.providerVideoId,
            title: "t",
            status: "uploading",
        });
        await refreshStaleVideos(NOW);
        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("uploading");
    });

    it("marks a video missing at the provider as error without deleting it", async () => {
        await addProvider();
        const v = await addVideo({ status: "processing" });
        mockGetVideo.mockResolvedValue(null);
        await refreshStaleVideos(NOW);
        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("error");
        expect(after.errorMessage).toBe("Video not found at provider");
    });

    it("imports unknown provider videos unfiled, idempotently", async () => {
        await addProvider();
        await addVideo({ providerVideoId: "known", status: "ready" });
        mockListVideos.mockResolvedValue({
            items: [
                { providerVideoId: "known", title: "Known", status: "ready" },
                {
                    providerVideoId: "new-1",
                    title: "From provider",
                    status: "ready",
                    durationSeconds: 7,
                },
            ],
            hasMore: false,
        });

        const first = await refreshStaleVideos(NOW);
        const second = await refreshStaleVideos(NOW);

        expect(first.imported).toBe(1);
        expect(second.imported).toBe(0);
        const imported: any = await StreamingVideoModel.findOne({
            providerVideoId: "new-1",
        }).lean();
        expect(imported.courseId).toBeNull();
        expect(imported.title).toBe("From provider");
        expect(imported.status).toBe("ready");
        expect(imported.durationSeconds).toBe(7);
        expect(imported.createdBy).toBe("system");
        expect(imported.videoId).toBeTruthy();
        expect(String(imported.domain)).toBe(String(domain));
        expect(await StreamingVideoModel.countDocuments({})).toBe(2);
    });

    it("pages through the provider list", async () => {
        await addProvider();
        mockListVideos
            .mockResolvedValueOnce({
                items: [{ providerVideoId: "a", title: "A", status: "ready" }],
                hasMore: true,
            })
            .mockResolvedValueOnce({
                items: [{ providerVideoId: "b", title: "B", status: "ready" }],
                hasMore: false,
            });
        const result = await refreshStaleVideos(NOW);
        expect(result.imported).toBe(2);
        expect(mockListVideos).toHaveBeenNthCalledWith(2, { page: 2 });
    });

    it("leaves fresh and finished records untouched", async () => {
        await addProvider();
        const fresh = await addVideo({
            status: "processing",
            lastCheckedAt: new Date(NOW.getTime() - 1 * MIN),
        });
        const ready = await addVideo({
            status: "ready",
            lastCheckedAt: new Date(NOW.getTime() - HOUR),
        });
        const result = await refreshStaleVideos(NOW);
        expect(mockGetVideo).not.toHaveBeenCalled();
        expect(result.refreshed).toBe(0);
        const after: any = await StreamingVideoModel.findById(fresh._id).lean();
        expect(after.status).toBe("processing");
        expect(
            ((await StreamingVideoModel.findById(ready._id).lean()) as any)
                .status,
        ).toBe("ready");
    });

    it("keeps going when one provider fails and never logs secrets", async () => {
        await addProvider("p1");
        await addProvider("p2");
        const v1 = await addVideo({ providerId: "p1", status: "processing" });
        const v2 = await addVideo({ providerId: "p2", status: "processing" });
        mockGetConnector.mockImplementation((config: any) => ({
            getVideo: async (id: string) => {
                if (id === v1.providerVideoId) {
                    throw new Error("boom");
                }
                return { providerVideoId: id, title: "t", status: "ready" };
            },
            listVideos: mockListVideos,
        }));

        const result = await refreshStaleVideos(NOW);

        expect(result.failed).toBe(1);
        expect(result.refreshed).toBe(1);
        const a: any = await StreamingVideoModel.findById(v1._id).lean();
        const b: any = await StreamingVideoModel.findById(v2._id).lean();
        expect(a.status).toBe("processing");
        expect(b.status).toBe("ready");
        const { logger } = jest.requireMock("../../logger");
        const logged = JSON.stringify(logger.error.mock.calls);
        expect(logged).toContain("boom");
        expect(logged).not.toContain("SECRET-KEY");
    });

    it("counts a provider whose listing fails and continues", async () => {
        await addProvider("p1");
        await addProvider("p2");
        mockListVideos
            .mockRejectedValueOnce(new Error("list down"))
            .mockResolvedValueOnce({
                items: [{ providerVideoId: "x", title: "X", status: "ready" }],
                hasMore: false,
            });
        const result = await refreshStaleVideos(NOW);
        expect(result.failed).toBe(1);
        expect(result.imported).toBe(1);
    });
});
