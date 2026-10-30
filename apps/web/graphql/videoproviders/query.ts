import { GraphQLBoolean, GraphQLList, GraphQLNonNull } from "graphql";
import GQLContext from "@models/GQLContext";
import types from "./types";
import { hasActiveVideoProvider, listVideoProviders } from "./logic";

const queries = {
    listVideoProviders: {
        type: new GraphQLNonNull(
            new GraphQLList(new GraphQLNonNull(types.videoProviderType)),
        ),
        resolve: (_: any, __: any, context: GQLContext) =>
            listVideoProviders(context),
    },
    hasActiveVideoProvider: {
        type: new GraphQLNonNull(GraphQLBoolean),
        resolve: (_: any, __: any, context: GQLContext) =>
            hasActiveVideoProvider(context),
    },
};

export default queries;
