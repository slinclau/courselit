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

export interface ProviderConfig {
    type: VideoProviderType;
    settings: Record<string, string>;
    secrets: Record<string, string>;
}

export interface ProviderVideo {
    providerVideoId: string;
    title: string;
    status: StreamingVideoStatus;
    durationSeconds?: number;
    thumbnailUrl?: string;
    groupId?: string;
    createdAt?: Date;
}

export interface UploadInstructions {
    protocol: "tus";
    endpoint: string;
    headers: Record<string, string>;
    metadata: Record<string, string>;
    expiresAt: Date;
}

export interface Playback {
    kind: "hls";
    url: string;
    expiresAt: Date;
}

export interface VideoProviderConnector {
    testConnection(): Promise<
        { ok: true; videoCount: number } | { ok: false; error: string }
    >;
    /** Returns the provider group id. */
    ensureGroup(key: string, title: string): Promise<string>;
    createUpload(input: {
        title: string;
        groupId?: string;
        filetype: string;
    }): Promise<{ providerVideoId: string; upload: UploadInstructions }>;
    /** null = not found at provider */
    getVideo(providerVideoId: string): Promise<ProviderVideo | null>;
    listVideos(input: {
        page: number;
    }): Promise<{ items: ProviderVideo[]; hasMore: boolean }>;
    /** null = reject */
    verifyWebhook(
        rawBody: string,
        headers: { get(name: string): string | null },
    ): { providerVideoId: string } | null;
    getPlayback(providerVideoId: string, ttlSeconds: number): Playback;
}
