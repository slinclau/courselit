import mongoose from "mongoose";
import { generateUniqueId } from "@courselit/utils";
import type { StreamingVideo } from "@courselit/common-models";

export interface InternalStreamingVideo
    extends Omit<StreamingVideo, "createdAt"> {
    domain: mongoose.Types.ObjectId;
}

export const StreamingVideoSchema = new mongoose.Schema<InternalStreamingVideo>(
    {
        domain: { type: mongoose.Schema.Types.ObjectId, required: true },
        videoId: {
            type: String,
            required: true,
            default: generateUniqueId,
        },
        providerId: { type: String, required: true },
        providerVideoId: { type: String, required: true },
        courseId: { type: String, default: null },
        title: { type: String, required: true },
        status: {
            type: String,
            required: true,
            enum: ["uploading", "processing", "ready", "error"],
            default: "uploading",
        },
        errorMessage: { type: String },
        durationSeconds: { type: Number },
        thumbnailUrl: { type: String },
        createdBy: { type: String, required: true },
        readyAt: { type: Date },
        lastCheckedAt: { type: Date },
    },
    {
        timestamps: true,
    },
);

StreamingVideoSchema.index({ domain: 1, videoId: 1 }, { unique: true });
StreamingVideoSchema.index(
    { domain: 1, providerId: 1, providerVideoId: 1 },
    { unique: true },
);
StreamingVideoSchema.index({ status: 1, lastCheckedAt: 1 });
