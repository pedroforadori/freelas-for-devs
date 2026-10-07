import { describe, expect, it } from 'vitest';
import {
  MFA_REQUIRED_PERMISSIONS,
  Permission,
  permissionsFor,
  Role,
  ROLE_PERMISSIONS,
} from './permissions.js';

describe('RBAC map', () => {
  it('merges permissions across roles without duplicates', () => {
    const merged = permissionsFor([Role.Client, Role.Freelancer]);
    expect(merged).toContain(Permission.ProfileClientWrite);
    expect(merged).toContain(Permission.ProfileFreelancerWrite);
    expect(merged.filter((p) => p === Permission.FilesUpload)).toHaveLength(1);
  });

  it('keeps admin permissions away from clients and freelancers', () => {
    for (const permission of MFA_REQUIRED_PERMISSIONS) {
      expect(ROLE_PERMISSIONS.CLIENT).not.toContain(permission);
      expect(ROLE_PERMISSIONS.FREELANCER).not.toContain(permission);
    }
  });

  it('grants nothing to the future project manager role yet', () => {
    expect(permissionsFor([Role.ProjectManager])).toEqual([]);
  });
});
