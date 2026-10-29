import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StreamingVideoViewer } from "../streaming-video-viewer";

jest.mock("hls-video-element", () => ({}));

const address = { backend: "http://localhost" } as any;
const baseProps = {
    videoId: "v1",
    lessonId: "l1",
    courseId: "c1",
    address,
};

function respond(status: number, body: unknown) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    });
}

const ready = (expiresInMs = 4 * 60 * 60 * 1000) => ({
    status: "ready",
    playback: {
        kind: "hls",
        url: "https://cdn.example/t/v1/playlist.m3u8",
        expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    },
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("StreamingVideoViewer", () => {
    it("shows the placeholder while the video is processing", async () => {
        global.fetch = jest
            .fn()
            .mockReturnValue(respond(200, { status: "processing" })) as any;
        const { container } = render(<StreamingVideoViewer {...baseProps} />);
        await screen.findByText("Video is being processed");
        expect(container.querySelector("hls-video")).toBeNull();
    });

    it("asks the playback route for the lesson's video", async () => {
        const fetchMock = jest.fn().mockReturnValue(respond(200, ready()));
        global.fetch = fetchMock as any;
        render(<StreamingVideoViewer {...baseProps} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(fetchMock.mock.calls[0][0]).toBe(
            "http://localhost/api/video/v1/playback?lessonId=l1&courseId=c1",
        );
    });

    it("plays the signed URL and reports the end of the video once", async () => {
        global.fetch = jest.fn().mockReturnValue(respond(200, ready())) as any;
        const onEnded = jest.fn();
        const { container } = render(
            <StreamingVideoViewer {...baseProps} onEnded={onEnded} />,
        );
        await waitFor(() =>
            expect(container.querySelector("hls-video")).not.toBeNull(),
        );
        const el = container.querySelector("hls-video")!;
        expect(el.getAttribute("src")).toBe(
            "https://cdn.example/t/v1/playlist.m3u8",
        );
        expect(el.hasAttribute("controls")).toBe(true);
        act(() => {
            el.dispatchEvent(new Event("ended"));
            el.dispatchEvent(new Event("ended"));
        });
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it("renders nothing on 403", async () => {
        global.fetch = jest
            .fn()
            .mockReturnValue(respond(403, { message: "Forbidden" })) as any;
        const { container } = render(<StreamingVideoViewer {...baseProps} />);
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        await act(async () => {});
        expect(container).toBeEmptyDOMElement();
    });

    it("refetches the URL five minutes before it expires", async () => {
        jest.useFakeTimers();
        const fetchMock = jest
            .fn()
            .mockImplementation(() => respond(200, ready(3600 * 1000)));
        global.fetch = fetchMock as any;
        render(<StreamingVideoViewer {...baseProps} />);
        await act(async () => {});
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => {
            jest.advanceTimersByTime(3600 * 1000 - 5 * 60 * 1000 - 1000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stops refreshing once unmounted", async () => {
        jest.useFakeTimers();
        const fetchMock = jest
            .fn()
            .mockImplementation(() => respond(200, ready(3600 * 1000)));
        global.fetch = fetchMock as any;
        const { unmount } = render(<StreamingVideoViewer {...baseProps} />);
        await act(async () => {});
        unmount();
        await act(async () => {
            jest.advanceTimersByTime(4000 * 1000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
