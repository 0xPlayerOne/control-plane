# Runtime Compatibility Data

Status: Machine-readable compatibility baseline  
Owner: Control Plane runtime architecture  
Last reviewed: 2026-08-23

`runtime-compatibility.v1.yaml` is the versioned data companion to the canonical **Runtime Compatibility Matrix** Google Doc.

The file records:

- support-state definitions;
- exact adapter, driver, Runtime Gateway, harness/runtime, protocol, location, and entitlement semantics;
- session list, resume, and history behavior as separate capabilities;
- side-effect and reconciliation requirements;
- production certification checks;
- unresolved implementation items.

A row marked `planned` or `partially_verified` does **not** represent production support. M6 owns implementation and compatibility certification. M9 consumes the exact certified combinations in evaluation and release gates.

Changes to a material adapter, driver, protocol, harness/runtime, RuntimeNode location, or policy version invalidate stale certification until the required conformance and acceptance suites pass again. Update the YAML and human-readable matrix together when certification evidence changes.
