import type { Role } from '@prisma/client';

/**
 * Who may do what, in one place. Routes ask for a permission, never for a role, so adding a
 * feature means adding a line here instead of editing shared guards.
 *
 * Staff permissions are held by both moderators and admins. Everything under "admin only" is
 * held by admins alone; moderators get none of it.
 */
const STAFF_PERMISSIONS = [
  'staff.access', // the admin console itself
  'reports.read',
  'reports.resolve',
  'users.read',
  'users.suspend',
  'audit.read',
  'attachments.review',
  'events.manage',
  'announcements.manage',
  'learn.manage',
  'analytics.read',
] as const;

const ADMIN_ONLY_PERMISSIONS = [
  'users.set_role',
  'settings.manage',
  // Added now so the admissions, recognition and pairing work can use them without editing this file's shape.
  'applications.review',
  'applications.window',
  'membership.manage',
  'points.manage',
  'badges.manage',
  'badges.award',
  'challenges.manage',
  'challenges.judge',
  'pairing.manage',
] as const;

export type Permission = (typeof STAFF_PERMISSIONS)[number] | (typeof ADMIN_ONLY_PERMISSIONS)[number];

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  member: [],
  mentor: [],
  tutor: [],
  partner: [],
  moderator: STAFF_PERMISSIONS,
  admin: [...STAFF_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS],
};

export const can = (role: Role, permission: Permission): boolean => PERMISSIONS[role].includes(permission);

/** Every permission a role holds, for the frontend to mirror (GET /users/me). */
export const permissionsFor = (role: Role): Permission[] => [...PERMISSIONS[role]];
