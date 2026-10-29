import type { DetailedHTMLProps, HTMLAttributes } from "react";

// React 19 does not know the `hls-video` custom element by itself.
declare module "react" {
    namespace JSX {
        interface IntrinsicElements {
            "hls-video": DetailedHTMLProps<
                HTMLAttributes<HTMLElement>,
                HTMLElement
            > & {
                src?: string;
                controls?: boolean;
                playsinline?: boolean;
            };
        }
    }
}
