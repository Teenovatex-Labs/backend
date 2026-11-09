-- Additive: two new roles with no special access yet.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'tutor';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'partner';
