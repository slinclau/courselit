module.exports = {
    displayName: "video-providers",
    testEnvironment: "node",
    moduleNameMapper: {
        "@courselit/common-models": "<rootDir>/../common-models/src",
    },
    transform: {
        "^.+\\.ts$": ["ts-jest", { diagnostics: false }],
    },
    testMatch: ["**/__tests__/**/*.test.ts"],
    testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
