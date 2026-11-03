"use strict";

/**
 * Minimal in-memory stand-in for the MongoDB driver, only for tests.
 * Supports the operations the AI modules use. It is NOT real MongoDB:
 * run the manual checklist against a real database before deploying.
 */

const tick = () => new Promise(resolve => setImmediate(resolve));

function matches(doc, filter) {
    return Object.entries(filter || {}).every(([key, expected]) => {
        const actual = doc[key];

        if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
            if ("$ne" in expected) return actual !== expected.$ne;
            if ("$in" in expected) return expected.$in.includes(actual);
        }

        return actual === expected;
    });
}

function applyUpdate(doc, update) {
    if (update.$set) Object.assign(doc, update.$set);

    if (update.$addToSet) {
        for (const [key, value] of Object.entries(update.$addToSet)) {
            doc[key] = doc[key] || [];
            if (!doc[key].includes(value)) doc[key].push(value);
        }
    }

    if (update.$pull) {
        for (const [key, value] of Object.entries(update.$pull)) {
            doc[key] = (doc[key] || []).filter(item => item !== value);
        }
    }
}

function createFakeDb() {
    const collections = new Map();
    const state = { failing: false, calls: 0 };

    function guard() {
        state.calls += 1;
        if (state.failing) throw new Error("MongoNetworkError: simulated failure");
    }

    function collection(name) {
        if (!collections.has(name)) {
            collections.set(name, { docs: [], uniques: [] });
        }

        const store = collections.get(name);

        function checkUnique(candidate, ignore) {
            for (const fields of store.uniques) {
                const clash = store.docs.some(doc =>
                    doc !== ignore && fields.every(field => doc[field] === candidate[field])
                );

                if (clash) {
                    const error = new Error(`E11000 duplicate key on ${name}`);
                    error.code = 11000;
                    throw error;
                }
            }
        }

        function seedFromFilter(filter) {
            const seed = {};

            for (const [key, value] of Object.entries(filter)) {
                if (!(value && typeof value === "object" && !(value instanceof Date))) seed[key] = value;
            }

            return seed;
        }

        return {
            async createIndex(spec, options = {}) {
                guard();
                if (options.unique) store.uniques.push(Object.keys(spec));
                return "index";
            },

            async findOne(filter) {
                guard();
                const found = store.docs.find(doc => matches(doc, filter));
                return found ? structuredClone(found) : null;
            },

            find(filter) {
                guard();
                let result = store.docs.filter(doc => matches(doc, filter)).map(doc => structuredClone(doc));
                const cursor = {
                    sort(spec) {
                        const [[field, dir]] = Object.entries(spec);
                        result.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * dir);
                        return cursor;
                    },
                    limit(n) {
                        result = result.slice(0, n);
                        return cursor;
                    },
                    async toArray() {
                        return result;
                    },
                };
                return cursor;
            },

            async countDocuments(filter) {
                guard();
                return store.docs.filter(doc => matches(doc, filter)).length;
            },

            async insertOne(doc) {
                guard();
                checkUnique(doc);
                store.docs.push(structuredClone(doc));
                return { acknowledged: true };
            },

            async findOneAndUpdate(filter, update, options = {}) {
                guard();
                let found = store.docs.find(doc => matches(doc, filter));
                await tick(); // let a concurrent caller interleave, to exercise races

                if (!found) {
                    if (!options.upsert) return null;
                    const created = { ...seedFromFilter(filter), ...(update.$setOnInsert || {}) };
                    applyUpdate(created, update);
                    checkUnique(created);
                    store.docs.push(created);
                    found = created;
                } else {
                    applyUpdate(found, update);
                }

                return structuredClone(found);
            },

            async updateOne(filter, update, options = {}) {
                guard();
                const found = store.docs.find(doc => matches(doc, filter));

                if (found) {
                    applyUpdate(found, update);
                    return { matchedCount: 1, modifiedCount: 1 };
                }

                if (options.upsert) {
                    const created = { ...seedFromFilter(filter), ...(update.$setOnInsert || {}) };
                    applyUpdate(created, update);
                    checkUnique(created);
                    store.docs.push(created);
                    return { matchedCount: 0, upsertedCount: 1 };
                }

                return { matchedCount: 0, modifiedCount: 0 };
            },

            async deleteOne(filter) {
                guard();
                const index = store.docs.findIndex(doc => matches(doc, filter));
                if (index >= 0) store.docs.splice(index, 1);
                return { deletedCount: index >= 0 ? 1 : 0 };
            },

            async deleteMany(filter) {
                guard();
                const before = store.docs.length;
                store.docs = store.docs.filter(doc => !matches(doc, filter));
                return { deletedCount: before - store.docs.length };
            },

            _docs: () => store.docs,
        };
    }

    return {
        state,
        collection,
        resetDocs() {
            for (const store of collections.values()) store.docs = [];
            state.failing = false;
            state.calls = 0;
        },
        _insertRaw(name, doc) {
            collection(name)._docs().push(doc);
        },
    };
}

module.exports = { createFakeDb };
