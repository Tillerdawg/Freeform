#!/usr/bin/env node
// Genuine Draft 2020-12 JSON Schema validation, invoked as a subprocess by
// docs/validate_fixture.py so the Python orchestrator never has to fake it.
// Usage: node ajv_validate.mjs <schema.json> <document.json>
// Prints one JSON object to stdout: {"valid": bool, "errors": [...] }.
// Exit code is always 0 when it successfully executed the validator (the
// caller inspects "valid"); a nonzero exit means ajv itself could not run
// (e.g. dependency missing), which the caller must treat as a hard failure,
// never as "schema not violated".
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const [, , schemaPath, docPath] = process.argv;
if (!schemaPath || !docPath) {
  console.error("usage: node ajv_validate.mjs <schema.json> <document.json>");
  process.exit(2);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const doc = JSON.parse(readFileSync(docPath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);

const validateFn = ajv.compile(schema);
const valid = validateFn(doc);

process.stdout.write(
  JSON.stringify({
    valid: Boolean(valid),
    errors: valid ? [] : (validateFn.errors || []).map((e) => ({
      instancePath: e.instancePath,
      schemaPath: e.schemaPath,
      keyword: e.keyword,
      message: e.message,
      params: e.params,
    })),
  })
);
