export interface Viewer {
  id: string;
  is_root: boolean;
}

export interface Target {
  id: string;
  is_root: boolean;
  is_admin: boolean;
}

export interface Permission {
  allowed: boolean;
  reason: string | null;
}

const ALLOWED: Permission = { allowed: true, reason: null };

function refused(reason: string): Permission {
  return { allowed: false, reason };
}

export function canManageAccount(viewer: Viewer, target: Target): Permission {
  if (target.is_root) return refused('The root account cannot be changed.');
  if (!viewer.is_root && target.id === viewer.id) {
    return refused('Only the root account can change an admin account, including your own.');
  }
  if (!viewer.is_root && target.is_admin) {
    return refused('Only the root account can change another admin.');
  }
  return ALLOWED;
}

export function canChangeAdminRole(viewer: Viewer, target: Target): Permission {
  if (target.is_root) return refused('The root account is always an admin.');
  if (!viewer.is_root) return refused('Only the root account can grant or remove admin access.');
  return ALLOWED;
}
