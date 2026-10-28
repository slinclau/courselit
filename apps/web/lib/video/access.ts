import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { UIConstants as constants } from "@courselit/common-models";
import { getCourseManagementAccess } from "@courselit/common-logic";
import { checkPermission } from "@courselit/utils";
import DomainModel, { Domain } from "@models/Domain";
import UserModel from "@models/User";
import CourseModel from "@models/Course";

type AuthorContext = { domain: Domain; user: any };

/**
 * Session + domain + course-management permission, for the routes that an
 * author calls from the lesson editor. Returns a Response to send back when
 * the caller is not allowed in.
 */
export async function authenticateAuthor(
    req: NextRequest,
): Promise<AuthorContext | Response> {
    const domain = await DomainModel.findOne<Domain>({
        name: req.headers.get("domain"),
    });
    if (!domain) {
        return Response.json({ message: "Domain not found" }, { status: 404 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
        return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const user = await UserModel.findOne({
        email: session.user?.email,
        domain: domain._id,
        active: true,
    });
    if (!user) {
        return Response.json({ message: "User not found" }, { status: 404 });
    }

    if (
        !checkPermission(user.permissions, [
            constants.permissions.manageCourse,
            constants.permissions.manageAnyCourse,
        ])
    ) {
        return Response.json({ message: "Forbidden" }, { status: 403 });
    }

    return { domain, user };
}

/**
 * Same ownership rule as the course editor. A video that is not filed under
 * a course (`courseId` null) can only be reached by whoever created it or by
 * a user who can manage any course.
 */
export async function canManageVideoCourse({
    domain,
    user,
    courseId,
    createdBy,
}: {
    domain: Domain;
    user: any;
    courseId: string | null | undefined;
    createdBy?: string;
}): Promise<boolean> {
    if (!courseId) {
        return (
            (!!createdBy && createdBy === user.userId) ||
            checkPermission(user.permissions, [
                constants.permissions.manageAnyCourse,
            ])
        );
    }
    const course = await CourseModel.findOne({
        courseId,
        domain: domain._id,
    });
    if (!course) {
        return false;
    }
    return getCourseManagementAccess({
        creatorId: course.creatorId.toString(),
        userId: user.userId,
        permissions: user.permissions,
    }).canManage;
}
