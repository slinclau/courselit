import { Constants, type LessonType } from "@courselit/common-models";
import {
    Clapperboard,
    File,
    FileImage,
    FileText,
    Headphones,
    HelpCircle,
    Package,
    Tv,
    Video,
    type LucideIcon,
} from "lucide-react";

/**
 * Icon of each lesson type in the content list. Same icons as the lesson
 * type cards of the lesson editor (`lessonTypes` in its page.tsx).
 */
export const LESSON_TYPE_ICONS: Record<LessonType, LucideIcon> = {
    [Constants.LessonType.TEXT]: FileText,
    [Constants.LessonType.VIDEO]: Video,
    [Constants.LessonType.STREAMING_VIDEO]: Clapperboard,
    [Constants.LessonType.AUDIO]: Headphones,
    [Constants.LessonType.PDF]: FileImage,
    [Constants.LessonType.FILE]: File,
    [Constants.LessonType.EMBED]: Tv,
    [Constants.LessonType.QUIZ]: HelpCircle,
    [Constants.LessonType.SCORM]: Package,
};

/** Accepts the stored value ("text") or the GraphQL enum name ("TEXT"). */
export function getLessonTypeIcon(type?: string): LucideIcon | undefined {
    return type
        ? LESSON_TYPE_ICONS[type.toLowerCase() as LessonType]
        : undefined;
}
