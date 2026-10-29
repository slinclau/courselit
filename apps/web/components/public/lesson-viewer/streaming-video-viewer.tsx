"use client";

import { useEffect, useRef, useState } from "react";
import type { Address, StreamingVideoStatus } from "@courselit/common-models";
import { VideoPlaceholder } from "@/components/video/video-placeholder";

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const MIN_REFRESH_DELAY_MS = 30 * 1000;

interface StreamingVideoViewerProps {
    videoId: string;
    lessonId: string;
    courseId: string;
    address: Address;
    /** Called once, the first time the video plays to its end. */
    onEnded?: () => void;
}

type PlaybackState =
    | { kind: "loading" }
    | { kind: "forbidden" }
    | { kind: "pending"; status: StreamingVideoStatus }
    | { kind: "ready"; url: string; expiresAt: number };

/**
 * Plays a streaming video through `<hls-video>`. The signed URL comes from
 * the playback route and is renewed shortly before it expires.
 */
export function StreamingVideoViewer({
    videoId,
    lessonId,
    courseId,
    address,
    onEnded,
}: StreamingVideoViewerProps) {
    const [state, setState] = useState<PlaybackState>({ kind: "loading" });
    const videoRef = useRef<HTMLElement | null>(null);
    const onEndedRef = useRef(onEnded);
    const endedRef = useRef(false);
    const resumeRef = useRef<{ time: number; paused: boolean } | null>(null);
    onEndedRef.current = onEnded;

    useEffect(() => {
        // Registers the custom element in the browser only.
        import("hls-video-element").catch(() => {});
    }, []);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const load = async () => {
            let next: PlaybackState;
            try {
                const res = await fetch(
                    `${address.backend}/api/video/${videoId}/playback?lessonId=${encodeURIComponent(lessonId)}&courseId=${encodeURIComponent(courseId)}`,
                    { cache: "no-store" },
                );
                if (res.status === 403) {
                    next = { kind: "forbidden" };
                } else if (!res.ok) {
                    next = { kind: "pending", status: "error" };
                } else {
                    const data = await res.json();
                    next =
                        data.status === "ready" && data.playback?.url
                            ? {
                                  kind: "ready",
                                  url: data.playback.url,
                                  expiresAt: new Date(
                                      data.playback.expiresAt,
                                  ).getTime(),
                              }
                            : { kind: "pending", status: data.status };
                }
            } catch {
                next = { kind: "pending", status: "error" };
            }
            if (cancelled) return;

            if (next.kind === "ready") {
                const el = videoRef.current as HTMLVideoElement | null;
                if (el && !Number.isNaN(el.currentTime)) {
                    resumeRef.current = {
                        time: el.currentTime,
                        paused: el.paused,
                    };
                }
                timer = setTimeout(
                    load,
                    Math.max(
                        next.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS,
                        MIN_REFRESH_DELAY_MS,
                    ),
                );
            }
            setState(next);
        };

        load();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [videoId, lessonId, courseId, address.backend]);

    const url = state.kind === "ready" ? state.url : undefined;
    useEffect(() => {
        const el = videoRef.current as HTMLVideoElement | null;
        if (!el) return;
        const handleEnded = () => {
            if (endedRef.current) return;
            endedRef.current = true;
            onEndedRef.current?.();
        };
        const handleLoaded = () => {
            const resume = resumeRef.current;
            resumeRef.current = null;
            if (!resume || !resume.time) return;
            el.currentTime = resume.time;
            if (!resume.paused) el.play?.().catch(() => {});
        };
        el.addEventListener("ended", handleEnded);
        el.addEventListener("loadedmetadata", handleLoaded);
        return () => {
            el.removeEventListener("ended", handleEnded);
            el.removeEventListener("loadedmetadata", handleLoaded);
        };
    }, [url]);

    if (state.kind === "forbidden") {
        return null;
    }
    if (state.kind === "loading") {
        return <div className="aspect-video w-full rounded-md bg-muted" />;
    }
    if (state.kind === "pending") {
        return <VideoPlaceholder status={state.status} />;
    }
    return (
        <hls-video
            ref={videoRef}
            src={state.url}
            controls
            playsinline
            className="aspect-video w-full rounded-md bg-black"
        />
    );
}
