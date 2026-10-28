export type StreamingVideoStatus =
    | "uploading"
    | "processing"
    | "ready"
    | "error";

export type VideoProviderType = "bunny";

export interface StreamingVideo {
    videoId: string;
    providerId: string;
    providerVideoId: string;
    courseId: string | null;
    title: string;
    status: StreamingVideoStatus;
    errorMessage?: string;
    durationSeconds?: number;
    thumbnailUrl?: string;
    createdBy: string;
    createdAt: Date;
    readyAt?: Date;
    lastCheckedAt?: Date;
}

export interface VideoProviderPublic {
    providerId: string;
    type: VideoProviderType;
    name: string;
    active: boolean;
    settings: Record<string, string>;
    secretsLast4: Record<string, string>;
    videoCount: number;
}

/** Lesson content of a `streaming_video` lesson; empty before upload. */
export interface StreamingVideoContent {
    videoId?: string;
}
