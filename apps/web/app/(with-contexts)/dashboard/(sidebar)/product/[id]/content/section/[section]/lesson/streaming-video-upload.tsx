"use client";

import { useContext, useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { Info } from "lucide-react";
import {
    StreamingVideoContent,
    StreamingVideoStatus,
} from "@courselit/common-models";
import { AddressContext } from "@components/contexts";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { VideoPlaceholder } from "@/components/video/video-placeholder";
import {
    STREAMING_VIDEO_NO_PROVIDER,
    STREAMING_VIDEO_READY,
    STREAMING_VIDEO_REPLACE,
    STREAMING_VIDEO_SAVE_FIRST,
    STREAMING_VIDEO_SAVES_DRAFT,
    STREAMING_VIDEO_SELECT_FILE,
    STREAMING_VIDEO_START_FAILED,
    STREAMING_VIDEO_UPLOAD_AGAIN,
    STREAMING_VIDEO_UPLOAD_FAILED,
    STREAMING_VIDEO_UPLOAD_INTERRUPTED,
} from "@ui-config/strings";

const POLL_INTERVAL_MS = 10000;
const TUS_RETRY_DELAYS = [0, 3000, 10000, 30000];

interface StreamingVideoUploadProps {
    lessonId?: string;
    content?: StreamingVideoContent;
    onVideoChange?: (videoId: string) => void;
    onUploadingChange?: (running: boolean) => void;
    /** Saves a new lesson so a video can be attached; returns its id. */
    createLesson?: (file: File) => Promise<string | undefined>;
}

/** Default title of a lesson created from a video file: its name. */
export function lessonTitleFromFileName(name: string) {
    const trimmed = name.trim();
    return trimmed.replace(
        /(.)\.(mp4|mov|m4v|webm|mkv|avi|mpe?g|ogv|3gp|wmv|flv)$/i,
        "$1",
    );
}

function formatDuration(totalSeconds: number) {
    const seconds = Math.round(totalSeconds);
    const s = String(seconds % 60).padStart(2, "0");
    return `${Math.floor(seconds / 60)}:${s}`;
}

export function StreamingVideoUpload({
    lessonId,
    content,
    onVideoChange,
    onUploadingChange,
    createLesson,
}: StreamingVideoUploadProps) {
    const address = useContext(AddressContext);
    const [videoId, setVideoId] = useState<string | undefined>(
        content?.videoId,
    );
    const [status, setStatus] = useState<StreamingVideoStatus | null>(null);
    const [thumbnailUrl, setThumbnailUrl] = useState<string>();
    const [durationSeconds, setDurationSeconds] = useState<number>();
    const [errorMessage, setErrorMessage] = useState<string>();
    const [failure, setFailure] = useState<string>();
    const [running, setRunning] = useState(false);
    const [creatingLesson, setCreatingLesson] = useState(false);
    const [progress, setProgress] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const uploadRef = useRef<tus.Upload | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            uploadRef.current?.abort();
        };
    }, []);

    const refreshStatus = async (id: string) => {
        try {
            const res = await fetch(`${address.backend}/api/video/${id}`);
            if (!res.ok || !mountedRef.current) return;
            const data = await res.json();
            if (!mountedRef.current) return;
            setStatus(data.status);
            setThumbnailUrl(data.thumbnailUrl ?? undefined);
            setDurationSeconds(data.durationSeconds ?? undefined);
            setErrorMessage(data.errorMessage ?? undefined);
        } catch {
            // The next poll tries again.
        }
    };

    // Load the status of the video already attached to the lesson.
    useEffect(() => {
        if (content?.videoId) {
            refreshStatus(content.videoId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        onUploadingChange?.(running);
        if (!running) return;
        const guard = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running]);

    // Poll only while the provider is still working on the video.
    const shouldPoll =
        !!videoId &&
        !running &&
        !failure &&
        (status === "uploading" || status === "processing");
    useEffect(() => {
        if (!shouldPoll || !videoId) return;
        const timer = setInterval(
            () => refreshStatus(videoId),
            POLL_INTERVAL_MS,
        );
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldPoll, videoId]);

    const markUploaded = async (id: string) => {
        try {
            const res = await fetch(
                `${address.backend}/api/video/${id}/uploaded`,
                {
                    method: "POST",
                },
            );
            if (!res.ok) throw new Error("uploaded call failed");
            const data = await res.json();
            if (mountedRef.current) setStatus(data.status);
        } catch {
            if (mountedRef.current) setFailure(STREAMING_VIDEO_UPLOAD_FAILED);
        }
    };

    const startUpload = async (file: File) => {
        let targetLessonId = lessonId;
        if (!targetLessonId && createLesson) {
            setCreatingLesson(true);
            try {
                targetLessonId = await createLesson(file);
            } finally {
                if (mountedRef.current) setCreatingLesson(false);
            }
        }
        if (!targetLessonId || !mountedRef.current) return;
        setFailure(undefined);
        setProgress(0);
        let res: Response;
        try {
            res = await fetch(`${address.backend}/api/video/uploads`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lessonId: targetLessonId,
                    filename: file.name,
                    filetype: file.type,
                }),
            });
        } catch {
            setFailure(STREAMING_VIDEO_START_FAILED);
            return;
        }
        if (!mountedRef.current) return;
        if (!res.ok) {
            setFailure(
                res.status === 409
                    ? STREAMING_VIDEO_NO_PROVIDER
                    : STREAMING_VIDEO_START_FAILED,
            );
            return;
        }
        let newVideoId: string;
        let upload: any;
        try {
            ({ videoId: newVideoId, upload } = await res.json());
        } catch {
            if (mountedRef.current) setFailure(STREAMING_VIDEO_START_FAILED);
            return;
        }
        if (!mountedRef.current) return;

        setVideoId(newVideoId);
        onVideoChange?.(newVideoId);
        setStatus("uploading");
        setErrorMessage(undefined);
        setThumbnailUrl(undefined);
        setDurationSeconds(undefined);
        setRunning(true);

        const tusUpload = new tus.Upload(file, {
            endpoint: upload.endpoint,
            headers: upload.headers,
            metadata: upload.metadata,
            retryDelays: TUS_RETRY_DELAYS,
            onProgress: (sent: number, total: number) => {
                if (mountedRef.current && total > 0) {
                    setProgress(Math.round((sent / total) * 100));
                }
            },
            onError: () => {
                if (!mountedRef.current) return;
                uploadRef.current = null;
                setRunning(false);
                setFailure(STREAMING_VIDEO_UPLOAD_FAILED);
            },
            onSuccess: () => {
                if (!mountedRef.current) return;
                uploadRef.current = null;
                setRunning(false);
                markUploaded(newVideoId);
            },
        });
        uploadRef.current = tusUpload;
        tusUpload.start();
    };

    if (!lessonId && !createLesson) {
        return (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Info className="w-4 h-4" />
                {STREAMING_VIDEO_SAVE_FIRST}
            </p>
        );
    }

    const interrupted = !running && status === "uploading" && !failure;
    const canPick =
        !running &&
        !creatingLesson &&
        (!videoId ||
            !!failure ||
            interrupted ||
            status === "error" ||
            status === "ready");
    const pickLabel =
        !videoId && !failure
            ? STREAMING_VIDEO_SELECT_FILE
            : status === "ready" && !failure
              ? STREAMING_VIDEO_REPLACE
              : STREAMING_VIDEO_UPLOAD_AGAIN;

    return (
        <div className="space-y-4">
            {running && (
                <div className="space-y-2">
                    <Progress value={progress} aria-label="Upload progress" />
                    <p className="text-sm text-muted-foreground">{progress}%</p>
                </div>
            )}
            {!running && videoId && status && (
                <div
                    className="w-full max-w-md"
                    data-testid="streaming-video-preview"
                >
                    <VideoPlaceholder
                        status={status}
                        thumbnailUrl={thumbnailUrl}
                    />
                </div>
            )}
            {!running && status === "ready" && !failure && (
                <p className="text-sm text-muted-foreground">
                    {STREAMING_VIDEO_READY}
                    {durationSeconds !== undefined && (
                        <>
                            {" · "}
                            <span>{formatDuration(durationSeconds)}</span>
                        </>
                    )}
                </p>
            )}
            {!running && status === "error" && errorMessage && (
                <p className="text-sm text-red-500">{errorMessage}</p>
            )}
            {interrupted && (
                <p className="text-sm text-muted-foreground">
                    {STREAMING_VIDEO_UPLOAD_INTERRUPTED}
                </p>
            )}
            {failure && <p className="text-sm text-red-500">{failure}</p>}
            {!lessonId && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    {STREAMING_VIDEO_SAVES_DRAFT}
                </p>
            )}
            <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="hidden"
                data-testid="streaming-video-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) startUpload(file);
                }}
            />
            {canPick && (
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => inputRef.current?.click()}
                >
                    {pickLabel}
                </Button>
            )}
        </div>
    );
}
