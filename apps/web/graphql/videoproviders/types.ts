import {
    GraphQLBoolean,
    GraphQLInputObjectType,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLString,
} from "graphql";

// A list of {key, value} pairs: the field names differ per provider type.
const keyValueType = new GraphQLObjectType({
    name: "VideoProviderKeyValue",
    fields: {
        key: { type: new GraphQLNonNull(GraphQLString) },
        value: { type: new GraphQLNonNull(GraphQLString) },
    },
});

const keyValueInputType = new GraphQLInputObjectType({
    name: "VideoProviderKeyValueInput",
    fields: {
        key: { type: new GraphQLNonNull(GraphQLString) },
        value: { type: new GraphQLNonNull(GraphQLString) },
    },
});

// Deliberately has no field for the secrets themselves, only their last 4.
const videoProviderType = new GraphQLObjectType({
    name: "VideoProvider",
    fields: {
        providerId: { type: new GraphQLNonNull(GraphQLString) },
        type: { type: new GraphQLNonNull(GraphQLString) },
        name: { type: new GraphQLNonNull(GraphQLString) },
        active: { type: new GraphQLNonNull(GraphQLBoolean) },
        settings: {
            type: new GraphQLNonNull(new GraphQLList(keyValueType)),
            resolve: (provider) => toPairs(provider.settings),
        },
        secretsLast4: {
            type: new GraphQLNonNull(new GraphQLList(keyValueType)),
            resolve: (provider) => toPairs(provider.secretsLast4),
        },
        videoCount: { type: new GraphQLNonNull(GraphQLInt) },
    },
});

const videoProviderTestResultType = new GraphQLObjectType({
    name: "VideoProviderTestResult",
    fields: {
        ok: { type: new GraphQLNonNull(GraphQLBoolean) },
        message: { type: new GraphQLNonNull(GraphQLString) },
    },
});

function toPairs(record: Record<string, string> = {}) {
    return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export const fromPairs = (
    pairs: { key: string; value: string }[] = [],
): Record<string, string> =>
    Object.fromEntries(pairs.map(({ key, value }) => [key, value]));

export default {
    videoProviderType,
    videoProviderTestResultType,
    keyValueInputType,
};
