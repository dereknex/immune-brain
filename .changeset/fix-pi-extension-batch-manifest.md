---
"immune-brain": patch
---

Register the unattended batch tool in the Pi host extension manifest and document tracker issue slug extraction. The extension entry manifest (`plugins/immune-brain/.pi-extension/package.json`) now lists `./imm-unattended-batch.ts`, allowing Pi to discover and load `start_unattended_batch` for executing multi-task Initiatives after native confirmation. Also clarifies resolving an Initiative tracker issue to its `initiative_slug` in `dist/imm-loop.md`.
