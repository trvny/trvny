# Kanarek v1 quip recovery snapshot

Recovery-only snapshot created after the accidental deletion of the unscoped
Workers KV v1 quip bank on 2026-09-24.

Source of truth for this snapshot: surviving GitHub PR companion comments,
specifically their hidden `kanarek-pool` payloads. Attributable entries were
migrated into the active v2 bank after #752. These files are a backup only,
never a runtime bank; do not re-import them.

The original v1 bank contained 346 KV entries immediately before deletion.
