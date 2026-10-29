import React from "react";
import {
    render,
    screen,
    fireEvent,
    waitFor,
    act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { AddressContext } from "@components/contexts";
import { StreamingVideoUpload } from "../streaming-video-upload";

const tusInstances: any[] = [];
jest.mock("tus-js-client", () => ({
    Upload: jest.fn().mockImplementation((file: any, options: any) => {
        const instance = {
            file,
            options,
            start: jest.fn(),
            abort: jest.fn(),
        };
        tusInstances.push(instance);
        return instance;
    }),
}));

const address = { backend: "http://backend", frontend: "http://frontend" };

function jsonResponse(body: any, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    });
}

const uploadInstructions = {
    videoId: "vid-1",
    upload: {
        protocol: "tus",
        endpoint: "https://tus.example/upload",
        headers: { Signature: "sig" },
        metadata: { videoid: "p-1" },
        expiresAt: "2030-01-01T00:00:00.000Z",
    },
};

function setup(props: any = {}) {
    return render(
        <AddressContext.Provider value={address as any}>
            <StreamingVideoUpload lessonId="lesson-1" {...props} />
        </AddressContext.Provider>,
    );
}

function pickFile() {
    const input = screen.getByTestId("streaming-video-input");
    const file = new File(["x"], "movie.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });
    return file;
}

describe("StreamingVideoUpload", () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        tusInstances.length = 0;
        fetchMock = jest.fn();
        (global as any).fetch = fetchMock;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("asks to save the lesson first when it has no id", () => {
        setup({ lessonId: undefined });
        expect(
            screen.getByText("Save the lesson to upload a video"),
        ).toBeInTheDocument();
        expect(
            screen.queryByTestId("streaming-video-input"),
        ).not.toBeInTheDocument();
    });

    it("uploads with tus, shows progress, then the processing state", async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.endsWith("/api/video/uploads"))
                return jsonResponse(uploadInstructions);
            if (url.endsWith("/api/video/vid-1/uploaded"))
                return jsonResponse({ status: "processing" });
            if (url.endsWith("/api/video/vid-1"))
                return jsonResponse({ status: "processing" });
            throw new Error(`unexpected ${url}`);
        });
        setup();
        const file = pickFile();

        await waitFor(() => expect(tusInstances).toHaveLength(1));
        const tus = tusInstances[0];
        expect(fetchMock).toHaveBeenCalledWith(
            "http://backend/api/video/uploads",
            expect.objectContaining({ method: "POST" }),
        );
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            lessonId: "lesson-1",
            filename: "movie.mp4",
            filetype: "video/mp4",
        });
        expect(tus.file).toBe(file);
        expect(tus.options.endpoint).toBe("https://tus.example/upload");
        expect(tus.options.headers).toEqual({ Signature: "sig" });
        expect(tus.options.metadata).toEqual({ videoid: "p-1" });
        expect(tus.options.retryDelays).toEqual([0, 3000, 10000, 30000]);
        expect(tus.start).toHaveBeenCalled();

        act(() => tus.options.onProgress(50, 100));
        expect(screen.getByRole("progressbar")).toBeInTheDocument();
        expect(screen.getByText(/50%/)).toBeInTheDocument();

        await act(async () => {
            tus.options.onSuccess();
        });
        expect(
            await screen.findByText("Video is being processed"),
        ).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(
            "http://backend/api/video/vid-1/uploaded",
            expect.objectContaining({ method: "POST" }),
        );
    });

    it("polls while processing and shows the thumbnail once ready", async () => {
        const statuses = [
            { status: "processing" },
            {
                status: "ready",
                durationSeconds: 125,
                thumbnailUrl: "https://cdn.example/thumb.jpg",
            },
        ];
        fetchMock.mockImplementation(() =>
            jsonResponse(statuses.length > 1 ? statuses.shift() : statuses[0]),
        );
        setup({ content: { videoId: "vid-1" } });

        expect(
            await screen.findByText("Video is being processed"),
        ).toBeInTheDocument();

        await act(async () => {
            jest.advanceTimersByTime(10000);
        });
        const img = await screen.findByRole("img");
        expect(img).toHaveAttribute("src", "https://cdn.example/thumb.jpg");
        expect(screen.getByText("2:05")).toBeInTheDocument();

        const callsAfterReady = fetchMock.mock.calls.length;
        await act(async () => {
            jest.advanceTimersByTime(30000);
        });
        expect(fetchMock.mock.calls.length).toBe(callsAfterReady);
    });

    it("stops polling on unmount", async () => {
        fetchMock.mockImplementation(() =>
            jsonResponse({ status: "processing" }),
        );
        const { unmount } = setup({ content: { videoId: "vid-1" } });
        await screen.findByText("Video is being processed");
        unmount();
        const calls = fetchMock.mock.calls.length;
        await act(async () => {
            jest.advanceTimersByTime(60000);
        });
        expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it("shows the error and an Upload again action on error", async () => {
        fetchMock.mockImplementation(() =>
            jsonResponse({ status: "error", errorMessage: "Bad codec" }),
        );
        setup({ content: { videoId: "vid-1" } });
        expect(
            await screen.findByRole("button", { name: "Upload again" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Bad codec")).toBeInTheDocument();
    });

    it("lets the author upload again when a previous upload never finished", async () => {
        fetchMock.mockImplementation(() =>
            jsonResponse({ status: "uploading" }),
        );
        setup({ content: { videoId: "vid-1" } });
        expect(
            await screen.findByText("The previous upload did not finish"),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Upload again" }),
        ).toBeInTheDocument();
    });

    it("tells the author to configure a provider on 409", async () => {
        fetchMock.mockImplementation(() =>
            jsonResponse({ message: "No active video provider" }, 409),
        );
        setup();
        pickFile();
        expect(
            await screen.findByText(/No video provider is set up/),
        ).toBeInTheDocument();
        expect(tusInstances).toHaveLength(0);
    });

    it("aborts a running tus upload on unmount", async () => {
        fetchMock.mockImplementation(() => jsonResponse(uploadInstructions));
        const { unmount } = setup();
        pickFile();
        await waitFor(() => expect(tusInstances).toHaveLength(1));
        unmount();
        expect(tusInstances[0].abort).toHaveBeenCalled();
    });
});
