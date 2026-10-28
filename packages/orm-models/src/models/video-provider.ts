import mongoose from "mongoose";
import { generateUniqueId } from "@courselit/utils";
import type { VideoProviderType } from "@courselit/common-models";

export interface VideoProvider {
    domain: mongoose.Types.ObjectId;
    providerId: string;
    type: VideoProviderType;
    name: string;
    active: boolean;
    /** Non-secret settings, e.g. Bunny `libraryId` and `cdnHostname`. */
    settings: Record<string, string>;
    /** Never selected by default; use `.select("+secrets")` explicitly. */
    secrets?: Record<string, string>;
}

export const VideoProviderSchema = new mongoose.Schema<VideoProvider>(
    {
        domain: { type: mongoose.Schema.Types.ObjectId, required: true },
        providerId: {
            type: String,
            required: true,
            default: generateUniqueId,
        },
        type: { type: String, required: true, enum: ["bunny"] },
        name: { type: String, required: true },
        active: { type: Boolean, required: true, default: false },
        settings: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
            default: {},
        },
        secrets: { type: mongoose.Schema.Types.Mixed, select: false },
    },
    {
        timestamps: true,
        minimize: false,
    },
);

VideoProviderSchema.index({ domain: 1, providerId: 1 }, { unique: true });
