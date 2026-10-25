// Verifies the S0 contract exists and names every table, function, RPC and shared type.
import { readFileSync, existsSync } from "node:fs";

const failures = [];
const read = (path) => {
  if (!existsSync(path)) {
    failures.push(`missing ${path}`);
    return "";
  }
  return readFileSync(path, "utf8");
};

const contract = read("docs/contract.md");
const types = read("supabase/functions/_shared/types.ts");
const web = read("public/js/contract.js");

const tables = ["profiles", "works", "editions", "shelves", "shelf_books", "recommendations", "search_cache"];
const functions = ["add-book", "book-details", "link-edition", "recommendations"];
const rpcs = ["move_book", "move_shelf", "delete_shelf", "remove_book", "handle_new_user"];
for (const name of [...tables, ...functions, ...rpcs]) {
  if (contract && !contract.includes(name)) failures.push(`docs/contract.md does not mention ${name}`);
}

const typeNames = [
  "ShelfKind", "ResolveStatus",
  "ProfileRow", "WorkRow", "EditionRow", "ShelfRow", "ShelfBookRow", "RecommendationRow",
  "SimaniaBook", "BookCard", "RecommendationCard", "ErrorResponse",
  "SearchBooksRequest", "SearchBooksResponse",
  "AddBookRequest", "AddBookResponse",
  "BookDetailsRequest", "BookDetailsResponse",
  "HebrewHint", "LinkEditionRequest", "LinkEditionResponse",
  "RecommendationsRequest", "RecommendationsResponse",
  "MoveBookArgs", "MoveShelfArgs", "DeleteShelfArgs", "RemoveBookArgs",
];
for (const name of typeNames) {
  if (types && !new RegExp(`export\\s+(type|interface)\\s+${name}\\b`).test(types)) {
    failures.push(`types.ts does not export ${name}`);
  }
}

for (const phrase of ["see architecture", "see docs/architecture", "as described in docs/architecture"]) {
  if (contract.toLowerCase().includes(phrase)) failures.push(`docs/contract.md defers to the architecture ("${phrase}"); restate the rule`);
}

for (const name of ["SHELF_KINDS", "FUNCTIONS", "ROUTES", "RPCS"]) {
  if (web && !new RegExp(`export\\s+const\\s+${name}\\b`).test(web)) failures.push(`public/js/contract.js does not export ${name}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("contract ok");
