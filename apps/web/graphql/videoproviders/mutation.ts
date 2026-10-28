import {
    GraphQLBoolean,
    GraphQLList,
    GraphQLNonNull,
    GraphQLString,
} from "graphql";
import type { VideoProviderType } from "@courselit/common-models";
import GQLContext from "@models/GQLContext";
import types, { fromPairs } from "./types";
import {
    removeVideoProvider,
    saveVideoProvider,
    setActiveVideoProvider,
    testVideoProvider,
} from "./logic";

type Pairs = { key: string; value: string }[];

const mutations = {
    saveVideoProvider: {
        type: new GraphQLNonNull(types.videoProviderType),
        args: {
            providerId: { type: GraphQLString },
            type: { type: new GraphQLNonNull(GraphQLString) },
            name: { type: new GraphQLNonNull(GraphQLString) },
            settings: {
                type: new GraphQLList(
                    new GraphQLNonNull(types.keyValueInputType),
                ),
            },
            secrets: {
                type: new GraphQLList(
                    new GraphQLNonNull(types.keyValueInputType),
                ),
            },
        },
        resolve: (
            _: any,
            {
                providerId,
                type,
                name,
                settings,
                secrets,
            }: {
                providerId?: string;
                type: VideoProviderType;
                name: string;
                settings?: Pairs;
                secrets?: Pairs;
            },
            context: GQLContext,
        ) =>
            saveVideoProvider(
                {
                    providerId,
                    type,
                    name,
                    settings: fromPairs(settings),
                    secrets: fromPairs(secrets),
                },
                context,
            ),
    },
    setActiveVideoProvider: {
        type: new GraphQLNonNull(GraphQLBoolean),
        args: {
            providerId: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (
            _: any,
            { providerId }: { providerId: string },
            context: GQLContext,
        ) => setActiveVideoProvider(providerId, context),
    },
    removeVideoProvider: {
        type: new GraphQLNonNull(GraphQLBoolean),
        args: {
            providerId: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (
            _: any,
            { providerId }: { providerId: string },
            context: GQLContext,
        ) => removeVideoProvider(providerId, context),
    },
    testVideoProvider: {
        type: new GraphQLNonNull(types.videoProviderTestResultType),
        args: {
            providerId: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (
            _: any,
            { providerId }: { providerId: string },
            context: GQLContext,
        ) => testVideoProvider(providerId, context),
    },
};

export default mutations;
