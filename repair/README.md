# PATCHWORK Repair

This workspace builds typed affordance graphs, localizes first violated predicates from real pilot traces, constructs temporally grounded failure cones, generates deterministic typed patch candidates, and exports repair-pilot evidence.

The current implementation is template-only. It does not call live LLMs, does not apply patches to the main working tree, and does not write to non-`_pilot` databases.

Core commands:

- `npm run repair:build-graphs`
- `npm run repair:validate-graphs`
- `npm run repair:audit-localization`
- `npm run repair:generate`
- `npm run repair:validate`
- `npm run repair:replay`
- `npm run repair:pilot`

Runtime paired replay requires a separate patched-server sandbox. When that sandbox is not enabled, replay exports unresolved rows instead of fabricated patched outcomes.
