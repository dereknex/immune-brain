// Several suites call `describe`/`test`/`expect` as globals rather than importing
// them from "bun:test". The runtime provides them either way; the type checker
// only learns about them from this reference, which bun-types deliberately keeps
// out of its default entry point.
/// <reference types="bun-types/test-globals" />
