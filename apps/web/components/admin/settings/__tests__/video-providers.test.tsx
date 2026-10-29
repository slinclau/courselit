import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AddressContext } from "@components/contexts";
import VideoProviders from "../video-providers";
import {
    VIDEO_PROVIDER_DISCARD_CONFIRM_ACTION,
    VIDEO_PROVIDER_DISCARD_CONFIRM_TITLE,
} from "@ui-config/strings";

const mockExec = jest.fn();
jest.mock("@courselit/utils", () => ({
    ...jest.requireActual("@courselit/utils"),
    FetchBuilder: jest.fn().mockImplementation(() => {
        const builder: any = {
            setUrl: () => builder,
            setPayload: () => builder,
            setIsGraphQLEndpoint: () => builder,
            build: () => ({ exec: mockExec }),
        };
        return builder;
    }),
}));

const mockToast = jest.fn();
jest.mock("@courselit/components-library", () => ({
    useToast: () => ({ toast: mockToast }),
}));

const provider = (overrides: Record<string, unknown> = {}) => ({
    providerId: "prov1",
    type: "bunny",
    name: "My Bunny",
    active: true,
    videoCount: 0,
    settings: [
        { key: "libraryId", value: "123" },
        { key: "cdnHostname", value: "vz-x.b-cdn.net" },
    ],
    secretsLast4: [{ key: "apiKey", value: "1234" }],
    ...overrides,
});

const renderIt = () =>
    render(
        <AddressContext.Provider
            value={{ backend: "https://school.example", frontend: "" }}
        >
            <VideoProviders />
        </AddressContext.Provider>,
    );

describe("VideoProviders settings", () => {
    beforeEach(() => mockExec.mockReset());

    it("shows the masked secret and the webhook URL, never a full secret", async () => {
        mockExec.mockResolvedValue({ providers: [provider()] });
        renderIt();

        expect(await screen.findByText("My Bunny")).toBeTruthy();
        expect(screen.getByText("Active")).toBeTruthy();
        expect(screen.getByText(/••••1234/)).toBeTruthy();
        expect(
            screen.getByText("https://school.example/api/video/webhook/prov1"),
        ).toBeTruthy();
    });

    it("enables Remove when the provider has no videos", async () => {
        mockExec.mockResolvedValue({ providers: [provider()] });
        renderIt();
        const button = await screen.findByRole("button", { name: /Remove/ });
        expect((button as HTMLButtonElement).disabled).toBe(false);
    });

    it("disables Remove when the provider has videos", async () => {
        mockExec.mockResolvedValue({
            providers: [provider({ videoCount: 3 })],
        });
        renderIt();
        const button = await screen.findByRole("button", { name: /Remove/ });
        expect((button as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows the result of a connection test", async () => {
        mockExec
            .mockResolvedValueOnce({ providers: [provider()] })
            .mockResolvedValueOnce({
                result: { ok: true, message: "Connected. 2 video(s) found." },
            });
        renderIt();
        fireEvent.click(
            await screen.findByRole("button", { name: "Test connection" }),
        );
        await waitFor(() =>
            expect(screen.getByRole("status").textContent).toContain(
                "Connected",
            ),
        );
    });
    it("tells where to find each Bunny value in the Bunny dashboard", async () => {
        mockExec.mockResolvedValue({ providers: [] });
        renderIt();
        fireEvent.click(
            await screen.findByRole("button", { name: "Add provider" }),
        );
        expect(
            await screen.findByText(/API page: Video library ID/),
        ).toBeTruthy();
        expect(screen.getByText(/API page: CDN hostname/)).toBeTruthy();
        expect(screen.getByText(/API page: API Key/)).toBeTruthy();
        expect(screen.getByText(/API page: Read-only API Key/)).toBeTruthy();
        expect(
            screen.getByText(/Security → General: Token authentication key/),
        ).toBeTruthy();
    });
    const openAddDialog = async () => {
        mockExec.mockResolvedValue({ providers: [] });
        renderIt();
        fireEvent.click(
            await screen.findByRole("button", { name: "Add provider" }),
        );
        return screen.findByRole("dialog");
    };

    it("keeps the provider dialog open on a click outside it", async () => {
        await openAddDialog();
        fireEvent.pointerDown(document.body);
        fireEvent.focusIn(document.body);
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("asks before discarding typed values", async () => {
        const dialog = await openAddDialog();
        fireEvent.change(screen.getByLabelText("Library ID"), {
            target: { value: "123" },
        });
        fireEvent.keyDown(dialog, { key: "Escape" });
        expect(
            await screen.findByText(VIDEO_PROVIDER_DISCARD_CONFIRM_TITLE),
        ).toBeTruthy();
        expect(screen.getByText("Add a video provider")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", {
                name: VIDEO_PROVIDER_DISCARD_CONFIRM_ACTION,
            }),
        );
        await waitFor(() =>
            expect(screen.queryByText("Add a video provider")).toBeNull(),
        );
    });

    it("closes an untouched dialog without asking", async () => {
        await openAddDialog();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() =>
            expect(screen.queryByText("Add a video provider")).toBeNull(),
        );
        expect(
            screen.queryByText(VIDEO_PROVIDER_DISCARD_CONFIRM_TITLE),
        ).toBeNull();
    });

    it("tells password managers to leave the key fields alone", async () => {
        await openAddDialog();
        const secret = screen.getByLabelText("API key");
        expect(secret.getAttribute("autocomplete")).toBe("off");
        expect(secret.hasAttribute("data-1p-ignore")).toBe(true);
        expect(secret.getAttribute("data-lpignore")).toBe("true");
    });
});
