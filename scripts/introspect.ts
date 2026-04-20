#!/usr/bin/env bun
import { gql } from "../src/wcl/client.ts";

const TYPE_QUERY = /* GraphQL */ `
  query TypeFields($name: String!) {
    __type(name: $name) {
      name
      kind
      description
      fields {
        name
        description
        args {
          name
          type {
            name
            kind
            ofType {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
        type {
          name
          kind
          ofType {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  }
`;

const typeName = process.argv[2] ?? "Character";

interface TypeField {
  name: string;
  description: string | null;
  args: Array<{
    name: string;
    type: { name: string | null; kind: string; ofType: { name: string | null; kind: string; ofType?: { name: string | null; kind: string } } | null };
  }>;
  type: { name: string | null; kind: string; ofType: { name: string | null; kind: string; ofType?: { name: string | null; kind: string } } | null };
}

interface IntrospectionResult {
  __type: {
    name: string;
    kind: string;
    description: string | null;
    fields: TypeField[] | null;
  } | null;
}

const unwrapType = (t: { name: string | null; kind: string; ofType: { name: string | null; kind: string; ofType?: { name: string | null; kind: string } } | null }): string => {
  if (t.kind === "NON_NULL" && t.ofType) {
    const inner = unwrapType({ ...t.ofType, ofType: t.ofType.ofType ?? null });
    return `${inner}!`;
  }
  if (t.kind === "LIST" && t.ofType) {
    const inner = unwrapType({ ...t.ofType, ofType: t.ofType.ofType ?? null });
    return `[${inner}]`;
  }
  return t.name ?? t.kind;
};

const data = await gql<IntrospectionResult>(TYPE_QUERY, { name: typeName });
if (!data.__type) {
  console.error(`Type ${typeName} not found`);
  process.exit(1);
}
console.log(`# ${data.__type.name} (${data.__type.kind})`);
if (data.__type.description) console.log(`# ${data.__type.description}`);
console.log();
for (const f of data.__type.fields ?? []) {
  const argStr = f.args.length > 0
    ? `(${f.args.map((a) => `${a.name}: ${unwrapType(a.type)}`).join(", ")})`
    : "";
  const retType = unwrapType(f.type);
  console.log(`${f.name}${argStr}: ${retType}`);
  if (f.description) console.log(`  # ${f.description.split("\n")[0]}`);
}
