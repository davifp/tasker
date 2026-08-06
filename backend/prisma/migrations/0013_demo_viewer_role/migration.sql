-- Phase 11 — DEMO_VIEWER role for the public portfolio demo.
--
-- Additive-only: adds a new value to the WorkspaceRole enum. Existing rows
-- are unaffected. RolesGuard + write-side repositories enforce strict
-- read-only semantics for anyone with this role.

ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'DEMO_VIEWER';
