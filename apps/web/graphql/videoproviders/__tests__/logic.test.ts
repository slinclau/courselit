/**
 * @jest-environment node
 */

import mongoose from "mongoose";
import VideoProviderModel from "@models/VideoProvider";
import StreamingVideoModel from "@models/StreamingVideo";

describe("models", () => {
    const domain = new mongoose.Types.ObjectId();

    beforeAll(async () => {
        await VideoProviderModel.init();
        await StreamingVideoModel.init();
    });

    afterEach(async () => {
        await VideoProviderModel.deleteMany({});
        await StreamingVideoModel.deleteMany({});
    });

    it("does not return secrets unless explicitly selected", async () => {
        await VideoProviderModel.create({
            domain,
            providerId: "p1",
            type: "bunny",
            name: "Bunny",
            settings: { libraryId: "123", cdnHostname: "vz-x.b-cdn.net" },
            secrets: { apiKey: "super-secret" },
        });

        const plain = await VideoProviderModel.findOne({
            domain,
            providerId: "p1",
        }).lean();
        expect(plain).not.toBeNull();
        expect((plain as any).secrets).toBeUndefined();
        expect(plain!.settings).toEqual({
            libraryId: "123",
            cdnHostname: "vz-x.b-cdn.net",
        });
        expect(plain!.active).toBe(false);

        const doc = await VideoProviderModel.findOne({
            domain,
            providerId: "p1",
        });
        expect((doc as any).secrets).toBeUndefined();

        const withSecrets = await VideoProviderModel.findOne({
            domain,
            providerId: "p1",
        }).select("+secrets");
        expect(withSecrets!.secrets).toEqual({ apiKey: "super-secret" });
    });

    it("rejects an unknown provider type", async () => {
        await expect(
            VideoProviderModel.create({
                domain,
                providerId: "p2",
                type: "other",
                name: "X",
            }),
        ).rejects.toThrow();
    });

    it("rejects a duplicate {domain, providerId} provider", async () => {
        const base = { domain, type: "bunny", name: "A" };
        await VideoProviderModel.create({ ...base, providerId: "dup" });
        await expect(
            VideoProviderModel.create({ ...base, providerId: "dup" }),
        ).rejects.toThrow(/duplicate key/i);
    });

    it("rejects a duplicate {domain, providerId, providerVideoId} video", async () => {
        const base = {
            domain,
            providerId: "p1",
            providerVideoId: "guid-1",
            title: "T",
            createdBy: "u1",
        };
        const first = await StreamingVideoModel.create({
            ...base,
            videoId: "v1",
        });
        expect(first.status).toBe("uploading");
        expect(first.courseId).toBeNull();
        await expect(
            StreamingVideoModel.create({ ...base, videoId: "v2" }),
        ).rejects.toThrow(/duplicate key/i);
    });

    it("rejects a duplicate {domain, videoId}", async () => {
        const base = {
            domain,
            providerId: "p1",
            title: "T",
            createdBy: "u1",
            videoId: "same",
        };
        await StreamingVideoModel.create({ ...base, providerVideoId: "a" });
        await expect(
            StreamingVideoModel.create({ ...base, providerVideoId: "b" }),
        ).rejects.toThrow(/duplicate key/i);
    });
});
