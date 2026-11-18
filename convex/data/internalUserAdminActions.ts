"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import type { ExternalUser } from "../integrations/types";
import { getProjectManagementProvider } from "../integrations/registry";

type CorActionResult =
  | {
      ok: true;
      corUserId: number;
      name: string;
      email: string;
    }
  | {
      ok: false;
      error: string;
    };

async function requireInternalUserAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("No autenticado");
  if (!(await ctx.runQuery(internal.data.userAccess.hasPlatformAdminAccess, { userId }))) {
    throw new Error("No tienes permisos para administrar usuarios internos.");
  }
  return userId;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getFirstName(name: string | undefined) {
  return name?.trim().split(/\s+/)[0] ?? "";
}

async function resolveInternalUserInCORNowHandler(
  ctx: any,
  args: { targetUserId: any },
): Promise<CorActionResult> {
  await requireInternalUserAdmin(ctx);

  const approvedExternalUser = await ctx.runQuery(
    internal.data.approvedExternalUsers.getApprovedExternalUserByUserId,
    { userId: args.targetUserId },
  );
  if (approvedExternalUser) {
    return {
      ok: false,
      error: "Esta acción solo aplica a usuarios internos.",
    };
  }

  try {
    const userInfo: { name?: string; email?: string } | null =
      await ctx.runQuery(internal.data.corUsers.getUserBasicInfo, {
        userId: args.targetUserId,
      });

    if (!userInfo) {
      return {
        ok: false,
        error: "Usuario no encontrado en Convex.",
      };
    }

    const searchTerm = getFirstName(userInfo.name);
    const userEmail = userInfo.email?.trim().toLowerCase();

    if (!userEmail) {
      return {
        ok: false,
        error: "El usuario no tiene email para validar su identidad en COR.",
      };
    }

    const provider = getProjectManagementProvider();
    if (provider.name !== "cor") {
      return { ok: false, error: "La integración con COR no está disponible." };
    }

    const hasMatchingEmail = (user: ExternalUser) =>
      user.email.trim().toLowerCase() === userEmail;
    const candidates = searchTerm ? await provider.searchUsersByName(searchTerm) : [];
    let matches = candidates.filter(hasMatchingEmail);
    if (matches.length === 0) {
      const allUsers = await provider.listAllUsers();
      matches = allUsers.filter(hasMatchingEmail);
    }

    if (matches.length === 0) {
      return { ok: false, error: `No se encontró ninguna cuenta en COR con el correo ${userEmail}.` };
    }
    if (matches.length > 1) {
      return { ok: false, error: `Hay más de una cuenta en COR con el correo ${userEmail}. Revisá las coincidencias antes de vincular al usuario.` };
    }

    const [match] = matches;
    await ctx.runMutation(internal.data.corUsers.upsertCorUser, {
      userId: args.targetUserId,
      corUserId: match.id,
      corFirstName: match.firstName,
      corLastName: match.lastName,
      corEmail: match.email,
      corRoleId: match.roleId,
      corPositionName: match.positionName,
    });

    return {
      ok: true,
      corUserId: match.id,
      name: `${match.firstName} ${match.lastName}`.trim(),
      email: match.email,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Error consultando COR: ${formatError(error)}`,
    };
  }
}

async function verifyInternalUserInCORNowHandler(
  ctx: any,
  args: { targetUserId: any },
): Promise<CorActionResult> {
  await requireInternalUserAdmin(ctx);

  const approvedExternalUser = await ctx.runQuery(
    internal.data.approvedExternalUsers.getApprovedExternalUserByUserId,
    { userId: args.targetUserId },
  );
  if (approvedExternalUser) {
    return {
      ok: false,
      error: "Esta acción solo aplica a usuarios internos.",
    };
  }

  try {
    const corUser: {
      corUserId: number;
      corFirstName: string;
      corLastName: string;
      corEmail: string;
    } | null = await ctx.runQuery(internal.data.corUsers.getCorUserByUserId, {
      userId: args.targetUserId,
    });

    if (!corUser) {
      return {
        ok: false,
        error: "Este usuario todavía no tiene corUser para verificar.",
      };
    }

    const provider = getProjectManagementProvider();
    const searchName = getFirstName(corUser.corFirstName);
    const corUsers = await provider.searchUsersByName(searchName);
    const corEmail = corUser.corEmail.trim().toLowerCase();
    const match = corUsers.find(
      (u) => u.email.trim().toLowerCase() === corEmail,
    );

    if (!match) {
      return {
        ok: false,
        error: `COR no encontró el usuario "${searchName}" con email ${corEmail}.`,
      };
    }

    await ctx.runMutation(internal.data.corUsers.upsertCorUser, {
      userId: args.targetUserId,
      corUserId: match.id,
      corFirstName: match.firstName,
      corLastName: match.lastName,
      corEmail: match.email,
      corRoleId: match.roleId,
      corPositionName: match.positionName,
    });

    return {
      ok: true,
      corUserId: match.id,
      name: `${match.firstName} ${match.lastName}`.trim(),
      email: match.email,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Error consultando COR: ${formatError(error)}`,
    };
  }
}

export const resolveInternalUserInCORNow = action({
  args: {
    targetUserId: v.id("users"),
  },
  handler: resolveInternalUserInCORNowHandler,
});

export const verifyInternalUserInCORNow = action({
  args: {
    targetUserId: v.id("users"),
  },
  handler: verifyInternalUserInCORNowHandler,
});
