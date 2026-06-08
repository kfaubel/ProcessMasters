# Design Highlights

## Project Summary

- Project: ProcessMasters
- Purpose: Batch process PixInsight master images and produce staged outputs.
- Primary workflow: Channel cleanup -> optional per-channel processing -> RGB/SHO combination -> optional finishing steps.

## Current Design Direction

- Keep workflow explicit and stage-based.
- Favor predictable output names at each stage.
- Keep processing options user-toggleable from the dialog.
- Separate UI controls from processing engine behavior.

## Key Decisions

- Added stage-by-stage result handling for RGB and SHO processing.
- Added dialog toggles for multiscale stretch and TIFF export behavior.
- Keep outputs easy to trace by using stage suffixes in IDs and filenames.
- RGB/SHO processing now returns arrays of result windows to support post-processing/export pipelines.
- Brutal-honesty guidance moved to global skills scope; project-local skills focus on repo-specific context.

## Constraints

- Must work within PixInsight PJSR APIs.
- Processing operations can mutate the target window.
- User expects straightforward, debuggable console output.

## Open Questions

- Exact order and scope for applying MultiscaleAdaptiveStretch.
- Whether TIFF export should run for RGB/SHO only or include luminance outputs.
- Whether all TIFF exports should be 16-bit integer by default.
- Whether Save TIFFs toggle should gate all TIFF writes in process flow.

## Next Steps

- Wire new toggles into runtime execution flow if not already done.
- Validate output naming for stars and starless windows.
- Test end-to-end with representative LRGB and SHO data.
- Confirm MultiscaleAdaptiveStretch execution point (before or after star extraction) for RGB/SHO paths.
- Add an automated setup script for global-skill bootstrap in new repos.

## Update Log

### 2026-06-08

- Created initial design highlights baseline.
- Added structure for quick onboarding in future sessions.

### 2026-06-08 (session update)

- Added dialog checkboxes for Run MultiscaleAdaptiveStretch and Save TIFFs.
- Standardized RGB/SHO stage outputs as window arrays to support downstream TIFF export.
- Split skills scope: global brutal-honesty, local design-highlights.
