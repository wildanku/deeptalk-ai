"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_util_1 = require("node:util");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("../src/generated/prisma/client");
const content_schemas_1 = require("../src/content/content.schemas");
const dir = (0, node_path_1.resolve)(process.argv[2] ?? (0, node_path_1.join)(__dirname, '..', '..', 'content'));
const prisma = new client_1.PrismaClient({
    adapter: new adapter_pg_1.PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
function jsonFiles(path) {
    return (0, node_fs_1.readdirSync)(path).flatMap((name) => {
        const full = (0, node_path_1.join)(path, name);
        if ((0, node_fs_1.statSync)(full).isDirectory())
            return jsonFiles(full);
        return name.endsWith('.json') ? [full] : [];
    });
}
function entriesOf(file, data) {
    const kind = data.kind;
    if (!kind || !(kind in content_schemas_1.CONTENT_SCHEMAS))
        return [];
    const version = Number(data.version);
    if (Array.isArray(data.items)) {
        return data.items.map((item) => ({
            kind,
            refId: item.ref_id,
            version,
            body: item.body,
            file,
        }));
    }
    return [{ kind, refId: String(data.ref_id), version, body: data.body, file }];
}
async function main() {
    const counts = { created: 0, unchanged: 0, personas: 0, mappings: 0, psikologs: 0 };
    for (const file of jsonFiles(dir)) {
        const data = JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8'));
        for (const entry of entriesOf(file, data)) {
            const parsed = content_schemas_1.CONTENT_SCHEMAS[entry.kind].safeParse(entry.body);
            if (!parsed.success) {
                throw new Error(`${entry.file} (${entry.refId}): ${parsed.error.message}`);
            }
            const existing = await prisma.ai_content_versions.findUnique({
                where: {
                    kind_ref_id_version: { kind: entry.kind, ref_id: entry.refId, version: entry.version },
                },
            });
            if (existing) {
                if (!(0, node_util_1.isDeepStrictEqual)(existing.body, parsed.data)) {
                    throw new Error(`${entry.kind}/${entry.refId} v${entry.version} already exists with a different body — bump "version"`);
                }
                counts.unchanged += 1;
                continue;
            }
            await prisma.ai_content_versions.create({
                data: {
                    id: (0, node_crypto_1.randomUUID)(),
                    kind: entry.kind,
                    ref_id: entry.refId,
                    version: entry.version,
                    body: parsed.data,
                    status: 'draft',
                    author_id: 'seed:content',
                },
            });
            counts.created += 1;
        }
        const persona = data.persona;
        if (persona) {
            await prisma.ai_personas.upsert({
                where: { id: persona.id },
                create: {
                    id: persona.id,
                    psychologist_id: persona.psychologist_id,
                    display_name: persona.display_name,
                },
                update: {},
            });
            counts.personas += 1;
        }
        for (const mapping of data.mappings ?? []) {
            await prisma.ai_assessment_mappings.upsert({
                where: {
                    topic_assessment_product_id: {
                        topic: mapping.topic,
                        assessment_product_id: mapping.assessment_product_id,
                    },
                },
                create: { id: (0, node_crypto_1.randomUUID)(), ...mapping },
                update: {},
            });
            counts.mappings += 1;
        }
        for (const id of data.psychologist_ids ?? []) {
            await prisma.ai_handoff_psikologs.upsert({
                where: { psychologist_id: id },
                create: { psychologist_id: id },
                update: {},
            });
            counts.psikologs += 1;
        }
    }
    process.stdout.write(`content seed: ${JSON.stringify(counts)}\n`);
}
main()
    .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
})
    .finally(() => void prisma.$disconnect());
//# sourceMappingURL=seed-content.js.map