import { z } from 'zod';

/**
 * Papéis da plataforma. PROJECT_MANAGER já está previsto (docs/architecture.md §3) mas não é
 * concedido no MVP: adicioná-lo exige só mapear suas permissões abaixo.
 */
export const Role = {
  Client: 'CLIENT',
  Freelancer: 'FREELANCER',
  Admin: 'ADMIN',
  ProjectManager: 'PROJECT_MANAGER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const roleSchema = z.enum(Object.values(Role) as [Role, ...Role[]]);

/** Papéis que o próprio usuário pode escolher no cadastro. */
export const SelfAssignableRole = { Client: Role.Client, Freelancer: Role.Freelancer } as const;
export type SelfAssignableRole = (typeof SelfAssignableRole)[keyof typeof SelfAssignableRole];
export const selfAssignableRoleSchema = z.enum([Role.Client, Role.Freelancer]);

/**
 * Permissões no formato `recurso:ação[:escopo]`. A API exige uma permissão por rota (RBAC);
 * regras de posse ("é dono deste projeto") ficam nas políticas dos casos de uso.
 * O web usa o mesmo mapa apenas para esconder/mostrar UI.
 */
export const Permission = {
  ProfileClientWrite: 'profile:client:write',
  ProfileFreelancerWrite: 'profile:freelancer:write',
  FilesUpload: 'files:upload',
  ProjectsClientWrite: 'projects:client:write',
  ProposalsFreelancerWrite: 'proposals:freelancer:write',
  AdminUsersRead: 'admin:users:read',
  AdminFreelancersReview: 'admin:freelancers:review',
  AdminProjectsRead: 'admin:projects:read',
  AdminProjectsScope: 'admin:projects:scope',
  AdminSettingsWrite: 'admin:settings:write',
  AdminQueueManage: 'admin:queue:manage',
  AdminAuditRead: 'admin:audit:read',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const permissionSchema = z.enum(Object.values(Permission) as [Permission, ...Permission[]]);

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  CLIENT: [Permission.ProfileClientWrite, Permission.FilesUpload, Permission.ProjectsClientWrite],
  FREELANCER: [
    Permission.ProfileFreelancerWrite,
    Permission.FilesUpload,
    Permission.ProposalsFreelancerWrite,
  ],
  ADMIN: [
    Permission.FilesUpload,
    Permission.AdminUsersRead,
    Permission.AdminFreelancersReview,
    Permission.AdminProjectsRead,
    Permission.AdminProjectsScope,
    Permission.AdminSettingsWrite,
    Permission.AdminQueueManage,
    Permission.AdminAuditRead,
  ],
  PROJECT_MANAGER: [],
};

/** Permissões que exigem sessão com segundo fator (2FA) — ações administrativas. */
export const MFA_REQUIRED_PERMISSIONS: ReadonlySet<Permission> = new Set([
  Permission.AdminUsersRead,
  Permission.AdminFreelancersReview,
  Permission.AdminProjectsRead,
  Permission.AdminProjectsScope,
  Permission.AdminSettingsWrite,
  Permission.AdminQueueManage,
  Permission.AdminAuditRead,
]);

export const permissionsFor = (roles: Iterable<Role>): Permission[] => {
  const granted = new Set<Permission>();
  for (const role of roles)
    for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);
  return [...granted].sort();
};
