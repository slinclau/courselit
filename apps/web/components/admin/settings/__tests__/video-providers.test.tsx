import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AddressContext } from "@components/contexts";
import VideoProviders from "../video-providers";

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
});
