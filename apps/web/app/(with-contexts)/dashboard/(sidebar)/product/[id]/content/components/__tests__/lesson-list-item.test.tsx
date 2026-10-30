import React from "react";
import { render, screen } from "@testing-library/react";
import { Constants } from "@courselit/common-models";
import LessonListItem from "../lesson-list-item";
import type { useMultiContainerSortableItem } from "../multi-container-drag-and-drop";

jest.mock("next/navigation", () => ({
    useRouter: () => ({
        push: jest.fn(),
    }),
}));

describe("LessonListItem", () => {
    it("disables lesson drag handle when disabled is true", () => {
        render(
            <LessonListItem
                lesson={
                    {
                        lessonId: "lesson-1",
                        title: "Lesson 1",
                        type: "text",
                        groupId: "group-1",
                        published: true,
                    } as any
                }
                sectionId="group-1"
                productId="product-1"
                disabled
                isDragging={false}
                attributes={
                    {} as ReturnType<
                        typeof useMultiContainerSortableItem
                    >["attributes"]
                }
                listeners={
                    {} as ReturnType<
                        typeof useMultiContainerSortableItem
                    >["listeners"]
                }
                setNodeRef={
                    jest.fn() as ReturnType<
                        typeof useMultiContainerSortableItem
                    >["setNodeRef"]
                }
                style={{}}
            />,
        );

        expect(screen.getByTestId("lesson-drag-handle")).toBeDisabled();
    });

    it("keeps lesson drag handle enabled when disabled is false", () => {
        render(
            <LessonListItem
                lesson={
                    {
                        lessonId: "lesson-1",
                        title: "Lesson 1",
                        type: "text",
                        groupId: "group-1",
                        published: true,
                    } as any
                }
                sectionId="group-1"
                productId="product-1"
                disabled={false}
                isDragging={false}
                attributes={
                    {} as ReturnType<
                        typeof useMultiContainerSortableItem
                    >["attributes"]
                }
                listeners={
                    {} as ReturnType<
                        typeof useMultiContainerSortableItem
                    >["listeners"]
                }
                setNodeRef={
                    jest.fn() as ReturnType<
                        typeof useMultiContainerSortableItem
                    >["setNodeRef"]
                }
                style={{}}
            />,
        );

        expect(screen.getByTestId("lesson-drag-handle")).not.toBeDisabled();
    });
    // The API returns the GraphQL enum name ("STREAMING_VIDEO"), the editor
    // the stored value ("streaming_video"): both get the type's icon.
    it.each(Object.values(Constants.LessonType))(
        "shows the icon of %s lessons",
        (type) => {
            for (const value of [type, type.toUpperCase()]) {
                const { unmount } = render(
                    <LessonListItem
                        lesson={
                            {
                                lessonId: "lesson-1",
                                title: "Lesson 1",
                                type: value,
                                groupId: "group-1",
                                published: true,
                            } as any
                        }
                        sectionId="group-1"
                        productId="product-1"
                        disabled={false}
                        isDragging={false}
                        attributes={{} as any}
                        listeners={{} as any}
                        setNodeRef={jest.fn() as any}
                        style={{}}
                    />,
                );
                expect(
                    screen.getByTestId(`lesson-type-icon-${type}`),
                ).toBeTruthy();
                unmount();
            }
        },
    );
});
