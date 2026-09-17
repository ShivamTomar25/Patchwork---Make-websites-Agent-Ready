# PATCHWORK Search And Certification

Controlled scripted/mock search-certification harness for finite runtime patch-configuration spaces.

The package builds feasible binary patch spaces, executes exhaustive oracle runs in isolated runtime sandboxes, runs graph-aware surrogate-guided search, freezes candidate sets, performs fresh independent confirmation, and exports candidate-set scoped certificates or abstentions.

All runtime execution requires local `_pilot` databases and `PILOT_ALLOW_RESET=true`. The harness never deploys, merges, or applies generated repairs to the main working tree.
